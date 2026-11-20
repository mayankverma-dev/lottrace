const knex = require('knex');
const env = require('../config/env');
const knexConfig = require('../../knexfile');
const { getTenantTransaction } = require('./tenantContext');

const environment = process.env.NODE_ENV || 'development';

/**
 * Knex singleton instance.
 * Import this wherever you need DB access:
 *   const db = require('../../db/knex');
 */
const runtimeConfig = {
  ...knexConfig[environment],
  ...(env.APP_DATABASE_URL ? { connection: env.APP_DATABASE_URL } : {}),
};
const baseDb = knex(runtimeConfig);

// Route request queries through the transaction that owns app.current_org_id.
// Non-request code continues using the base Knex instance.
const db = new Proxy(baseDb, {
  apply(target, thisArg, args) {
    const transaction = getTenantTransaction();
    return (transaction || target).apply(thisArg, args);
  },
  get(target, property, receiver) {
    const transaction = getTenantTransaction();
    if (!transaction || property === 'destroy') {
      return Reflect.get(target, property, receiver);
    }

    const value = transaction[property];
    return typeof value === 'function' ? value.bind(transaction) : value;
  },
});

module.exports = db;
