const fs = require('fs');

const TRUE_VALUES = ['true', '1'];
const FALSE_VALUES = ['false', '0'];
const INSECURE_ENVIRONMENTS = new Set(['development', 'test']);
const SSL_MODES = new Set([
  'disable',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
  'no-verify',
]);
const SSL_QUERY_KEYS = [
  'sslmode',
  'ssl',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'uselibpqcompat',
];

/**
 * Parses an explicit boolean value. Never applies JavaScript truthiness.
 *
 * @param {string|boolean|undefined|null} value
 * @param {string} name
 * @returns {boolean}
 */
const parseBoolean = (value, name) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || String(value).trim() === '') return false;

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.includes(normalized)) return true;
  if (FALSE_VALUES.includes(normalized)) return false;

  throw new Error(`${name} must be one of: true, false, 1, 0`);
};

/**
 * Normalizes an inline PEM value. Accepts literal newlines and escaped `\n`.
 *
 * @param {string} value
 * @returns {string}
 */
const normalizePem = (value) => String(value).replace(/\\n/g, '\n').trim();

/**
 * Reads a PEM file and wraps filesystem errors with the path.
 *
 * @param {string} filePath
 * @param {string} label
 * @param {(path: string, encoding: string) => string} [readFile]
 * @returns {string}
 */
