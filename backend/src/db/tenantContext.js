const { AsyncLocalStorage } = require('node:async_hooks');

const tenantStorage = new AsyncLocalStorage();

const getTenantTransaction = () => tenantStorage.getStore()?.transaction || null;

/**
 * Register work that must run only after the tenant transaction commits.
 * Outside a tenant transaction the callback runs immediately, which keeps
 * direct service calls (tests, workers) working without middleware.
 * @param {() => Promise<void> | void} callback
 */
const addTenantPostCommit = (callback) => {
  const store = tenantStorage.getStore();
  if (!store) {
    return callback();
  }
  store.postCommit.push(callback);
  return undefined;
};

/**
 * Run every queued callback once, logging failures without aborting the rest.
 * @param {Array<() => Promise<void> | void>} postCommit
 * @param {(error: Error) => void} onError
 */
const runTenantPostCommit = async (postCommit, onError) => {
  for (const callback of postCommit.splice(0)) {
    try {
      await callback();
    } catch (error) {
      onError(error);
    }
  }
};

const runWithTenantTransaction = (transaction, callback, postCommit = []) =>
  tenantStorage.run({ transaction, postCommit }, callback);

module.exports = {
  addTenantPostCommit,
  getTenantTransaction,
  runTenantPostCommit,
  runWithTenantTransaction,
};
