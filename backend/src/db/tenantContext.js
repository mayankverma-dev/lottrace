const { AsyncLocalStorage } = require('node:async_hooks');

const tenantStorage = new AsyncLocalStorage();

const getTenantTransaction = () => tenantStorage.getStore()?.transaction || null;

const runWithTenantTransaction = (transaction, callback) =>
  tenantStorage.run({ transaction }, callback);

module.exports = { getTenantTransaction, runWithTenantTransaction };
