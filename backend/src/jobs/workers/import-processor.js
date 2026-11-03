const { Worker } = require('bullmq');
const { connection } = require('../queues');
const knex = require('../../db/knex');
const { s3 } = require('../../lib/storage');
const { uploadBuffer } = require('../../lib/storage');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const env = require('../../config/env');
const { parse } = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const {
  computeEventHash,
  buildCanonicalEventPayloadForWrite,
  CURRENT_HASH_VERSION,
} = require('../../utils/hashChain');
const { invalidateTraceCache } = require('../../modules/trace/trace.service');
const logger = require('../../utils/logger');
const crc32 = require('crc-32');

const BUCKET = env.S3_BUCKET || 'lottrace-dev';
const getAdvisoryLockId = (orgId) => Math.abs(crc32.str(orgId));

// ─── Required columns per CTE type ─────────────────────────
const REQUIRED_COLS = {
  creation: ['transaction_id', 'traceability_lot_code', 'product_name', 'quantity', 'uom', 'location_name', 'event_datetime'],
  receiving: ['transaction_id', 'traceability_lot_code', 'product_name', 'quantity', 'uom', 'location_name', 'event_datetime'],
  shipping: ['transaction_id', 'traceability_lot_code', 'product_name', 'quantity', 'uom', 'location_name', 'event_datetime'],
  transformation: ['transaction_id', 'direction', 'traceability_lot_code', 'product_name', 'quantity', 'uom', 'location_name', 'event_datetime'],
};

/**
 * Validate a single row based on CTE type.
 * Returns array of error strings (empty if valid).
 */
const validateRow = (row, cteType, rowNum) => {
  const errors = [];
  const required = REQUIRED_COLS[cteType];

  for (const col of required) {
    const val = (row[col] || '').trim();
    if (!val) {
      errors.push(`Row ${rowNum}: Missing required field '${col}'`);
    }
  }

  // Validate quantity is numeric
  const qtyVal = (row.quantity || '').trim();
  if (qtyVal && isNaN(Number(qtyVal))) {
    errors.push(`Row ${rowNum}: 'quantity' must be a number, got '${qtyVal}'`);
  }
  if (qtyVal && Number(qtyVal) <= 0) {
    errors.push(`Row ${rowNum}: 'quantity' must be positive`);
  }

  // Validate event_datetime is a valid date
  const dtVal = (row.event_datetime || '').trim();
  if (dtVal) {
    const parsed = new Date(dtVal);
    if (isNaN(parsed.getTime())) {
      errors.push(`Row ${rowNum}: 'event_datetime' is not a valid ISO date, got '${dtVal}'`);
    }
  }

  // For transformation, validate direction
  if (cteType === 'transformation') {
    const dir = (row.direction || '').trim().toLowerCase();
    if (dir && dir !== 'input' && dir !== 'output') {
      errors.push(`Row ${rowNum}: 'direction' must be 'input' or 'output', got '${dir}'`);
    }
  }

  return errors;
};

/**
 * Build a lookup cache for products and locations within an org.
 */
const buildLookupCaches = async (organizationId) => {
  const products = await knex('products')
    .where({ organization_id: organizationId, is_active: true })
    .select('id', 'name', 'default_uom', 'custom_kde_schema', 'is_ftl');

  const locations = await knex('locations')
    .where({ organization_id: organizationId, is_active: true })
    .select('id', 'name');

  const productMap = new Map();
  products.forEach(p => productMap.set(p.name.toLowerCase().trim(), p));

  const locationMap = new Map();
  locations.forEach(l => locationMap.set(l.name.toLowerCase().trim(), l));

  return { productMap, locationMap };
};

/**
 * Process a grouped event. 
 * Group is an array of { row, rowNum } sharing the same transaction_id.
 */
