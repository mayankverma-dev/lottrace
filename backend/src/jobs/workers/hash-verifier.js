const { Worker } = require('bullmq');
const logger = require('../../utils/logger');
const { connection } = require('../queues');
const { verifyHashChain } = require('../hash-chain-verifier');

const worker = new Worker('hash-verify-queue', async (job) => {
  logger.info(`Processing hash verify job: ${job.id}`);
  const summary = await verifyHashChain();
  logger.info({ summary }, 'Hash verification finished');
  return summary;
}, { connection });

worker.on('failed', (job, err) => {
  logger.error({ err, jobId: job.id }, 'Hash verify job failed');
});

module.exports = worker;
