const { Worker } = require('bullmq');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db/knex');
const logger = require('../../utils/logger');
const { connection } = require('../queues');
const { writeAuditLog } = require('../../utils/auditTrail');
const { captureHashVerificationFailure } = require('../../lib/sentry');
const {
  HASH_VERSION,
  GENESIS_HASH,
  computeEventHash,
  computeEventEvidenceHash,
  loadEventHashPayload,
  loadEventEvidence,
  buildEventEvidenceHashPayload,
  hasHashKey,
  getKeyRing,
  stableStringify,
} = require('../../utils/hashChain');

const asJson = (value) => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

const toIso = (value) => (value === null || value === undefined
  ? null
  : new Date(value).toISOString());

/**
 * Verifies the append-only evidence chain for one event and cross-checks it
 * against the materialized mutable state (`events.status`, `events.void_reason`,
 * and `attachments` rows).
 *
 * @param {Object} event - events row
 * @param {Object<string, string>} keyRing
 * @returns {Promise<Object|null>} failure metadata, or null when valid
 */
const verifyEventEvidence = async (event, keyRing) => {
  const evidenceRows = await loadEventEvidence(db, event.id);

  let prevHash = event.record_hash;
  let expectedSeq = 1;
  const statusChanges = [];
  const attachmentFacts = new Map();

  for (const evidence of evidenceRows) {
    if (Number(evidence.seq) !== expectedSeq) {
      return {
        reason: 'evidence_chain_mismatch',
        detail: { expected_seq: expectedSeq, found_seq: Number(evidence.seq) },
      };
    }
    expectedSeq += 1;

    if (evidence.prev_hash !== prevHash) {
      return { reason: 'evidence_chain_mismatch', detail: { evidence_id: evidence.id } };
    }

    if (evidence.hash_version !== HASH_VERSION) {
      return {
        reason: 'unsupported_hash_version',
        detail: {
          expected_version: HASH_VERSION,
          found_version: evidence.hash_version,
          evidence_id: evidence.id,
        },
      };
    }

    if (!hasHashKey(evidence.hash_key_id, keyRing)) {
      return {
        reason: 'unsupported_hash_key',
        detail: { key_id: evidence.hash_key_id, evidence_id: evidence.id },
      };
    }

    const payload = buildEventEvidenceHashPayload(evidence);
    const recordHash = computeEventEvidenceHash(
      payload,
      prevHash,
      evidence.hash_key_id,
      keyRing,
    );

    if (recordHash !== evidence.record_hash) {
      return {
        reason: 'evidence_payload_mismatch',
        detail: { evidence_id: evidence.id, expected: recordHash },
      };
    }

    prevHash = recordHash;

    if (evidence.kind === 'status_change') {
      statusChanges.push(asJson(evidence.payload) || {});
    } else if (evidence.kind === 'attachment_added') {
      const payloadValue = asJson(evidence.payload) || {};
      attachmentFacts.set(payloadValue.attachmentId, payloadValue);
    } else {
      return {
        reason: 'evidence_payload_mismatch',
        detail: { evidence_id: evidence.id, unknown_kind: evidence.kind },
      };
    }
  }

  let expectedStatus = 'active';
  let expectedReason = null;

  if (statusChanges.length > 0) {
    let fromStatus = 'active';
    for (const change of statusChanges) {
      if (change.fromStatus !== fromStatus) {
        return {
          reason: 'evidence_state_mismatch',
          detail: { expected_from_status: fromStatus, found_from_status: change.fromStatus },
        };
      }
      fromStatus = change.toStatus;
    }

    const latest = statusChanges[statusChanges.length - 1];
    expectedStatus = latest.toStatus;
    expectedReason = latest.reason ?? null;
  }

  if (event.status !== expectedStatus || (event.void_reason ?? null) !== expectedReason) {
    return {
      reason: 'evidence_state_mismatch',
      detail: {
        expected_status: expectedStatus,
        found_status: event.status,
        expected_reason: expectedReason,
        found_reason: event.void_reason ?? null,
      },
    };
  }

  const attachmentRows = await db('attachments')
    .where({
      organization_id: event.organization_id,
      parent_type: 'event',
      parent_id: event.id,
    });

  const actualAttachments = new Map(attachmentRows.map((row) => [row.id, {
    attachmentId: row.id,
    storageKey: row.storage_key,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    attachmentCreatedAt: toIso(row.created_at),
  }]));

  if (actualAttachments.size !== attachmentFacts.size) {
    return {
      reason: 'evidence_state_mismatch',
      detail: {
        expected_attachments: attachmentFacts.size,
        found_attachments: actualAttachments.size,
      },
    };
  }

  for (const [attachmentId, actual] of actualAttachments) {
    const expected = attachmentFacts.get(attachmentId);
    if (!expected || stableStringify(expected) !== stableStringify(actual)) {
      return {
        reason: 'evidence_state_mismatch',
        detail: { attachment_id: attachmentId },
      };
    }
  }

  return null;
};

