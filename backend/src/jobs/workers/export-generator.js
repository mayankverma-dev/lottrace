const { Worker } = require('bullmq');
const { connection } = require('../queues');
const { processExport } = require('./export-processor');
const logger = require('../../utils/logger');

const exportWorker = new Worker(
  'export-queue',
  async (job) => {
    logger.info({ jobId: job.id, exportId: job.data.exportId }, 'Processing export job');
    return processExport(job.data.exportId, { organizationId: job.data.organizationId });
  },
  { connection, concurrency: 2 },
);

exportWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Export job failed');
});

exportWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Export job completed');
});

module.exports = exportWorker;
