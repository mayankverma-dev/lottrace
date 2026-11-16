const db = require('../../db/knex');
const { buildPagination } = require('../../utils/pagination');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { exportQueue } = require('../../jobs/queues');
const { generatePresignedDownloadUrl } = require('../../lib/storage');

const DOWNLOAD_URL_TTL_SECONDS = 300;

const toIsoString = (value) => (value ? new Date(value).toISOString() : null);

const toPublicExport = (record) => ({
  id: record.id,
  type: record.type,
  format: record.format,
  status: record.status,
  rowCount: record.row_count,
  error: record.status === 'failed' ? 'Export failed. Please request a new export.' : null,
  createdAt: toIsoString(record.created_at),
  startedAt: toIsoString(record.started_at),
  completedAt: toIsoString(record.completed_at),
  downloadAvailable: record.status === 'complete',
});

const getComplianceGaps = async (organizationId, { page = 1, limit = 50 } = {}) => {
  const offset = (page - 1) * limit;

  const [countResult] = await db('events')
    .where({ organization_id: organizationId, has_compliance_gaps: true })
    .count('id as total');

  const total = parseInt(countResult.total, 10);

  const gaps = await db('events')
    .where({ organization_id: organizationId, has_compliance_gaps: true })
    .orderBy('event_datetime', 'desc')
    .limit(limit)
    .offset(offset)
    .select(
      'id',
      'event_type',
      'event_datetime',
      'location_id',
      'compliance_gaps',
      'kde_payload',
      'created_at'
    );

  return {
    data: gaps,
    pagination: buildPagination(total, page, limit),
  };
};

const requestExport = async ({ format }, organizationId, userId) => {
  const [record] = await db('report_exports')
    .insert({
      organization_id: organizationId,
      requested_by: userId,
      type: 'events',
      format,
      status: 'queued',
    })
    .returning('*');

  try {
    await exportQueue.add('export-events', { exportId: record.id }, { jobId: record.id });
  } catch (err) {
    logger.error({ err, exportId: record.id }, 'Failed to enqueue export job');
    await db('report_exports')
      .where({ id: record.id, organization_id: organizationId })
      .update({
        status: 'failed',
        error: 'Failed to queue export',
        completed_at: db.fn.now(),
      });
    throw new AppError('Export queue unavailable', 'EXPORT_QUEUE_UNAVAILABLE', 503);
  }

  return toPublicExport(record);
};

const getExport = async (exportId, organizationId) => {
  const record = await db('report_exports')
    .where({ id: exportId, organization_id: organizationId })
    .first();

  if (!record) {
    throw new AppError('Export not found', 'NOT_FOUND', 404);
  }

  return toPublicExport(record);
};

const getExportDownload = async (exportId, organizationId) => {
  const record = await db('report_exports')
    .where({ id: exportId, organization_id: organizationId })
    .first();

  if (!record) {
    throw new AppError('Export not found', 'NOT_FOUND', 404);
  }

  if (record.status === 'failed') {
    throw new AppError('Export failed', 'EXPORT_FAILED', 409);
  }

  if (record.status !== 'complete' || !record.storage_key) {
    throw new AppError('Export is not ready', 'EXPORT_NOT_READY', 409);
  }

  const contentType = record.format === 'json' ? 'application/json' : 'text/csv';
  const filename = `lottrace-events-${record.id}.${record.format}`;
  const downloadUrl = await generatePresignedDownloadUrl(record.storage_key, {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    filename,
    contentType,
  });

  return {
    downloadUrl,
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    filename,
    contentType,
  };
};

module.exports = {
  getComplianceGaps,
  requestExport,
  getExport,
  getExportDownload,
};