const processEventGroup = async (trx, group, trxId, cteType, organizationId, userId, productMap, locationMap, prevHash) => {
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

  const eventPayload = {
    eventType: cteType,
    locationId: location.id,
    eventDatetime: new Date(firstRow.event_datetime.trim()).toISOString(),
    source: 'import',
    kdePayload: {},
    counterpartyInfo: hasCounterparty ? counterpartyInfo : null,
    inputs: [],
    outputs: [],
  };

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

    // Determine direction
    let direction;
    if (cteType === 'creation') direction = 'output';
    else if (cteType === 'receiving') direction = 'input';
    else if (cteType === 'shipping') direction = 'output';
    else if (cteType === 'transformation') direction = row.direction.toLowerCase().trim();

    eventLotLinks.push({
      id: uuidv4(),
      event_id: eventId,
      lot_id: lot.id,
      direction,
      quantity,
      uom,
    });

    if (direction === 'input') {
      eventPayload.inputs.push({ lotId: lot.id, quantity, uom });
    } else {
      eventPayload.outputs.push({ lotId: lot.id, quantity, uom });
    }

    affectedLotIds.add(lot.id);
  }

  // 4. Compute Hash & Create Event
  const canonicalPayload = await buildCanonicalEventPayloadForWrite(trx, eventPayload);
  const recordHash = computeEventHash(canonicalPayload, prevHash);

  const [event] = await trx('events').insert({
    id: eventId,
    organization_id: organizationId,
    event_type: cteType,
    location_id: location.id,
    counterparty_info: hasCounterparty ? JSON.stringify(counterpartyInfo) : null,
    event_datetime: new Date(firstRow.event_datetime.trim()),
    recorded_by: userId,
    source: 'import',
    kde_payload: JSON.stringify({}),
    notes: (firstRow.notes || '').trim() || null,
    record_hash: recordHash,
    prev_hash: prevHash,
    hash_version: CURRENT_HASH_VERSION,
    status: 'active',
    idempotency_key: idempotencyKey,
  }).returning('*');

  // 5. Bulk insert links
  if (eventLotLinks.length > 0) {
    await trx('event_lot_links').insert(eventLotLinks);
  }

  // 6. Invalidate cache
  for (const lid of affectedLotIds) {
    try { await invalidateTraceCache(organizationId, lid); } catch (_) { /* non-fatal */ }
  }

  return event;
};

