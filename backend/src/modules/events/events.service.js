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
const crc32 = require('crc-32');
const { invalidateTraceCache } = require('../trace/trace.service');

const getAdvisoryLockId = (orgId) => Math.abs(crc32.str(orgId));

// `qb` is the caller's transaction. It must NOT fall back to the global pool:
// the caller already holds a connection for its transaction, so a second
// connection here exhausts the pool under concurrent event creation.
const checkComplianceGaps = async (qb, data, organizationId) => {
  const lotIds = [...(data.inputs || []), ...(data.outputs || [])].map(l => l.lotId);
  if (lotIds.length === 0) return null;
  
  const lots = await qb('lots')
    .join('products', 'lots.product_id', 'products.id')
    .whereIn('lots.id', lotIds)
    .andWhere('lots.organization_id', organizationId)
    .select('products.is_ftl', 'products.custom_kde_schema');

  const gaps = [];
  let isFtl = false;
  
  lots.forEach(lot => {
    if (lot.is_ftl) isFtl = true;
    if (lot.custom_kde_schema) {
      const schema = typeof lot.custom_kde_schema === 'string' ? JSON.parse(lot.custom_kde_schema) : lot.custom_kde_schema;
      schema.forEach(field => {
        if (field.required && !data.kdePayload?.[field.name]) {
          if (!gaps.find(g => g.field === field.name)) {
            gaps.push({ field: field.name, message: `${field.label || field.name} is required` });
          }
        }
      });
    }
  });

  return gaps.length > 0 ? JSON.stringify(gaps) : null;
};

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
 * @returns {Promise<{ event: Object, lotIds: string[] }>} sealed event and linked lot ids
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
    compliance_gaps: complianceGaps,
    notes: data.notes || null,
    idempotency_key: data.idempotencyKey || null,
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
    lotIds: [...new Set(links.map(l => l.lot_id))],
    complianceGapAlert: complianceGaps
      ? {
        eventId,
        locationName: locationName || 'Unknown Location',
        eventType: data.eventType,
        timestamp: data.eventDatetime,
        gaps: JSON.parse(complianceGaps),
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
  if (data.idempotencyKey) {
    const existing = await db('events').where({ idempotency_key: data.idempotencyKey, organization_id: organizationId }).first();
    if (existing) return existing;
  }

  const lockId = getAdvisoryLockId(organizationId);

  const { event, lotIds, complianceGapAlert } = await db.transaction(async (trx) => {
    // Acquire org-level lock to prevent concurrent hash chain generation
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockId]);
    return insertEvent(trx, data, organizationId, userId);
  });

  // Invalidate only after commit: a rolled-back write must not evict a valid
  // cached trace, and a pre-commit eviction can be repopulated with stale data.
  await Promise.all([
    ...lotIds.map(lotId => invalidateTraceCache(organizationId, lotId)),
    enqueueComplianceGapAlert(complianceGapAlert, organizationId),
  ]);

  return event;
};

