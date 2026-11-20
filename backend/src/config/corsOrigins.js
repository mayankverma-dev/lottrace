const LOCAL_ENVIRONMENTS = new Set(['development', 'test']);

// Credentialed frontend requests use the same host the developer typed in the
// browser. `localhost` and `127.0.0.1` are different origins, so both must be
// allowed while developing locally.
const LOOPBACK_EQUIVALENTS = new Map([
  ['http://localhost:3001', 'http://127.0.0.1:3001'],
  ['http://localhost:3002', 'http://127.0.0.1:3002'],
  ['https://localhost:3001', 'https://127.0.0.1:3001'],
  ['https://localhost:3002', 'https://127.0.0.1:3002'],
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
const normalizeOrigin = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('CORS origin must be a non-empty string');
  }

  const origin = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/.test(origin)) {
    throw new Error(`Invalid CORS origin: ${value}`);
  }
  return origin;
};

/**
 * Resolves the exact allowlist for the `cors` middleware.
 *
 * Local environments accept both `localhost` and `127.0.0.1` variants of the
 * configured web/PWA origins. Staging and production accept only the
 * configured URLs — no loopback or wildcard entry can slip into a deploy.
 *
 * @param {{ NODE_ENV?: string, FRONTEND_URL?: string, SCAN_PWA_URL?: string }} env
 * @returns {string[]}
 */
const resolveCorsOrigins = (env = {}) => {
  const first = env.FRONTEND_URL === undefined ? 'http://localhost:3001' : env.FRONTEND_URL;
  const second = env.SCAN_PWA_URL === undefined ? 'http://localhost:3002' : env.SCAN_PWA_URL;
  const configured = [normalizeOrigin(first), normalizeOrigin(second)];

  if (!LOCAL_ENVIRONMENTS.has(env.NODE_ENV)) {
    return [...new Set(configured)];
  }

  const origins = [...configured];
  configured.forEach((origin) => {
    const equivalent = LOOPBACK_EQUIVALENTS.get(origin);
    if (equivalent) origins.push(equivalent);
  });

  return [...new Set(origins)];
};

module.exports = { resolveCorsOrigins };
