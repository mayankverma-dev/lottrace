const db = require('../../db/knex');
const { v4: uuidv4 } = require('uuid');
const {
  HASH_VERSION,
  GENESIS_HASH,
  PENDING_RECORD_HASH,
  PENDING_HASH_KEY_ID,
  getChainTip,
  nextChainSeq,
  sealEventHash,
  appendEventEvidence,
} = require('../../utils/hashChain');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { assertLotsBelongToOrganization } = require('../../utils/tenantLots');
const { buildPagination } = require('../../utils/pagination');
const { encodeCursor, decodeCursor } = require('../../utils/cursor');
const crc32 = require('crc-32');
const { bumpTraceCacheVersion } = require('../trace/trace.service');
const { checkComplianceGaps } = require('./compliance');

const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

const attachmentResponse = (attachment) => ({
  id: attachment.id,
  parentType: attachment.parent_type,
  parentId: attachment.parent_id,
  filename: attachment.filename,
  contentType: attachment.content_type,
  sizeBytes: attachment.size_bytes,
  uploadedBy: attachment.uploaded_by,
  status: attachment.status,
  createdAt: attachment.created_at,
  uploadedAt: attachment.uploaded_at,
});

const getAdvisoryLockId = (orgId) => Math.abs(crc32.str(orgId));

/**
 * Inserts and seals one event inside the caller's transaction.
 *
 * The caller MUST already hold the organization's advisory lock
 * (`pg_advisory_xact_lock`) and MUST pass that same transaction as `qb`.
 * Status is always `active` on insert: `amended` and `void` are lifecycle
 * transitions performed by `amendEvent` and `voidEvent` after the row exists.
 *
 * @param {import('knex').Knex.Transaction} qb
 * @param {Object} data
 * @param {string} organizationId
 * @param {string} userId
 * @param {string|null} [supersedesEventId]
 * @returns {Promise<{ event: Object }>} sealed event
 */
const insertEvent = async (qb, data, organizationId, userId, supersedesEventId = null) => {
  let locationName = null;
  if (data.locationId) {
    const location = await qb('locations')
      .where({ id: data.locationId, organization_id: organizationId })
      .first('id', 'name');
    if (!location) throw new AppError('Location not found', 'NOT_FOUND', 404);
    locationName = location.name;
  }

  // Tenant boundary: every referenced lot must belong to this organization.
  // Runs before the event row exists, so a foreign lot leaves no trace.
  const lotIds = [...(data.inputs || []), ...(data.outputs || [])].map(l => l.lotId);
  await assertLotsBelongToOrganization(qb, lotIds, organizationId);

  // Chain order comes from chain_seq, never created_at (P0-02). Safe to
  // read here: the caller holds the advisory lock for this org.
  const chainTip = await getChainTip(qb, organizationId);
  const prevHash = chainTip ? chainTip.record_hash : GENESIS_HASH;
  const chainSeq = nextChainSeq(chainTip);
  const complianceGaps = await checkComplianceGaps(qb, data, organizationId);

  const eventId = uuidv4();

  await qb('events').insert({
    id: eventId,
    organization_id: organizationId,
    event_type: data.eventType,
    location_id: data.locationId || null,
    counterparty_info: data.counterpartyInfo ? JSON.stringify(data.counterpartyInfo) : null,
    event_datetime: data.eventDatetime,
    recorded_by: userId,
    source: data.source,
    kde_payload: JSON.stringify(data.kdePayload || {}),
    compliance_gaps: complianceGaps ? JSON.stringify(complianceGaps) : null,
    notes: data.notes || null,
    // The hash covers persisted values, so it is sealed after the row and
    // its links exist (P0-01). Same transaction; never rewritten later.
    record_hash: PENDING_RECORD_HASH,
    prev_hash: prevHash,
    chain_seq: chainSeq,
    hash_version: HASH_VERSION,
    hash_key_id: PENDING_HASH_KEY_ID,
    status: 'active',
    supersedes_event_id: supersedesEventId,
  });

  const links = [];
  if (data.inputs) {
    data.inputs.forEach(input => {
      links.push({
        id: uuidv4(),
        organization_id: organizationId,
        event_id: eventId,
        lot_id: input.lotId,
        direction: 'input',
        quantity: input.quantity,
        uom: input.uom,
      });
    });
  }

  if (data.outputs) {
    data.outputs.forEach(output => {
      links.push({
        id: uuidv4(),
        organization_id: organizationId,
        event_id: eventId,
        lot_id: output.lotId,
        direction: 'output',
        quantity: output.quantity,
        uom: output.uom,
      });
    });
  }

  if (links.length > 0) {
    await qb('event_lot_links').insert(links);
  }

  const sealedEvent = await sealEventHash(qb, eventId, prevHash);

  // Definitive graph; side effects (email) run after commit.
  return {
    event: sealedEvent,
    complianceGapAlert: complianceGaps
      ? {
        eventId,
        locationName: locationName || 'Unknown Location',
        eventType: data.eventType,
        timestamp: data.eventDatetime,
        gaps: complianceGaps,
      }
      : null,
  };
};

