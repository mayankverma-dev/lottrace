/* eslint-disable no-console */
const readline = require('readline/promises');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
const SEED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

const normalizeHost = (hostname = '') =>
  String(hostname).trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

const isTruthy = (value) =>
  value === true ||
  (typeof value === 'string' && ['true', '1'].includes(value.trim().toLowerCase()));

/**
 * Parses DATABASE_URL into the target shown to the operator.
 * Never returns or logs credentials.
 *
 * @param {string} databaseUrl
 * @returns {{ host: string, port: number, database: string, protocol: string }}
 */
const parseDatabaseTarget = (databaseUrl) => {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new Error('Refusing to seed: DATABASE_URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl.trim());
  } catch {
    throw new Error('Refusing to seed: DATABASE_URL is not a valid URL.');
  }

  if (!SEED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Refusing to seed: unsupported database protocol "${parsed.protocol}".`);
  }

  const host = normalizeHost(parsed.hostname);
  if (!host) {
    throw new Error('Refusing to seed: DATABASE_URL must include a host.');
  }

  let database;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Refusing to seed: DATABASE_URL contains invalid percent-encoding.');
  }
  if (!database) {
    throw new Error('Refusing to seed: DATABASE_URL must include a database name.');
  }

  return {
    host,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
    protocol: parsed.protocol,
  };
};

const isLocalHost = (hostname) => LOCAL_HOSTS.has(normalizeHost(hostname));

const formatTarget = ({ database, host, port }) => `${database} @ ${host}:${port}`;

const promptForConfirmation = async (target) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Type the database name "${target.database}" to confirm: `);
    return answer.trim() === target.database;
  } finally {
    rl.close();
  }
};

/**
 * Fails closed before the seed touches the database.
 *
 * Local hosts run without extra flags. Remote hosts require an explicit
 * ALLOW_DESTRUCTIVE_SEED=true and either an interactive confirmation or
 * SEED_CONFIRM_REMOTE=true when stdin is not a TTY. Production always refuses.
 *
 * @param {object} [options]
 * @param {string} [options.nodeEnv]
 * @param {string} [options.databaseUrl]
 * @param {string} [options.allowDestructiveSeed]
 * @param {string} [options.confirmRemote]
 * @param {boolean} [options.isInteractive]
 * @param {(target: object) => Promise<boolean>} [options.confirm]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ host: string, port: number, database: string, protocol: string }>}
 */
const assertSeedAllowed = async ({
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
  allowDestructiveSeed = process.env.ALLOW_DESTRUCTIVE_SEED,
  confirmRemote = process.env.SEED_CONFIRM_REMOTE,
  isInteractive = Boolean(process.stdin.isTTY),
  confirm = promptForConfirmation,
  log = console.log,
} = {}) => {
  if (String(nodeEnv || '').toLowerCase() === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV=production. The seed is for local and test databases only.',
    );
  }

  const target = parseDatabaseTarget(databaseUrl);
  log(`Seed target: ${formatTarget(target)}`);

  if (isLocalHost(target.host)) {
    return target;
  }

  if (!isTruthy(allowDestructiveSeed)) {
    throw new Error(
      `Refusing to seed non-local database ${formatTarget(target)}. ` +
        'Set ALLOW_DESTRUCTIVE_SEED=true to opt in.',
    );
  }

  if (isTruthy(confirmRemote)) {
    return target;
  }

  if (!isInteractive) {
    throw new Error(
      `Refusing to seed non-local database ${formatTarget(target)} in a non-interactive shell. ` +
        'Set SEED_CONFIRM_REMOTE=true to confirm without a prompt.',
    );
  }

  const confirmed = await confirm(target);
  if (!confirmed) {
    throw new Error('Seed cancelled: confirmation did not match the target database name.');
  }

  return target;
};

module.exports = {
  LOCAL_HOSTS,
  parseDatabaseTarget,
  isLocalHost,
  formatTarget,
  assertSeedAllowed,
};
