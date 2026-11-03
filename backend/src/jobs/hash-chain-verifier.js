const db = require('../db/knex');
const logger = require('../utils/logger');
const {
  computeEventHash,
  buildEventPayloadForVerification,
  HASH_VERSION_LEGACY,
} = require('../utils/hashChain');

/**
 * Verifies the event hash chain for one organization, or for every organization.
 *
 * Legacy rows (hash_version 1) were hashed from request-shaped objects (JS numbers,
 * request link order, raw datetime strings) and cannot be reconstructed from persisted
 * rows. For those rows only the chain linkage (`prev_hash`) is verified; the payload is
 * reported as not verifiable instead of producing a false tamper alert.
 *
 * @param {{ organizationId?: string }} [options]
 * @returns {Promise<{
 *   organizationsChecked: number,
 *   eventsChecked: number,
 *   canonicalVerified: number,
 *   legacySkipped: number,
 *   failures: Array<{ organizationId: string, eventId: string, reason: string, expectedHash: string|null, storedHash: string|null }>
 * }>}
 */
const verifyHashChain = async ({ organizationId } = {}) => {
  const orgQuery = db('organizations').select('id', 'name');
  if (organizationId) orgQuery.where({ id: organizationId });
  const organizations = await orgQuery;

  const summary = {
    organizationsChecked: 0,
    eventsChecked: 0,
    canonicalVerified: 0,
    legacySkipped: 0,
    failures: [],
  };

  for (const org of organizations) {
    summary.organizationsChecked += 1;
    logger.info(`Starting hash verification for org: ${org.id}`);

    // Fetch events ordered by created_at asc
    const events = await db('events')
      .where({ organization_id: org.id })
      .orderBy('created_at', 'asc');

    let expectedPrevHash = 'GENESIS';
    let failedEvent = null;
    let verifiedCount = 0;
    let legacyCount = 0;

    for (const event of events) {
      summary.eventsChecked += 1;

      if (event.prev_hash !== expectedPrevHash) {
        failedEvent = {
          eventId: event.id,
          reason: 'chain_link_mismatch',
          expectedHash: expectedPrevHash,
          storedHash: event.prev_hash,
        };
        break;
      }

      const hashVersion =
        event.hash_version === null || event.hash_version === undefined
          ? HASH_VERSION_LEGACY
          : Number(event.hash_version);

      if (hashVersion === HASH_VERSION_LEGACY) {
        legacyCount += 1;
        // The legacy writer hashed data that is not fully recoverable from the row
        // (request link order, JS numbers, raw datetime string), so only the chain
        // linkage can be trusted. Never report these as tampered.
        expectedPrevHash = event.record_hash;
        continue;
      }

      try {
        const links = await db('event_lot_links')
          .where({ event_id: event.id })
          .orderBy('lot_id', 'asc');

        // Throws for unknown hash versions: fail closed rather than guessing.
        const eventPayload = buildEventPayloadForVerification(event, links);
        const recordHash = computeEventHash(eventPayload, expectedPrevHash);

        if (recordHash !== event.record_hash) {
          failedEvent = {
            eventId: event.id,
            reason: 'hash_mismatch',
            expectedHash: recordHash,
            storedHash: event.record_hash,
          };
          break;
        }

        verifiedCount += 1;
        expectedPrevHash = recordHash;
      } catch (err) {
        failedEvent = {
          eventId: event.id,
          reason: `verification_error: ${err.message}`,
          expectedHash: null,
          storedHash: event.record_hash,
        };
        break;
      }
    }

    summary.canonicalVerified += verifiedCount;
    summary.legacySkipped += legacyCount;

    if (failedEvent) {
      summary.failures.push({ organizationId: org.id, ...failedEvent });
      logger.error(
        `Hash verification failed for event ${failedEvent.eventId} in org ${org.id}: ${failedEvent.reason}`,
      );
      await db('audit_log').insert({
        organization_id: org.id,
        actor_type: 'system',
        action: 'hash.verify_failed',
        entity_type: 'event',
        entity_id: failedEvent.eventId,
        metadata: JSON.stringify({
          expected: failedEvent.expectedHash,
          found: failedEvent.storedHash,
          reason: failedEvent.reason,
        }),
      });
    } else {
      logger.info(
        `Hash verification successful for org ${org.id}: ${verifiedCount} canonical event(s) verified, ${legacyCount} legacy event(s) chain-checked only`,
      );

      if (legacyCount > 0) {
        await db('audit_log').insert({
          organization_id: org.id,
          actor_type: 'system',
          action: 'hash.verify_legacy_skipped',
          entity_type: 'organization',
          entity_id: org.id,
          metadata: JSON.stringify({
            legacyEvents: legacyCount,
            reason: 'hash_version 1 events cannot be payload-verified from persisted rows',
          }),
        });
      }
    }
  }

  return summary;
};

module.exports = { verifyHashChain };
