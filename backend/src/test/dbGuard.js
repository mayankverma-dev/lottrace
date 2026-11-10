/**
 * Safety guard for database-backed tests.
 *
 * These suites reset the public schema. They must never run against the Neon
 * database configured in backend/.env, so every DB test calls this first and
 * fails closed.
 *
 * @param {{ requiredSuffix?: string }} [options]
 * @returns {{ hostname: string, databaseName: string }}
 */
const assertLocalDatabase = ({ requiredSuffix = '_test' } = {}) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set when RUN_DB_TESTS=1');
  }

  const { hostname, pathname } = new URL(databaseUrl);
  const databaseName = pathname.replace(/^\//, '');

  if (hostname === 'neon.tech' || hostname.endsWith('.neon.tech')) {
    throw new Error(`Refusing to run database tests against Neon host "${hostname}"`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(`Refusing to run database tests against non-local host "${hostname}"`);
  }
  if (!new RegExp(`${requiredSuffix}$`).test(databaseName)) {
    throw new Error(
      `Refusing to run database tests against database "${databaseName}" (name must end with "${requiredSuffix}")`,
    );
  }

  return { hostname, databaseName };
};

/**
 * Logs the resolved target so every test run shows which database it touched.
 * @param {{ requiredSuffix?: string }} [options]
 */
const announceTarget = (options) => {
  const target = assertLocalDatabase(options);
  console.log(`[db-tests] target ${target.hostname}/${target.databaseName}`);
  return target;
};

module.exports = { assertLocalDatabase, announceTarget };
