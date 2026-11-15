const { v4: uuidv4 } = require('uuid');
const {
  HASH_VERSION,
  PENDING_RECORD_HASH,
  PENDING_HASH_KEY_ID,
  sealEventHash,
} = require('../../utils/hashChain');
const { assertLotsBelongToOrganization } = require('../../utils/tenantLots');
const { invalidateTraceCache } = require('../../modules/trace/trace.service');
const { checkComplianceGaps } = require('../../modules/events/compliance');
const { determineLinkDirection } = require('./import-direction');

/**
 * Process a grouped event.
 * Group is an array of { row, rowNum } sharing the same transaction_id.
 */
const processEventGroup = async (trx, group, trxId, cteType, organizationId, userId, productMap, locationMap, prevHash, chainSeq) => {
  const idempotencyKey = `import_${organizationId}_${trxId}`;

  // Check idempotency
  const existingEvent = await trx('events')
    .where({ idempotency_key: idempotencyKey, organization_id: organizationId })
    .first();

  if (existingEvent) {
    // Already processed, skip quietly or log
    return existingEvent;
  }

  const firstRow = group[0].row;

  // 1. Resolve Event Location
  const location = locationMap.get((firstRow.location_name || '').toLowerCase().trim());
  if (!location) throw new Error(`Location '${firstRow.location_name}' not found for transaction ${firstRow.transaction_id}`);

  // 2. Build Event Payload
  const counterpartyInfo = {};
  if (firstRow.counterparty_name) counterpartyInfo.name = firstRow.counterparty_name.trim();
  if (firstRow.counterparty_lot_code) counterpartyInfo.lotCode = firstRow.counterparty_lot_code.trim();
  const hasCounterparty = Object.keys(counterpartyInfo).length > 0;

  const eventId = uuidv4();
  const affectedLotIds = new Set();
  const eventLotLinks = [];

  // 3. Process each Lot in the group
  for (const item of group) {
    const { row } = item;
    const product = productMap.get((row.product_name || '').toLowerCase().trim());
    if (!product) throw new Error(`Product '${row.product_name}' not found in transaction ${firstRow.transaction_id}`);

    const tlc = row.traceability_lot_code.trim();
    const quantity = Number(row.quantity);
    const uom = (row.uom || product.default_uom || 'kg').trim();

    // Find or create lot
    let lot = await trx('lots')
      .where({
        organization_id: organizationId,
        product_id: product.id,
        traceability_lot_code: tlc,
      })
      .whereNot('status', 'void')
      .first();

    if (!lot) {
      [lot] = await trx('lots').insert({
        id: uuidv4(),
        organization_id: organizationId,
        product_id: product.id,
        traceability_lot_code: tlc,
        quantity,
        uom,
        created_by: userId,
      }).returning('*');
    }

    const direction = determineLinkDirection(cteType, row);

    eventLotLinks.push({
      id: uuidv4(),
      organization_id: organizationId,
      event_id: eventId,
      lot_id: lot.id,
      direction,
      quantity,
      uom,
    });

    affectedLotIds.add(lot.id);
  }

  // Same tenant guard as manual creation. Import resolves or creates lots in
  // this organization, so this is defense in depth before the link insert.
  await assertLotsBelongToOrganization(
    trx,
    eventLotLinks.map(link => link.lot_id),
    organizationId,
  );

  const complianceGaps = await checkComplianceGaps(trx, {
    kdePayload: {},
    inputs: eventLotLinks
      .filter(link => link.direction === 'input')
      .map(link => ({ lotId: link.lot_id })),
    outputs: eventLotLinks
      .filter(link => link.direction === 'output')
      .map(link => ({ lotId: link.lot_id })),
  }, organizationId);

  // 4. Create Event. The hash covers persisted values, so it is sealed after
  // the row and its links exist (P0-01).
  await trx('events').insert({
    id: eventId,
    organization_id: organizationId,
    event_type: cteType,
    location_id: location.id,
    counterparty_info: hasCounterparty ? JSON.stringify(counterpartyInfo) : null,
    event_datetime: new Date(firstRow.event_datetime.trim()),
    recorded_by: userId,
    source: 'import',
    kde_payload: JSON.stringify({}),
    compliance_gaps: complianceGaps ? JSON.stringify(complianceGaps) : null,
    notes: (firstRow.notes || '').trim() || null,
    record_hash: PENDING_RECORD_HASH,
    prev_hash: prevHash,
    chain_seq: chainSeq,
    hash_version: HASH_VERSION,
    hash_key_id: PENDING_HASH_KEY_ID,
    status: 'active',
    idempotency_key: idempotencyKey,
  });

  // 5. Bulk insert links
  if (eventLotLinks.length > 0) {
    await trx('event_lot_links').insert(eventLotLinks);
  }

  const sealedEvent = await sealEventHash(trx, eventId, prevHash);

  // 6. Invalidate cache
  for (const lid of affectedLotIds) {
    try { await invalidateTraceCache(organizationId, lid); } catch (_) { /* non-fatal */ }
  }

  return sealedEvent;
};

module.exports = { processEventGroup };
