const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

// Create a global API rate limiter
const apiLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:api:', // unique prefix for global limiter
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  requestPropertyName: 'apiRateLimit', // prevent ERR_ERL_DOUBLE_COUNT
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

// Stricter rate limiter for auth routes (login, register, forgot-password)
const authLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:auth:', // unique prefix for auth limiter
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 50, // limit each IP to 50 requests per windowMs for auth routes
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'authRateLimit', // prevent ERR_ERL_DOUBLE_COUNT
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
});

// Per-organization export limiter. Exports are expensive and produce a full
// organization dataset, so they must not be cheap to repeat.
const exportLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:export:',
  }),
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'exportRateLimit',
  keyGenerator: (req) => req.user.organizationId,
  message: {
    success: false,
    message: 'Too many export requests, please try again later.',
  },
});

module.exports = {
  apiLimiter,
  authLimiter,
  exportLimiter
};
