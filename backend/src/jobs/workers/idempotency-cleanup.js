const { Worker } = require('bullmq');
const { connection } = require('../queues');
const { purgeExpiredIdempotencyKeys } = require('../../utils/idempotency');
const logger = require('../../utils/logger');

/**
 * Maintenance worker. Deletes expired HTTP idempotency rows. Correctness does
 * not depend on this job (the middleware ignores expired rows); it only keeps
 * the table bounded.
 */
const idempotencyCleanupWorker = new Worker(
  'maintenance-queue',
  async () => {
    const deleted = await purgeExpiredIdempotencyKeys();
    logger.info({ deleted }, 'Purged expired idempotency keys');
    return { deleted };
  },
  { connection },
);

module.exports = idempotencyCleanupWorker;
