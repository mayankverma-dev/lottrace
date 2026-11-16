const db = require('../../db/knex');
const { deleteObject } = require('../../lib/storage');
const logger = require('../../utils/logger');
const { notifyExportTimedOut } = require('./reports.notifications');

const RETENTION_DAYS = 30;
const STUCK_AFTER_MINUTES = 60;
const CLEANUP_BATCH_SIZE = 500;

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
    await notifyExportTimedOut(row);
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
  let objectsFailed = 0;
  const failedIds = [];

  for (;;) {
    let query = db('report_exports')
      .whereIn('status', ['complete', 'failed'])
      .andWhere('created_at', '<', cutoff)
      .orderBy('created_at', 'asc')
      .limit(CLEANUP_BATCH_SIZE)
      .select('id', 'storage_key');

    if (failedIds.length) {
      query = query.whereNotIn('id', failedIds);
    }

    const rows = await query;

    if (!rows.length) break;

    const deletableIds = [];

    for (const row of rows) {
      if (row.storage_key) {
        try {
          await deleteObject(row.storage_key);
          objectsDeleted += 1;
        } catch (err) {
          objectsFailed += 1;
          failedIds.push(row.id);
          logger.warn(
            { err, exportId: row.id },
            'Failed to delete expired export object; keeping row for the next run',
          );
          continue;
        }
      }

      deletableIds.push(row.id);
    }

    if (!deletableIds.length) break;

    deleted += await db('report_exports').whereIn('id', deletableIds).del();
  }

  return { deleted, objectsDeleted, objectsFailed };
};

const runExportCleanup = async () => {
  const stuck = await failStuckExports();
  const { deleted, objectsDeleted, objectsFailed } = await purgeExpiredExports();

  return { stuck, deleted, objectsDeleted, objectsFailed };
};

module.exports = {
  RETENTION_DAYS,
  STUCK_AFTER_MINUTES,
  failStuckExports,
  purgeExpiredExports,
  runExportCleanup,
};