/**
 * Queues compliance-gap emails for a committed event.
 *
 * Must run after commit: an enqueue inside the transaction can fire for an
 * event that later rolls back, and a Redis/BullMQ outage would then abort the
 * compliance record itself. The event is authoritative; the email is
 * best-effort, so a queue failure is logged and never fails the request.
 *
 * @param {Object|null} alert
 * @param {string} organizationId
 */
const enqueueComplianceGapAlert = async (alert, organizationId) => {
  if (!alert) return;
  try {
    const { emailQueue } = require('../../jobs/queues');
    const users = await db('users')
      .where({ organization_id: organizationId, status: 'active' })
      .whereIn('role', ['compliance_manager']);

    for (const user of users) {
      await emailQueue.add('compliance_gap_alert', {
        type: 'compliance_gap',
        data: { email: user.email, ...alert },
      });
    }
  } catch (err) {
    logger.error({ err, eventId: alert.eventId }, 'Failed to enqueue compliance gap alert');
  }
};

const createEvent = async (data, organizationId, userId) => {
  const lockId = getAdvisoryLockId(organizationId);

  const { event, complianceGapAlert } = await db.transaction(async (trx) => {
    // Acquire org-level lock to prevent concurrent hash chain generation
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockId]);
    return insertEvent(trx, data, organizationId, userId);
  });

  // Bump only after commit: a rolled-back write must not invalidate a valid
  // cached trace, and a pre-commit bump can be observed before graph data exists.
  await Promise.all([
    bumpTraceCacheVersion(organizationId),
    enqueueComplianceGapAlert(complianceGapAlert, organizationId),
  ]);

  return event;
};

