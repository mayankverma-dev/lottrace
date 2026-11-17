const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/rateLimitRedis');

const { ipKeyGenerator } = rateLimit;

/**
 * Hashes a key component so raw emails and tokens never appear in Redis keys.
 * This is key hygiene, not a secrecy boundary: Redis is trusted infrastructure.
 *
 * @param {string} value
 * @returns {string}
 */
const hashKeyPart = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Normalizes an IP through express-rate-limit's helper so IPv6 clients are
 * grouped by /56 instead of receiving a fresh bucket per address.
 *
 * @param {Object} req
 * @returns {string}
 */
const clientIpKey = (req) => ipKeyGenerator(req.ip || 'unknown');

const createStore = (prefix) =>
  new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });

const apiKeyGenerator = (req) => `ip:${clientIpKey(req)}`;

/**
 * Auth attempts are keyed by the normalized email plus the client IP. Refresh
 * and logout have no email, so they fall back to the refresh-token hash. Reset
 * and invite flows use the body token hash. Requests with none of those use IP.
 *
 * @param {Object} req
 * @returns {string}
 */
const authKeyGenerator = (req) => {
  const ip = clientIpKey(req);

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email) return `email:${hashKeyPart(email)}:${ip}`;

  const refreshToken = req.cookies?.refreshToken;
  if (typeof refreshToken === 'string' && refreshToken) {
    return `refresh:${hashKeyPart(refreshToken)}:${ip}`;
  }

  const token = req.body?.token;
  if (typeof token === 'string' && token) {
    return `token:${hashKeyPart(token)}:${ip}`;
  }

  return `ip:${ip}`;
};

const userKeyGenerator = (req) =>
  req.user?.id ? `user:${req.user.id}` : `ip:${clientIpKey(req)}`;

const exportKeyGenerator = (req) =>
  req.user?.organizationId ? `org:${req.user.organizationId}` : `ip:${clientIpKey(req)}`;

// Coarse per-IP edge limiter. Authenticated traffic gets its own per-user
// bucket through userLimiter after authentication.
const apiLimiter = rateLimit({
  store: createStore('rl:api:'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'apiRateLimit', // prevent ERR_ERL_DOUBLE_COUNT
  passOnStoreError: true,
  keyGenerator: apiKeyGenerator,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Stricter limiter for auth routes (login, register, password reset). Keying by
// email/token instead of IP alone keeps separate accounts independent while
// still bounding attempts against one account from one client IP.
const authLimiter = rateLimit({
  store: createStore('rl:auth:'),
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'authRateLimit', // prevent ERR_ERL_DOUBLE_COUNT
  passOnStoreError: true,
  keyGenerator: authKeyGenerator,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
});

// Authenticated per-user limiter, invoked by authenticate after the JWT is
// verified. Keeps one user's traffic from consuming another user's bucket.
const userLimiter = rateLimit({
  store: createStore('rl:user:'),
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'userRateLimit', // prevent ERR_ERL_DOUBLE_COUNT
  passOnStoreError: true,
  keyGenerator: userKeyGenerator,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Per-organization export limiter. Exports are expensive and produce a full
// organization dataset, so they must not be cheap to repeat.
const exportLimiter = rateLimit({
  store: createStore('rl:export:'),
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'exportRateLimit',
  passOnStoreError: true,
  keyGenerator: exportKeyGenerator,
  message: {
    success: false,
    message: 'Too many export requests, please try again later.',
  },
});

module.exports = {
  apiLimiter,
  authLimiter,
  userLimiter,
  exportLimiter,
  apiKeyGenerator,
  authKeyGenerator,
  userKeyGenerator,
  exportKeyGenerator,
};
