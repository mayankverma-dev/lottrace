/**
 * P2-06 — local infrastructure credential safety.
 *
 * `docker-compose.yml` is local-only, but a developer can still copy its
 * credentials into a staging or production environment. These helpers reject
 * known development defaults and missing passwords before the API starts.
 *
 * Error messages name the offending variable, never the secret value.
 */

const DEFAULT_SECRETS = new Set([
  'admin',
  'admin123',
  'changeme',
  'change-me',
  'default',
  'dev',
  'letmein',
  'lottrace',
  'lottrace_app',
  'minioadmin',
  'password',
  'postgres',
  'qwerty',
  'redis',
  'root',
  'secret',
  'test',
  'welcome',
]);

const PROTECTED_ENVIRONMENTS = new Set(['staging', 'production']);

/**
 * Decodes a URL component without throwing on malformed percent-encoding.
 *
 * @param {string} value
 * @returns {string}
 */
const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch (_err) {
    return value;
  }
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
const isDefaultSecret = (value) => {
  if (typeof value !== 'string') return false;
  return DEFAULT_SECRETS.has(value.trim().toLowerCase());
};

/**
 * Inspects a connection URL for a missing or well-known password.
 *
 * @param {string} name
 * @param {string|undefined} raw
 * @param {string[]} issues
 */
const inspectUrlCredential = (name, raw, issues) => {
  if (typeof raw !== 'string' || raw.trim() === '') {
    issues.push(`${name} is missing`);
    return;
  }

  let url;
  try {
    url = new URL(raw);
  } catch (_err) {
    issues.push(`${name} is not a valid URL`);
    return;
  }

  if (!url.password) {
    issues.push(`${name} has no password`);
    return;
  }

  const password = safeDecode(url.password);
  const username = safeDecode(url.username);
  if (isDefaultSecret(password) || password.toLowerCase() === username.toLowerCase()) {
    issues.push(`${name} uses a default password`);
  }
};

/**
 * Returns every default or missing infrastructure credential in `env`.
 *
 * @param {Object} env
 * @returns {string[]}
 */
const findCredentialIssues = (env = {}) => {
  const issues = [];

  inspectUrlCredential('DATABASE_URL', env.DATABASE_URL, issues);
  inspectUrlCredential('REDIS_URL', env.REDIS_URL, issues);

  if (isDefaultSecret(env.S3_ACCESS_KEY_ID)) {
    issues.push('S3_ACCESS_KEY_ID uses a default value');
  }
  if (isDefaultSecret(env.S3_SECRET_ACCESS_KEY)) {
    issues.push('S3_SECRET_ACCESS_KEY uses a default value');
  }

  return issues;
};

/**
 * Fails startup in staging and production when infrastructure credentials are
 * missing or still set to a development default. Development and test are
 * allowed so the local compose stack keeps working.
 *
 * @param {Object} env
 * @throws {Error}
 */
const assertNoDefaultCredentials = (env) => {
  if (!PROTECTED_ENVIRONMENTS.has(env.NODE_ENV)) return;

  const issues = findCredentialIssues(env);
  if (issues.length > 0) {
    throw new Error(
      `Refusing to start in ${env.NODE_ENV} with default or missing infrastructure credentials: ${issues.join('; ')}`,
    );
  }
};

module.exports = {
  DEFAULT_SECRETS,
  isDefaultSecret,
  findCredentialIssues,
  assertNoDefaultCredentials,
};