const readPemFile = (filePath, label, readFile = fs.readFileSync) => {
  try {
    return normalizePem(readFile(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Unable to read ${label} file "${filePath}": ${err.message}`);
  }
};

/**
 * Validates and normalizes a PostgreSQL URL.
 *
 * @param {string} databaseUrl
 * @returns {URL}
 */
const parseDatabaseUrl = (databaseUrl) => {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`Unsupported database protocol "${url.protocol}"`);
  }

  return url;
};

/**
 * Removes SSL-only query parameters. The explicit `ssl` object is passed to
 * `pg` separately, so leaving these parameters in the URL would let
 * `pg-connection-string` override it.
 *
 * @param {string} databaseUrl
 * @returns {string}
 */
const sanitizeDatabaseUrl = (databaseUrl) => {
  const url = parseDatabaseUrl(databaseUrl);
  SSL_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
  return url.toString();
};

/**
 * Resolves the Knex/pg connection object and TLS metadata from environment
 * values. No database connection is opened here.
 *
 * @param {object} [options]
 * @param {string} [options.databaseUrl]
 * @param {string} [options.nodeEnv]
 * @param {string|boolean} [options.tlsInsecure]
 * @param {string} [options.sslCa]
 * @param {string} [options.sslCaPath]
 * @param {(path: string, encoding: string) => string} [options.readFile]
 * @returns {{
 *   connection: string|{ connectionString: string, ssl: object },
 *   tls: {
 *     enabled: boolean,
 *     rejectUnauthorized: boolean,
 *     insecure: boolean,
 *     caConfigured: boolean,
 *     certConfigured: boolean,
 *     mode: string,
 *   },
 * }}
 */
const buildDatabaseConnection = ({
  databaseUrl,
  nodeEnv = 'development',
  tlsInsecure,
  sslCa,
  sslCaPath,
  readFile = fs.readFileSync,
} = {}) => {
  const environment = String(nodeEnv || 'development').trim().toLowerCase();
  const insecure = parseBoolean(tlsInsecure, 'DB_TLS_INSECURE');

  if (insecure && !INSECURE_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `DB_TLS_INSECURE is only allowed when NODE_ENV is development or test (got "${environment}")`,
    );
  }

  const url = parseDatabaseUrl(databaseUrl);
  const sslModeRaw = url.searchParams.get('sslmode');
  const sslMode = sslModeRaw && sslModeRaw.trim() !== ''
    ? sslModeRaw.trim().toLowerCase()
    : null;

  if (sslMode && !SSL_MODES.has(sslMode)) {
    throw new Error(`Unsupported sslmode "${sslModeRaw}"`);
  }

  const sslFlagRaw = url.searchParams.get('ssl');
  const sslFlag = sslFlagRaw === null || sslFlagRaw.trim() === ''
    ? null
    : parseBoolean(sslFlagRaw, 'ssl');

  const sslRootCert = url.searchParams.get('sslrootcert');
  const sslCert = url.searchParams.get('sslcert');
  const sslKey = url.searchParams.get('sslkey');
  const libpqCompatRaw = url.searchParams.get('uselibpqcompat');
  const sslNegotiation = (url.searchParams.get('sslnegotiation') || '').trim().toLowerCase();

  if (libpqCompatRaw !== null && libpqCompatRaw.trim() !== '') {
    if (parseBoolean(libpqCompatRaw, 'uselibpqcompat')) {
      throw new Error('uselibpqcompat=true is not supported; use sslmode=verify-full');
    }
  }

  if (Boolean(sslCert) !== Boolean(sslKey)) {
    throw new Error('sslcert and sslkey must be provided together');
  }

  const modeDisables = sslMode === 'disable' || sslFlag === false;
  const modeEnables =
    ['prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'].includes(sslMode) ||
    sslFlag === true ||
    Boolean(sslRootCert || sslCert || sslKey) ||
    sslNegotiation === 'direct';

  if (modeDisables && modeEnables) {
    throw new Error('Conflicting SSL settings in DATABASE_URL');
  }

  let sslEnabled = modeEnables || (!modeDisables && environment === 'production');
  if (modeDisables) sslEnabled = false;

  if (!sslEnabled && environment === 'production') {
    throw new Error(
      'TLS must be enabled in production; remove sslmode=disable/ssl=false or set an SSL URL',
    );
  }

  if (sslMode === 'no-verify' && !insecure) {
    throw new Error('sslmode=no-verify requires DB_TLS_INSECURE=true in development or test');
  }

  if (insecure && ['verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error(`DB_TLS_INSECURE cannot be combined with sslmode=${sslMode}`);
  }

  const caSources = [];
  if (sslCa && String(sslCa).trim() !== '') {
    caSources.push({ type: 'inline', value: String(sslCa) });
  }
  if (sslCaPath && String(sslCaPath).trim() !== '') {
    caSources.push({ type: 'path', value: String(sslCaPath).trim() });
  }
  if (sslRootCert && sslRootCert.trim() !== '') {
    caSources.push({ type: 'path', value: sslRootCert.trim() });
  }

  if (caSources.length > 1) {
    throw new Error(
      'Configure only one CA source: DB_SSL_CA, DB_SSL_CA_PATH, or sslrootcert',
    );
  }

  const ssl = sslEnabled ? { rejectUnauthorized: !insecure } : null;
  let caConfigured = false;
  let certConfigured = false;

  if (caSources.length === 1) {
    if (!sslEnabled) {
      throw new Error('CA configured but TLS is disabled');
    }

    const source = caSources[0];
    ssl.ca = source.type === 'inline'
      ? normalizePem(source.value)
      : readPemFile(source.value, 'CA', readFile);
    caConfigured = true;
  }

  if (sslCert && sslKey) {
    if (!sslEnabled) {
      throw new Error('Client certificate configured but TLS is disabled');
    }

    ssl.cert = readPemFile(sslCert, 'client certificate', readFile);
    ssl.key = readPemFile(sslKey, 'client key', readFile);
    certConfigured = true;
  }

  const sanitizedUrl = sanitizeDatabaseUrl(databaseUrl);
  const connection = sslEnabled
    ? { connectionString: sanitizedUrl, ssl }
    : sanitizedUrl;

  return {
    connection,
    tls: {
      enabled: sslEnabled,
      rejectUnauthorized: sslEnabled ? ssl.rejectUnauthorized : false,
      insecure,
      caConfigured,
      certConfigured,
      mode: sslMode || (sslFlag === true ? 'ssl=true' : sslFlag === false ? 'ssl=false' : environment === 'production' ? 'production-default' : 'off'),
    },
  };
};

module.exports = {
  buildDatabaseConnection,
  parseBoolean,
  readPemFile,
  sanitizeDatabaseUrl,
};