const getEvents = async (query, organizationId) => {
  const { page, limit, eventType, status, locationId, lotId, dateFrom, dateTo } = query;
  const offset = (page - 1) * limit;

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
  if (locationId) queryBuilder = queryBuilder.where({ location_id: locationId });
  if (dateFrom) queryBuilder = queryBuilder.where('event_datetime', '>=', dateFrom);
  if (dateTo) queryBuilder = queryBuilder.where('event_datetime', '<=', dateTo);

  const [countResult] = await queryBuilder.clone().count('events.id as count');
  const total = parseInt(countResult.count, 10);

  const events = await queryBuilder
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
      ) as lot_links`)
    )
    // created_at is the transaction start time and can tie under concurrency.
    // chain_seq is unique per organization, so it makes pagination stable.
    .orderBy([
      { column: 'events.created_at', order: 'desc' },
      { column: 'events.chain_seq', order: 'desc' },
    ])
    .limit(limit)
    .offset(offset);

  return {
    data: events,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    }
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
  const { voided, linkedLotIds } = await db.transaction(async (trx) => {
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

    const links = await trx('event_lot_links')
      .where({ event_id: eventId })
      .select('lot_id');

    return {
      voided: updated,
      linkedLotIds: [...new Set(links.map(link => link.lot_id))],
    };
  });

  // Invalidate only after commit so a rolled-back void cannot evict a valid
  // cached trace (P1-23). Linked lots cover every trace that can contain this
  // event directly; upstream lots remain P1-19.
  await Promise.all(
    linkedLotIds.map(lotId => invalidateTraceCache(organizationId, lotId))
  );

  return voided;
};

const amendEvent = async (eventId, data, organizationId, userId) => {
  const lockId = getAdvisoryLockId(organizationId);

  // One transaction, one connection: the replacement row, the status change on
  // the superseded row, and its signed evidence all commit together or not at
  // all (P0-04). Lock order is fixed: organization advisory lock, then row lock.
  const { replacement, lotIds, complianceGapAlert } = await db.transaction(async (trx) => {
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

    const oldLotIds = (await trx('event_lot_links')
      .where({ event_id: eventId })
      .select('lot_id')).map(link => link.lot_id);

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
      // The superseded event's lots can differ from the replacement's, so both
      // sets need invalidation or the old graph survives its 5-minute TTL.
      lotIds: [...new Set([...oldLotIds, ...created.lotIds])],
      complianceGapAlert: created.complianceGapAlert,
    };
  });

  // After commit only, so a rolled-back amendment cannot evict a valid cache
  // and cannot email an alert for an event that never committed.
  await Promise.all([
    ...lotIds.map(lotId => invalidateTraceCache(organizationId, lotId)),
    enqueueComplianceGapAlert(complianceGapAlert, organizationId),
  ]);

  return replacement;
};

const generateAttachmentUploadUrl = async (eventId, organizationId, filename, contentType) => {
  // We can inject storage require here or at the top. Let's do it here to avoid circular dep if any, though it's clean at top.
  const { generatePresignedUploadUrl } = require('../../lib/storage');
  
  // Verify event belongs to org
  const event = await db('events').where({ id: eventId, organization_id: organizationId }).first();
  if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

  const key = `attachments/org_${organizationId}/events/${eventId}/${Date.now()}_${filename.replace(/\s+/g, '_')}`;
  
  const uploadUrl = await generatePresignedUploadUrl(key, contentType);
  return { uploadUrl, key };
};

const addAttachment = async (eventId, data, organizationId, userId) => {
  return db.transaction(async (trx) => {
    const event = await trx('events')
      .where({ id: eventId, organization_id: organizationId })
      .forUpdate()
      .first();
    if (!event) throw new AppError('Event not found', 'NOT_FOUND', 404);

    const [attachment] = await trx('attachments').insert({
      organization_id: organizationId,
      parent_type: 'event',
      parent_id: eventId,
      storage_key: data.key,
      filename: data.filename,
      content_type: data.contentType,
      size_bytes: data.sizeBytes,
      uploaded_by: userId,
    }).returning('*');

    // Attachment metadata is added after the event is sealed. Bind it to the
    // event hash with signed evidence so a later edit or deletion is detectable.
    await appendEventEvidence(trx, {
      organizationId,
      eventId,
      kind: 'attachment_added',
      payload: {
        attachmentId: attachment.id,
        storageKey: attachment.storage_key,
        filename: attachment.filename,
        contentType: attachment.content_type,
        sizeBytes: attachment.size_bytes,
        uploadedBy: attachment.uploaded_by,
        attachmentCreatedAt: new Date(attachment.created_at).toISOString(),
      },
    }, event.record_hash);

    return attachment;
  });
};

module.exports = {
  createEvent,
  getEvents,
  getEventById,
  voidEvent,
  amendEvent,
  generateAttachmentUploadUrl,
  addAttachment,
};
