const { Worker } = require('bullmq');
const db = require('../../db/knex');
const logger = require('../../utils/logger');
const { connection } = require('../queues');
const emailService = require('../../utils/email');
const { withTenantTransaction } = require('../../db/tenantTransaction');

const processComplianceDigest = async () => {
  const organizations = await db('organizations').select('id', 'name');
  
  for (const org of organizations) {
    await withTenantTransaction(org.id, async () => {
      const [{ count }] = await db('events')
        .where({ organization_id: org.id, has_compliance_gaps: true, status: 'active' })
        .count('id as count');
      
    const openGapsCount = parseInt(count, 10);
    
      if (openGapsCount > 0) {
      // Find compliance managers
      const users = await db('users')
        .where({ organization_id: org.id, status: 'active' })
        .whereIn('role', ['compliance_manager']);
        
        for (const user of users) {
          await emailService.sendComplianceDigestEmail(user.email, org.name, openGapsCount);
        }
      }
    });
  }
};

const worker = new Worker('email-queue', async (job) => {
  const { type, data } = job.data;
  
  logger.info(`Processing email job: ${job.id}, type: ${type}`);
  
  if (type === 'verification_otp') {
    await emailService.sendVerificationEmail(data.email, data.otp, data.firstName);
  } else if (type === 'welcome') {
    await emailService.sendWelcomeEmail(data.email, data.firstName, data.organizationName);
  } else if (type === 'compliance_gap') {
    await emailService.sendComplianceGapEmail(
      data.email, 
      data.eventId, 
      data.locationName, 
      data.eventType, 
      data.timestamp, 
      data.gaps
    );
  } else if (type === 'compliance_digest') {
    await processComplianceDigest();
  } else {
    logger.warn(`Unknown email job type: ${type}`);
  }
}, { connection });

worker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id }, 'Email job failed');
});

module.exports = worker;