/**
 * Re-walks every organization's event chain in `chain_seq` order, verifies
 * event HMACs and evidence chains, and records an operational result.
 *
 * @param {{ organizationId?: string, keyRing?: Object<string, string> }} [options]
 * @returns {Promise<Array<Object>>} one result per organization
 */
const verifyHashChain = async ({ organizationId, keyRing = getKeyRing() } = {}) => {
  const organizations = organizationId
    ? await db('organizations').where({ id: organizationId }).select('id', 'name')
    : await db('organizations').select('id', 'name');

  const results = [];

  for (const org of organizations) {
    logger.info(`Starting hash verification for org: ${org.id}`);
    const startedAt = Date.now();

    // Fetch events in chain order. chain_seq is the only total order for an
    // organization: created_at is the transaction start time and can be
    // inverted relative to the order in which hashes were chained (P0-02).
    const events = await db('events')
      .where({ organization_id: org.id })
      .orderBy('chain_seq', 'asc');

    let prevHash = GENESIS_HASH;
    let failedEvent = null;
    let failureMetadata = null;
    let eventsChecked = 0;

    for (const event of events) {
      if (event.prev_hash !== prevHash) {
        failedEvent = event;
        failureMetadata = { reason: 'chain_link_mismatch' };
        break;
      }

      if (event.hash_version !== HASH_VERSION) {
        failedEvent = event;
        failureMetadata = {
          reason: 'unsupported_hash_version',
          expected_version: HASH_VERSION,
          found_version: event.hash_version,
        };
        break;
      }

      if (!hasHashKey(event.hash_key_id, keyRing)) {
        failedEvent = event;
        failureMetadata = {
          reason: 'unsupported_hash_key',
          key_id: event.hash_key_id,
        };
        break;
      }

      // Same canonical serializer as the write and import paths: the hash is
      // rebuilt from the persisted row and links, never from a request body.
      const payload = await loadEventHashPayload(db, event.id);
      const recordHash = computeEventHash(
        payload,
        prevHash,
        event.hash_key_id,
        keyRing,
      );

      if (recordHash !== event.record_hash) {
        failedEvent = event;
        failureMetadata = { reason: 'payload_mismatch', expected: recordHash };
        break;
      }

      const evidenceFailure = await verifyEventEvidence(event, keyRing);
      if (evidenceFailure) {
        failedEvent = event;
        failureMetadata = evidenceFailure;
        break;
      }

      prevHash = recordHash;
      eventsChecked += 1;
    }

    const durationMs = Date.now() - startedAt;
    const status = failedEvent ? 'failed' : 'passed';

    if (failedEvent) {
      logger.error(`Hash verification failed for event ${failedEvent.id} in org ${org.id}`);

      await writeAuditLog({
        organizationId: org.id,
        actorType: 'system',
        action: 'hash.verify_failed',
        entityType: 'event',
        entityId: failedEvent.id,
        metadata: {
          ...failureMetadata,
          found: failedEvent.record_hash,
          prev_hash: failedEvent.prev_hash,
        },
      });

      try {
        await db('notifications').insert({
          id: uuidv4(),
          organization_id: org.id,
          user_id: null,
          type: 'hash_verification_failed',
          title: 'Hash chain verification failed',
          message: `Event ${failedEvent.id} failed integrity verification (${failureMetadata.reason}).`,
          link: '/audit',
          entity_type: 'event',
          entity_id: failedEvent.id,
        });
      } catch (notifErr) {
        logger.warn({ err: notifErr }, 'Failed to create hash verification notification');
      }

      captureHashVerificationFailure({
        organizationId: org.id,
        eventId: failedEvent.id,
        reason: failureMetadata.reason,
      });
    } else {
      logger.info(`Hash verification successful for org: ${org.id}`);
    }

    try {
      await writeAuditLog({
        organizationId: org.id,
        actorType: 'system',
        action: 'hash.verify_completed',
        entityType: 'organization',
        entityId: org.id,
        metadata: {
          status,
          events_checked: eventsChecked,
          duration_ms: durationMs,
          failure_event_id: failedEvent ? failedEvent.id : null,
          failure_reason: failureMetadata ? failureMetadata.reason : null,
        },
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr }, 'Failed to record hash verification health result');
    }

    // Structured metric for log/metrics pipelines; no unauthenticated endpoint.
    logger.info({
      metric: 'hash_verification_completed',
      organizationId: org.id,
      status,
      eventsChecked,
      durationMs,
      failureReason: failureMetadata ? failureMetadata.reason : null,
    }, 'Hash verification completed');

    results.push({
      organizationId: org.id,
      status,
      eventsChecked,
      durationMs,
      failure: failedEvent
        ? { eventId: failedEvent.id, reason: failureMetadata.reason }
        : null,
    });
  }

  return results;
};

const worker = new Worker('hash-verify-queue', async (job) => {
  logger.info(`Processing hash verify job: ${job.id}`);
  await verifyHashChain();
}, { connection });

worker.on('failed', (job, err) => {
  logger.error({ err, jobId: job.id }, 'Hash verify job failed');
});

module.exports = worker;
module.exports.verifyHashChain = verifyHashChain;