const getEvents = async (query, organizationId) => {
  const { limit, cursor, eventType, status, source, locationId, lotId, dateFrom, dateTo } = query;

  let queryBuilder = db('events').where({ 'events.organization_id': organizationId });

  if (lotId) {
    queryBuilder = queryBuilder.whereExists(
      db('event_lot_links')
        .whereRaw('event_lot_links.event_id = events.id')
        .andWhere('event_lot_links.lot_id', lotId)
    );
  }

  if (eventType) queryBuilder = queryBuilder.where({ event_type: eventType });
  if (status) queryBuilder = queryBuilder.where('events.status', status);
  if (source) queryBuilder = queryBuilder.where('events.source', source);
  if (locationId) queryBuilder = queryBuilder.where({ location_id: locationId });
  if (dateFrom) queryBuilder = queryBuilder.where('event_datetime', '>=', dateFrom);
  if (dateTo) queryBuilder = queryBuilder.where('event_datetime', '<=', dateTo);

  if (cursor) {
    const decoded = decodeCursor(cursor);
    queryBuilder = queryBuilder.whereRaw(
      '(events.created_at, events.chain_seq) < (?::timestamptz, ?::bigint)',
      [decoded.t, decoded.s]
    );
  }

  const rows = await queryBuilder
    .leftJoin('locations', 'events.location_id', 'locations.id')
    .leftJoin('users', 'events.recorded_by', 'users.id')
    .select(
      'events.*',
      'locations.name as location_name',
      db.raw("users.first_name || ' ' || users.last_name as recorded_by_name"),
      db.raw(`(
        SELECT json_agg(json_build_object('id', lots.id, 'traceabilityLotCode', lots.traceability_lot_code, 'direction', ell.direction, 'quantity', ell.quantity, 'uom', ell.uom))
        FROM event_lot_links ell
        JOIN lots ON lots.id = ell.lot_id
        WHERE ell.event_id = events.id
      ) as lot_links`),
      // pg decodes timestamptz to a millisecond Date, which truncates the
      // microseconds needed for a stable keyset. Format the exact value in SQL.
      db.raw(`to_char(events.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_cursor`)
    )
    // created_at is the transaction start time and can tie under concurrency.
    // chain_seq is unique per organization, so it makes pagination stable.
    .orderBy([
      { column: 'events.created_at', order: 'desc' },
      { column: 'events.chain_seq', order: 'desc' },
    ])
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const events = hasNextPage ? rows.slice(0, limit) : rows;
  const lastEvent = events[events.length - 1];
  const nextCursor = hasNextPage && lastEvent
    ? encodeCursor({
      t: lastEvent.created_at_cursor,
      s: String(lastEvent.chain_seq),
    })
    : null;

  events.forEach((event) => {
    delete event.created_at_cursor;
  });

  return {
    data: events,
    pagination: {
      limit,
      hasNextPage,
      nextCursor,
    },
  };
};

const getEventById = async (eventId, organizationId) => {
  const event = await db('events').where({ id: eventId, organization_id: organizationId }).first();
  if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

  const links = await db('event_lot_links')
    .join('lots', 'lots.id', 'event_lot_links.lot_id')
    .where({ event_id: eventId })
    // Explicit columns: organization_id is a tenant guard on the link table,
    // not part of the event detail response shape.
    .select(
      'event_lot_links.id',
      'event_lot_links.event_id',
      'event_lot_links.lot_id',
      'event_lot_links.direction',
      'event_lot_links.quantity',
      'event_lot_links.uom',
      'event_lot_links.created_at',
      'lots.traceability_lot_code',
      'lots.product_id',
    );

  event.inputs = links.filter(l => l.direction === 'input');
  event.outputs = links.filter(l => l.direction === 'output');

  return event;
};

const voidEvent = async (eventId, voidReason, organizationId, userId = null) => {
  const { voided } = await db.transaction(async (trx) => {
    const event = await trx('events')
      .where({ id: eventId, organization_id: organizationId })
      .forUpdate()
      .first();
    if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);
    if (event.status !== 'active') throw new AppError('Event is not active', 'EVENT_IMMUTABLE', 409);

    const [updated] = await trx('events')
      .where({ id: eventId, status: 'active' })
      .update({ status: 'void', status_reason: voidReason })
      .returning('*');

    if (!updated) throw new AppError('Event is not active', 'EVENT_IMMUTABLE', 409);

    // Status and status_reason are mutable, so the sealed event hash cannot cover
    // them. Bind the transition to the event hash with signed evidence instead.
    await appendEventEvidence(trx, {
      organizationId,
      eventId,
      kind: 'status_change',
      payload: {
        fromStatus: event.status,
        toStatus: 'void',
        reason: voidReason,
        actorId: userId,
      },
    }, event.record_hash);

    return {
      voided: updated,
    };
  });

  // Bump only after commit so a rolled-back void cannot invalidate a valid
  // cached trace. Organization versioning covers upstream starting lots.
  await bumpTraceCacheVersion(organizationId);

  return voided;
};

