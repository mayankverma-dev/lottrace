const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db/knex');
const { uploadFile } = require('../../lib/storage');
const logger = require('../../utils/logger');
const {
  EXPORT_BATCH_SIZE,
  contentTypeFor,
  extensionFor,
  csvHeader,
  serializeCsvBatch,
  serializeJsonBatch,
} = require('./export-format');

const EXPORT_TEMP_DIR = path.join(os.tmpdir(), 'lottrace-exports');

const getEventBatch = async (organizationId, afterChainSeq) => {
  let query = db('events')
    .where('events.organization_id', organizationId)
    .leftJoin('locations', 'events.location_id', 'locations.id')
    .leftJoin('users', 'events.recorded_by', 'users.id')
    .select(
      'events.*',
      'locations.name as location_name',
      db.raw("users.first_name || ' ' || users.last_name as recorded_by_name"),
      db.raw(`(
        SELECT json_agg(json_build_object(
          'id', lots.id,
          'traceabilityLotCode', lots.traceability_lot_code,
          'direction', ell.direction,
          'quantity', ell.quantity,
          'uom', ell.uom
        ))
        FROM event_lot_links ell
        JOIN lots ON lots.id = ell.lot_id
        WHERE ell.event_id = events.id
      ) as lot_links`),
    )
    .orderBy('events.chain_seq', 'asc')
    .limit(EXPORT_BATCH_SIZE);

  if (afterChainSeq != null) {
    query = query.where('events.chain_seq', '>', afterChainSeq);
  }

  return query;
};

const createNotification = async (record, type, title, message) => {
  try {
    await db('notifications').insert({
      id: uuidv4(),
      organization_id: record.organization_id,
      user_id: record.requested_by,
      type,
      title,
      message,
      link: `/reports/exports/${record.id}`,
      entity_type: 'report_export',
      entity_id: record.id,
    });
  } catch (err) {
    logger.warn({ err, exportId: record.id }, 'Failed to create export notification');
  }
};

const processExport = async (exportId) => {
  const record = await db('report_exports').where({ id: exportId }).first();

  if (!record) {
    throw new Error(`Report export ${exportId} not found`);
  }

  if (record.status === 'complete' || record.status === 'failed') {
    return { exportId, status: record.status, rowCount: record.row_count };
  }

  const [claimed] = await db('report_exports')
    .where({ id: exportId })
    .update({
      status: 'processing',
      started_at: db.fn.now(),
      completed_at: null,
      error: null,
    })
    .returning('*');

  if (!claimed) {
    throw new Error(`Report export ${exportId} could not be claimed`);
  }

  const extension = extensionFor(claimed.format);
  const filePath = path.join(EXPORT_TEMP_DIR, `${exportId}.${extension}`);
  const storageKey = `exports/org_${claimed.organization_id}/${exportId}.${extension}`;

  try {
    await fs.mkdir(EXPORT_TEMP_DIR, { recursive: true });

    if (claimed.format === 'csv') {
      await fs.writeFile(filePath, csvHeader());
    } else {
      await fs.writeFile(filePath, '[');
    }

    let afterChainSeq = null;
    let rowCount = 0;
    let isFirstJsonBatch = true;

    for (;;) {
      const events = await getEventBatch(claimed.organization_id, afterChainSeq);
      if (!events.length) break;

      const chunk = claimed.format === 'csv'
        ? serializeCsvBatch(events)
        : serializeJsonBatch(events, isFirstJsonBatch);

      await fs.appendFile(filePath, chunk);

      isFirstJsonBatch = false;
      rowCount += events.length;
      afterChainSeq = events[events.length - 1].chain_seq;
    }

    if (claimed.format === 'json') {
      await fs.appendFile(filePath, ']');
    }

    await uploadFile(storageKey, filePath, contentTypeFor(claimed.format));

    await db('report_exports')
      .where({ id: exportId, organization_id: claimed.organization_id })
      .update({
        status: 'complete',
        storage_key: storageKey,
        row_count: rowCount,
        completed_at: db.fn.now(),
        error: null,
      });

    await createNotification(
      claimed,
      'export_ready',
      'Export ready',
      `Your ${claimed.format.toUpperCase()} export is ready to download (${rowCount} events).`,
    );

    logger.info({ exportId, rowCount, format: claimed.format }, 'Export completed');

    return { exportId, status: 'complete', rowCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db('report_exports')
      .where({ id: exportId, organization_id: claimed.organization_id })
      .update({
        status: 'failed',
        error: message.slice(0, 2000),
        completed_at: db.fn.now(),
      });

    await createNotification(
      claimed,
      'export_failed',
      'Export failed',
      `Your ${claimed.format.toUpperCase()} export failed. Please request a new export.`,
    );

    logger.error({ err, exportId }, 'Export failed');
    throw err;
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
};

module.exports = {
  processExport,
};
