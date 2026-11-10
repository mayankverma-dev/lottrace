const { Worker } = require('bullmq');
const db = require('../../db/knex');
const logger = require('../../utils/logger');
const { connection } = require('../queues');
const {
  HASH_VERSION,
  GENESIS_HASH,
  computeEventHash,
  loadEventHashPayload,
} = require('../../utils/hashChain');

const verifyHashChain = async ({ organizationId } = {}) => {
  const organizations = organizationId
    ? await db('organizations').where({ id: organizationId }).select('id', 'name')
    : await db('organizations').select('id', 'name');
  
  for (const org of organizations) {
    logger.info(`Starting hash verification for org: ${org.id}`);
    
    // Fetch events in chain order. chain_seq is the only total order for an
    // organization: created_at is the transaction start time and can be
    // inverted relative to the order in which hashes were chained (P0-02).
    const events = await db('events')
      .where({ organization_id: org.id })
      .orderBy('chain_seq', 'asc');
      
    let prevHash = GENESIS_HASH;
    let failedEvent = null;
    let failureMetadata = null;

    for (const event of events) {
      if (event.prev_hash !== prevHash) {
        failedEvent = event;
        failureMetadata = { reason: 'chain_link_mismatch' };
        break;
      }

      if (event.hash_version !== HASH_VERSION) {
        failedEvent = event;
        failureMetadata = {
          reason: 'unsupported_hash_version',
          expected_version: HASH_VERSION,
          found_version: event.hash_version,
        };
        break;
      }

      // Same canonical serializer as the write and import paths: the hash is
      // rebuilt from the persisted row and links, never from a request body
      // (P0-01).
      const payload = await loadEventHashPayload(db, event.id);
      const recordHash = computeEventHash(payload, prevHash);

      if (recordHash !== event.record_hash) {
        failedEvent = event;
        failureMetadata = { reason: 'payload_mismatch', expected: recordHash };
        break;
      }

      prevHash = recordHash;
    }

    if (failedEvent) {
      logger.error(`Hash verification failed for event ${failedEvent.id} in org ${org.id}`);
      await db('audit_log').insert({
        organization_id: org.id,
        actor_type: 'system',
        action: 'hash.verify_failed',
        entity_type: 'event',
        entity_id: failedEvent.id,
        metadata: JSON.stringify({
          ...failureMetadata,
          found: failedEvent.record_hash,
          prev_hash: failedEvent.prev_hash,
        }),
      });
    } else {
      logger.info(`Hash verification successful for org: ${org.id}`);
    }
  }
};

const worker = new Worker('hash-verify-queue', async (job) => {
  logger.info(`Processing hash verify job: ${job.id}`);
  await verifyHashChain();
}, { connection });

worker.on('failed', (job, err) => {
  logger.error({ err, jobId: job.id }, 'Hash verify job failed');
});

module.exports = worker;
module.exports.verifyHashChain = verifyHashChain;
