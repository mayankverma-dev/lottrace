const { v4: uuidv4 } = require('uuid');
const db = require('../../db/knex');
const logger = require('../../utils/logger');

const createExportNotification = async (record, { type, title, message }) => {
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
    logger.warn({ err, exportId: record.id, type }, 'Failed to create export notification');
  }
};

const exportSubject = (record) => (
  record.type === 'audit' ? 'audit log export' : 'event export'
);

const notifyExportReady = (record, rowCount) => createExportNotification(record, {
  type: 'export_ready',
  title: 'Export ready',
  message: `Your ${record.format.toUpperCase()} ${exportSubject(record)} is ready to download (${rowCount} rows).`,
});

const notifyExportFailed = (record) => createExportNotification(record, {
  type: 'export_failed',
  title: 'Export failed',
  message: `Your ${record.format.toUpperCase()} ${exportSubject(record)} failed. Please request a new export.`,
});

const notifyExportTimedOut = (record) => createExportNotification(record, {
  type: 'export_failed',
  title: 'Export failed',
  message: 'Your export timed out. Please request a new export.',
});

module.exports = {
  notifyExportReady,
  notifyExportFailed,
  notifyExportTimedOut,
};
