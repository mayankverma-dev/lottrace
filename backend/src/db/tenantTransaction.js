const db = require('./knex');
const logger = require('../utils/logger');
const {
  runTenantPostCommit,
  runWithTenantTransaction,
} = require('./tenantContext');

const withTenantTransaction = (organizationId, callback) => {
  const postCommit = [];

  return db.transaction(async (transaction) => {
    await transaction.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', organizationId]);
    return runWithTenantTransaction(transaction, () => callback(transaction), postCommit);
  }).then(async (result) => {
    await runTenantPostCommit(postCommit, (error) => {
      logger.error({ error }, 'Tenant post-commit callback failed');
    });
    return result;
  });
};

module.exports = { withTenantTransaction };