const amendEvent = async (eventId, data, organizationId, userId) => {
  const lockId = getAdvisoryLockId(organizationId);

  // One transaction, one connection: the replacement row, the status change on
  // the superseded row, and its signed evidence all commit together or not at
  // all (P0-04). Lock order is fixed: organization advisory lock, then row lock.
  const { replacement, complianceGapAlert } = await db.transaction(async (trx) => {
    // Serialize every chain writer for this organization, including creates.
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockId]);

    const oldEvent = await trx('events')
      .where({ id: eventId, organization_id: organizationId })
      // `FOR NO KEY UPDATE`, not `FOR UPDATE`: this transaction inserts a row
      // that references this event through `supersedes_event_id`, and the
      // foreign-key check takes a KEY SHARE lock. A plain FOR UPDATE would
      // block that check forever; this mode still serializes concurrent writers.
      .forNoKeyUpdate()
      .first();
    if (!oldEvent) throw new AppError('Event not found', 'NOT_FOUND', 404);
    if (oldEvent.status !== 'active') throw new AppError('Event is not active', 'EVENT_IMMUTABLE', 409);

    // An amendment corrects the facts of one event; it cannot turn it into a
    // different event type, and it cannot rewrite where the record came from.
    // Recorded-by stays the authenticated amend actor on the replacement row.
    if (data.eventType !== oldEvent.event_type) {
      throw new AppError(
        'Event type cannot change when amending an event',
        'VALIDATION_ERROR',
        400,
      );
    }
    const replacementData = { ...data, source: oldEvent.source };

    // Create the replacement that supersedes the old one, same transaction.
    const created = await insertEvent(trx, replacementData, organizationId, userId, eventId);

    // Claim the old row. The status predicate plus the affected-row assertion
    // guarantee exactly one transition, even if a future caller bypasses the
    // read above.
    const updated = await trx('events')
      .where({ id: eventId, organization_id: organizationId, status: 'active' })
      .update({ status: 'amended', status_reason: data.amendReason });
    if (updated !== 1) throw new AppError('Event is not active', 'EVENT_IMMUTABLE', 409);

    await appendEventEvidence(trx, {
      organizationId,
      eventId,
      kind: 'status_change',
      payload: {
        fromStatus: oldEvent.status,
        toStatus: 'amended',
        reason: data.amendReason,
        actorId: userId,
      },
    }, oldEvent.record_hash);

    return {
      replacement: created.event,
      complianceGapAlert: created.complianceGapAlert,
    };
  });

  // After commit only, so a rolled-back amendment cannot evict a valid cache
  // and cannot email an alert for an event that never committed.
  await Promise.all([
    bumpTraceCacheVersion(organizationId),
    enqueueComplianceGapAlert(complianceGapAlert, organizationId),
  ]);

  return replacement;
};

const generateAttachmentUploadUrl = async (eventId, organizationId, userId, filename, contentType) => {
  // We can inject storage require here or at the top. Let's do it here to avoid circular dep if any, though it's clean at top.
  const { generatePresignedUploadUrl } = require('../../lib/storage');
  
  // Verify event belongs to org
  const event = await db('events').where({ id: eventId, organization_id: organizationId }).first();
  if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

  if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
    throw new AppError('Attachment type is not allowed', 'VALIDATION_ERROR', 422);
  }

  const attachment = await db.transaction(async (trx) => {
    const [row] = await trx('attachments').insert({
      organization_id: organizationId,
      parent_type: 'event',
      parent_id: eventId,
      storage_key: `attachments/org_${organizationId}/events/${eventId}/${uuidv4()}`,
      filename,
      content_type: contentType,
      uploaded_by: userId,
      status: 'pending',
    }).returning('*');
    return row;
  });

  const uploadUrl = await generatePresignedUploadUrl(attachment.storage_key, contentType);
  return { uploadUrl, attachmentId: attachment.id };
};

