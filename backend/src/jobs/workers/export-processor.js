const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const db = require('../../db/knex');
const { buildAuditLogQuery } = require('../../modules/audit/audit.service');
const { uploadFile } = require('../../lib/storage');
const logger = require('../../utils/logger');
const {
  notifyExportFailed,
  notifyExportReady,
} = require('../../modules/reports/reports.notifications');
const {
  EXPORT_BATCH_SIZE,
  EXPORT_LIMITS,
  EXPORT_LIMIT_ERROR_CODE,
  assertExportWithinLimits,
  contentTypeFor,
  extensionFor,
  csvHeader,
  auditCsvHeader,
  serializeCsvBatch,
  serializeAuditCsvBatch,
  serializeJsonBatch,
  serializeAuditJsonBatch,
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

const getAuditBatch = async (organizationId, filters, cursor) => {
  let query = buildAuditLogQuery(filters, organizationId)
    // pg decodes timestamptz to a millisecond Date, which both truncates the
    // exported value and makes the keyset re-read rows. Format the exact
    // microsecond value in SQL and use it for output and paging.
    .select(db.raw(
      `to_char(audit_log.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_iso`
    ))
    .orderBy('audit_log.created_at', 'asc')
    .orderBy('audit_log.id', 'asc')
    .limit(EXPORT_BATCH_SIZE);

  if (cursor) {
    query = query.whereRaw(
      '(audit_log.created_at, audit_log.id) > (?, ?)',
      [cursor.createdAt, cursor.id],
    );
  }

  return query;
};

const EXPORT_HANDLERS = {
  events: {
    csvHeader,
    fetchBatch: ({ organizationId, cursor }) => getEventBatch(organizationId, cursor),
    serializeCsv: serializeCsvBatch,
    serializeJson: serializeJsonBatch,
    nextCursor: (rows) => rows[rows.length - 1].chain_seq,
  },
  audit: {
    csvHeader: auditCsvHeader,
    fetchBatch: ({ organizationId, filters, cursor }) => (
      getAuditBatch(organizationId, filters, cursor)
    ),
    serializeCsv: serializeAuditCsvBatch,
    serializeJson: serializeAuditJsonBatch,
    nextCursor: (rows) => {
      const lastRow = rows[rows.length - 1];
      return { createdAt: lastRow.created_at_iso, id: lastRow.id };
    },
  },
};

const processExport = async (exportId, { limits = EXPORT_LIMITS } = {}) => {
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
      error_code: null,
    })
    .returning('*');

  if (!claimed) {
    throw new Error(`Report export ${exportId} could not be claimed`);
  }

  const handler = EXPORT_HANDLERS[claimed.type];
  if (!handler) {
    throw new Error(`Unsupported export type ${claimed.type}`);
  }

  const extension = extensionFor(claimed.format);
  const filePath = path.join(EXPORT_TEMP_DIR, `${exportId}.${extension}`);
  const storageKey = `exports/org_${claimed.organization_id}/${exportId}.${extension}`;

  try {
    await fs.mkdir(EXPORT_TEMP_DIR, { recursive: true });

    const header = claimed.format === 'csv' ? handler.csvHeader() : '[';
    await fs.writeFile(filePath, header);

    let cursor = null;
    let rowCount = 0;
    let bytesWritten = Buffer.byteLength(header);
    let isFirstJsonBatch = true;
    const closingBytes = claimed.format === 'json' ? 1 : 0;

    for (;;) {
      const rows = await handler.fetchBatch({
        organizationId: claimed.organization_id,
        filters: claimed.filters || {},
        cursor,
      });
      if (!rows.length) break;

      const chunk = claimed.format === 'csv'
        ? handler.serializeCsv(rows)
        : handler.serializeJson(rows, isFirstJsonBatch);
      const nextRowCount = rowCount + rows.length;
      const nextBytes = bytesWritten + Buffer.byteLength(chunk) + closingBytes;

      assertExportWithinLimits({ rowCount: nextRowCount, bytes: nextBytes, limits });

      await fs.appendFile(filePath, chunk);

      isFirstJsonBatch = false;
      rowCount = nextRowCount;
      bytesWritten += Buffer.byteLength(chunk);
      cursor = handler.nextCursor(rows);
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
        error_code: null,
      });

    await notifyExportReady(claimed, rowCount);

    logger.info({ exportId, rowCount, format: claimed.format, type: claimed.type }, 'Export completed');

    return { exportId, status: 'complete', rowCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db('report_exports')
      .where({ id: exportId, organization_id: claimed.organization_id })
      .update({
        status: 'failed',
        error: message.slice(0, 2000),
        error_code: err.code === EXPORT_LIMIT_ERROR_CODE ? EXPORT_LIMIT_ERROR_CODE : null,
        completed_at: db.fn.now(),
      });

    await notifyExportFailed(claimed);

    logger.error({ err, exportId }, 'Export failed');
    throw err;
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
};

module.exports = {
  processExport,
};