// ─── Worker Definition ──────────────────────────────────────
const importWorker = new Worker(
  'import-queue',
  async (job) => {
    const { importId, organizationId, storageKey, cteType, userId } = job.data;

    logger.info({ importId, cteType }, 'Starting import processing');

    // Mark as processing
    await knex('imports').where('id', importId).update({
      status: 'processing',
      started_at: knex.fn.now(),
    });

    try {
      // 1. Fetch CSV from S3
      const s3Response = await s3.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
      }));
      const stream = s3Response.Body;

      // 2. Parse all rows first
      const rows = [];
      const parser = stream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      }));

      for await (const record of parser) {
        rows.push(record);
      }

      if (rows.length === 0) {
        await knex('imports').where('id', importId).update({
          status: 'failed',
          total_rows: 0,
          valid_rows: 0,
          error_rows: 0,
          completed_at: knex.fn.now(),
        });
        return { status: 'empty' };
      }

      // 3. Build lookup caches
      const { productMap, locationMap } = await buildLookupCaches(organizationId);

      // 4. Validate all rows upfront and group by transaction_id
      const allErrors = [];
      const transactionGroups = new Map();

      rows.forEach((row, idx) => {
        const rowNum = idx + 2; // +2: 1-indexed + header row
        const rowErrors = validateRow(row, cteType, rowNum);
        if (rowErrors.length > 0) {
          allErrors.push(...rowErrors.map(msg => ({ row: rowNum, message: msg })));
        } else {
          const trxId = row.transaction_id.trim();
          if (!transactionGroups.has(trxId)) {
            transactionGroups.set(trxId, []);
          }
          transactionGroups.get(trxId).push({ row, rowNum });
        }
      });

      // Additional Validation: Transformations must have inputs and outputs
      if (cteType === 'transformation') {
        for (const [trxId, group] of transactionGroups.entries()) {
          const hasInput = group.some(item => item.row.direction.toLowerCase() === 'input');
          const hasOutput = group.some(item => item.row.direction.toLowerCase() === 'output');
          if (!hasInput || !hasOutput) {
            allErrors.push({ 
              row: group[0].rowNum, 
              message: `Transaction ${trxId} must have at least one 'input' row and one 'output' row for Transformation.` 
            });
            transactionGroups.delete(trxId);
          }
        }
      }

      // 5. Process valid groups — each in its own transaction for isolation
      let validGroupsCount = 0;
      const lockId = getAdvisoryLockId(organizationId);
      const groupEntries = Array.from(transactionGroups.entries());

      for (const [trxId, group] of groupEntries) {
        try {
          await knex.transaction(async (trx) => {
            // Acquire advisory lock for hash chain consistency
            await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockId]);

            // Get prev hash
            const prevEvent = await trx('events')
              .where({ organization_id: organizationId })
              .orderBy('created_at', 'desc')
              .first();
            const prevHash = prevEvent ? prevEvent.record_hash : 'GENESIS';

            await processEventGroup(trx, group, trxId, cteType, organizationId, userId, productMap, locationMap, prevHash);
          });

          validGroupsCount += group.length; // Count rows processed
        } catch (err) {
          // If a group fails, all its rows fail
          group.forEach(item => {
            allErrors.push({ row: item.rowNum, message: `Transaction ${trxId} Failed: ${err.message}` });
          });
        }

        // Update job progress
        const processed = validGroupsCount + allErrors.length;
        await job.updateProgress(Math.round((processed / rows.length) * 100));
      }

      // 6. Upload error report if errors exist
      let errorReportKey = null;
      if (allErrors.length > 0) {
        errorReportKey = `imports/org_${organizationId}/errors_${importId}.json`;
        await uploadBuffer(
          errorReportKey,
          Buffer.from(JSON.stringify(allErrors, null, 2)),
          'application/json'
        );
      }

      // 7. Determine final status
      const errorCount = allErrors.length;
      let finalStatus;
      if (validGroupsCount === 0 && errorCount > 0) {
        finalStatus = 'failed';
      } else if (errorCount > 0) {
        finalStatus = 'complete_with_errors';
      } else {
        finalStatus = 'complete';
      }

      // 8. Update import record
      await knex('imports').where('id', importId).update({
        status: finalStatus,
        total_rows: rows.length,
        valid_rows: validGroupsCount,
        error_rows: errorCount,
        error_report_key: errorReportKey,
        completed_at: knex.fn.now(),
      });

      // 9. Create notification for the user who started the import
      try {
        const statusLabel = finalStatus === 'complete' ? 'completed successfully'
          : finalStatus === 'complete_with_errors' ? 'completed with errors'
          : 'failed';

        await knex('notifications').insert({
          id: uuidv4(),
          organization_id: organizationId,
          user_id: userId,
          type: 'import_complete',
          title: 'Import ' + statusLabel,
          message: `Your ${cteType} CSV import "${job.data.storageKey.split('/').pop()}" ${statusLabel}. ${validGroupsCount} rows imported, ${errorCount} errors.`,
          link: `/imports`,
          entity_type: 'import',
          entity_id: importId,
        });
      } catch (notifErr) {
        logger.warn({ err: notifErr }, 'Failed to create import notification');
      }

      logger.info({ importId, finalStatus, validGroupsCount, errorCount }, 'Import processing complete');
      return { status: finalStatus, validCount: validGroupsCount, errorCount };

    } catch (err) {
      logger.error({ err, importId }, 'Import processing failed');
      await knex('imports').where('id', importId).update({
        status: 'failed',
        completed_at: knex.fn.now(),
      });
      throw err;
    }
  },
  {
    connection,
    concurrency: 2,
    limiter: { max: 5, duration: 60000 },
  }
);

importWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Import job failed');
});

importWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Import job completed');
});

module.exports = importWorker;
