const { Worker } = require('bullmq');
const db = require('../../db/knex');
const logger = require('../../utils/logger');
const { connection } = require('../queues');
const { computeEventHash } = require('../../utils/hashChain');

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
      
    let prevHash = 'GENESIS';
    let failedEvent = null;
    let expectedHash = null;
    
    for (const event of events) {
      if (event.prev_hash !== prevHash) {
        failedEvent = event;
        break;
      }
      
      const links = await db('event_lot_links')
        .where({ event_id: event.id })
        .orderBy('lot_id', 'asc');
        
      const eventPayload = {
        eventType: event.event_type,
        locationId: event.location_id,
        eventDatetime: new Date(event.event_datetime).toISOString(),
        source: event.source,
        kdePayload: typeof event.kde_payload === 'string' ? JSON.parse(event.kde_payload) : event.kde_payload,
        counterpartyInfo: event.counterparty_info ? (typeof event.counterparty_info === 'string' ? JSON.parse(event.counterparty_info) : event.counterparty_info) : null,
        inputs: links.filter(l => l.direction === 'input').map(l => ({ lotId: l.lot_id, quantity: l.quantity, uom: l.uom })),
        outputs: links.filter(l => l.direction === 'output').map(l => ({ lotId: l.lot_id, quantity: l.quantity, uom: l.uom })),
      };
      
      const recordHash = computeEventHash(eventPayload, prevHash);
      if (recordHash !== event.record_hash) {
        failedEvent = event;
        expectedHash = recordHash;
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
        metadata: JSON.stringify({ expected: expectedHash, found: failedEvent.record_hash, prev_hash: failedEvent.prev_hash }),
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
