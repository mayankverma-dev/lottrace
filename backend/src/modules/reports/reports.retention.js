const { v4: uuidv4 } = require('uuid');
const db = require('../../db/knex');
const { deleteObject } = require('../../lib/storage');
const logger = require('../../utils/logger');

const RETENTION_DAYS = 30;
const STUCK_AFTER_MINUTES = 60;
const CLEANUP_BATCH_SIZE = 500;

const createNotification = async (row) => {
  try {
    await db('notifications').insert({
      id: uuidv4(),
      organization_id: row.organization_id,
      user_id: row.requested_by,
      type: 'export_failed',
      title: 'Export failed',
      message: 'Your export timed out. Please request a new export.',
      link: `/reports/exports/${row.id}`,
      entity_type: 'report_export',
      entity_id: row.id,
    });
  } catch (err) {
    logger.warn({ err, exportId: row.id }, 'Failed to create export timeout notification');
  }
};

const failStuckExports = async ({
  now = new Date(),
  olderThanMinutes = STUCK_AFTER_MINUTES,
} = {}) => {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60 * 1000);

  const rows = await db('report_exports')
    .whereIn('status', ['queued', 'processing'])
    .andWhere('created_at', '<', cutoff)
    .update({
      status: 'failed',
      error: 'Export timed out',
      completed_at: now,
    })
    .returning(['id', 'organization_id', 'requested_by']);

  for (const row of rows) {
    await createNotification(row);
  }

  return rows.length;
};

const purgeExpiredExports = async ({
  now = new Date(),
  olderThanDays = RETENTION_DAYS,
} = {}) => {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  let deleted = 0;
  let objectsDeleted = 0;

  for (;;) {
    const rows = await db('report_exports')
      .whereIn('status', ['complete', 'failed'])
      .andWhere('created_at', '<', cutoff)
      .orderBy('created_at', 'asc')
      .limit(CLEANUP_BATCH_SIZE)
      .select('id', 'storage_key');

    if (!rows.length) break;

    for (const row of rows) {
      if (!row.storage_key) continue;

      try {
        await deleteObject(row.storage_key);
        objectsDeleted += 1;
      } catch (err) {
        logger.warn({ err, exportId: row.id }, 'Failed to delete expired export object');
      }
    }

    const ids = rows.map((row) => row.id);
    deleted += await db('report_exports').whereIn('id', ids).del();
  }

  return { deleted, objectsDeleted };
};

const runExportCleanup = async () => {
  const stuck = await failStuckExports();
  const { deleted, objectsDeleted } = await purgeExpiredExports();

  return { stuck, deleted, objectsDeleted };
};

module.exports = {
  RETENTION_DAYS,
  STUCK_AFTER_MINUTES,
  failStuckExports,
  purgeExpiredExports,
  runExportCleanup,
};