const addAttachment = async (eventId, data, organizationId, userId) => {
  const { headObject } = require('../../lib/storage');
  return db.transaction(async (trx) => {
    const event = await trx('events')
      .where({ id: eventId, organization_id: organizationId })
      .forUpdate()
      .first();
    if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

    const attachment = await trx('attachments')
      .where({
        id: data.attachmentId,
        organization_id: organizationId,
        parent_type: 'event',
        parent_id: eventId,
        status: 'pending',
      })
      .forUpdate()
      .first();
    if (!attachment) throw new AppError('Attachment not found', 'NOT_FOUND', 404);

    let object;
    try {
      object = await headObject(attachment.storage_key);
    } catch (err) {
      if (err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        throw new AppError('Attachment has not been uploaded', 'ATTACHMENT_NOT_UPLOADED', 409);
      }
      logger.error({ err, attachmentId: attachment.id }, 'Attachment storage verification failed');
      throw new AppError('Attachment storage is unavailable', 'STORAGE_UNAVAILABLE', 503);
    }

    if (!Number.isInteger(object.contentLength) || object.contentLength < 0 || object.contentLength > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new AppError('Attachment exceeds the 50 MiB size limit', 'VALIDATION_ERROR', 422);
    }
    if (object.contentType !== attachment.content_type) {
      throw new AppError('Attachment content type does not match the upload request', 'VALIDATION_ERROR', 422);
    }

    const [uploadedAttachment] = await trx('attachments')
      .where({ id: attachment.id, status: 'pending' })
      .update({
        size_bytes: object.contentLength,
        content_type: object.contentType,
        status: 'uploaded',
        uploaded_at: new Date(),
      })
      .returning('*');

    // Attachment metadata is added after the event is sealed. Bind it to the
    // event hash with signed evidence so a later edit or deletion is detectable.
    await appendEventEvidence(trx, {
      organizationId,
      eventId,
      kind: 'attachment_added',
      payload: {
        attachmentId: uploadedAttachment.id,
        storageKey: uploadedAttachment.storage_key,
        filename: uploadedAttachment.filename,
        contentType: uploadedAttachment.content_type,
        sizeBytes: uploadedAttachment.size_bytes,
        uploadedBy: uploadedAttachment.uploaded_by,
        attachmentCreatedAt: new Date(uploadedAttachment.created_at).toISOString(),
      },
    }, event.record_hash);

    return attachmentResponse(uploadedAttachment);
  });
};

const listAttachments = async (eventId, query, organizationId) => {
  const event = await db('events').where({ id: eventId, organization_id: organizationId }).first('id');
  if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

  const { page, limit } = query;
  const offset = (page - 1) * limit;
  const baseQuery = db('attachments').where({
    organization_id: organizationId,
    parent_type: 'event',
    parent_id: eventId,
    status: 'uploaded',
  });
  const [{ count }] = await baseQuery.clone().count('id as count');
  const rows = await baseQuery.clone()
    .select('id', 'parent_type', 'parent_id', 'filename', 'content_type', 'size_bytes', 'uploaded_by', 'status', 'created_at', 'uploaded_at')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    data: rows.map(attachmentResponse),
    pagination: buildPagination(Number(count), page, limit),
  };
};

const getAttachmentDownloadUrl = async (attachmentId, organizationId) => {
  const { generatePresignedDownloadUrl } = require('../../lib/storage');
  const attachment = await db('attachments').where({
    id: attachmentId,
    organization_id: organizationId,
    parent_type: 'event',
    status: 'uploaded',
  }).first();
  if (!attachment) throw new AppError('Attachment not found', 'NOT_FOUND', 404);

  const downloadUrl = await generatePresignedDownloadUrl(attachment.storage_key, {
    filename: attachment.filename,
    contentType: attachment.content_type,
  });
  return { downloadUrl };
};

