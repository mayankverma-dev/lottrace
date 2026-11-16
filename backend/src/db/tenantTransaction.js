const db = require('./knex');
const { runWithTenantTransaction } = require('./tenantContext');

const withTenantTransaction = (organizationId, callback) => db.transaction(async (transaction) => {
  await transaction.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', organizationId]);
  return runWithTenantTransaction(transaction, () => callback(transaction));
});

module.exports = { withTenantTransaction };
