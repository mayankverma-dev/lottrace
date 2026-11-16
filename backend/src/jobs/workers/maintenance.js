const { Worker } = require('bullmq');
const { connection } = require('../queues');
const { purgeExpiredIdempotencyKeys } = require('../../utils/idempotency');
const { runExportCleanup } = require('../../modules/reports/reports.retention');
const logger = require('../../utils/logger');

/**
 * Maintenance worker. Jobs are short-lived housekeeping tasks; correctness
 * never depends on them running.
 */
const maintenanceWorker = new Worker(
  'maintenance-queue',
  async (job) => {
    if (job.name === 'idempotency_cleanup') {
      const deleted = await purgeExpiredIdempotencyKeys();
      logger.info({ deleted }, 'Purged expired idempotency keys');
      return { deleted };
    }

    if (job.name === 'export_cleanup') {
      const result = await runExportCleanup();
      logger.info(result, 'Purged expired report exports');
      return result;
    }

    throw new Error(`Unknown maintenance job: ${job.name}`);
  },
  { connection },
);

module.exports = maintenanceWorker;