const finalizeDeletedAttachment = async (trx, attachment, actorId, actorType = 'user', ipAddress = null) => {
  const [deleted] = await trx('attachments')
    .where({ id: attachment.id, organization_id: attachment.organization_id, status: 'deleting' })
    .update({ status: 'deleted', deleted_at: new Date(), deleted_by: actorId })
    .returning('*');
  if (!deleted) throw new AppError('Attachment not found', 'NOT_FOUND', 404);

  const event = await trx('events')
    .where({ id: deleted.parent_id, organization_id: deleted.organization_id })
    .forUpdate()
    .first('id', 'record_hash');
  if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

  await appendEventEvidence(trx, {
    organizationId: deleted.organization_id,
    eventId: event.id,
    kind: 'attachment_deleted',
    payload: {
      attachmentId: deleted.id,
      actorId,
      deletedAt: new Date(deleted.deleted_at).toISOString(),
    },
  }, event.record_hash);

  const { writeAuditLog } = require('../../utils/auditTrail');
  await writeAuditLog({
    organizationId: deleted.organization_id,
    actorId,
    actorType,
    action: 'attachment.delete',
    entityType: 'attachment',
    entityId: deleted.id,
    beforeState: attachmentResponse(attachment),
    afterState: attachmentResponse(deleted),
    ipAddress,
  }, trx);

  return attachmentResponse(deleted);
};

const purgePendingAttachments = async () => {
  const { deleteObject } = require('../../lib/storage');
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pending = await db('attachments')
    .whereIn('status', ['pending', 'deleting'])
    .where('created_at', '<', cutoff)
    .orderBy('created_at', 'asc')
    .select('id', 'storage_key');
  let deleted = 0;
  for (const attachment of pending) {
    try {
      await deleteObject(attachment.storage_key);
      const current = await db('attachments').where({ id: attachment.id }).first();
      if (current?.status === 'pending') {
        await db('attachments').where({ id: attachment.id, status: 'pending' }).del();
      } else if (current?.status === 'deleting') {
        await db.transaction(async (trx) => finalizeDeletedAttachment(trx, current, null, 'system'));
      }
      deleted += 1;
    } catch (err) {
      logger.warn({ err, attachmentId: attachment.id }, 'Pending attachment cleanup failed');
    }
  }
  return { scanned: pending.length, deleted };
};

const deleteAttachment = async (attachmentId, organizationId, userId, ipAddress) => {
  const { deleteObject } = require('../../lib/storage');
  const attachment = await db.transaction(async (trx) => {
    const row = await trx('attachments')
      .where({ id: attachmentId, organization_id: organizationId, parent_type: 'event', status: 'uploaded' })
      .forUpdate()
      .first();
    if (!row) throw new AppError('Attachment not found', 'NOT_FOUND', 404);

    const [deleting] = await trx('attachments')
      .where({ id: attachmentId, status: 'uploaded' })
      .update({ status: 'deleting' })
      .returning('*');
    return deleting;
  });

  try {
    await deleteObject(attachment.storage_key);
  } catch (err) {
    await db('attachments')
      .where({ id: attachmentId, organization_id: organizationId, status: 'deleting' })
      .update({ status: 'uploaded' });
    logger.error({ err, attachmentId }, 'Attachment object deletion failed');
    throw new AppError('Attachment storage is unavailable', 'STORAGE_UNAVAILABLE', 503);
  }

  return db.transaction(async (trx) => finalizeDeletedAttachment(trx, attachment, userId, 'user', ipAddress));
};

module.exports = {
  createEvent,
  getEvents,
  getEventById,
  voidEvent,
  amendEvent,
  generateAttachmentUploadUrl,
  addAttachment,
  listAttachments,
  getAttachmentDownloadUrl,
  purgePendingAttachments,
  deleteAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
  ALLOWED_ATTACHMENT_TYPES,
};
