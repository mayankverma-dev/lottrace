const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

// Shared fail-fast Redis client for rate limiting and token revocation
// checks. It is deliberately separate from the shared BullMQ client, which
// requires maxRetriesPerRequest: null.
//
// The very first connection must be allowed to queue commands: RedisStore
// loads its Lua scripts during app startup, before the socket is writable.
// Once the client is ready, the offline queue is disabled so request-path
// commands fail immediately instead of waiting for a reconnect. Limiters then
// fail open (passOnStoreError), while token revocation checks fail closed.
const rateLimitRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: true,
  commandTimeout: 2000,
});

rateLimitRedis.once('ready', () => {
  rateLimitRedis.options.enableOfflineQueue = false;
  logger.info('Rate-limit Redis ready; offline queue disabled');
});

rateLimitRedis.on('error', (err) => {
  logger.error({ err }, 'Rate-limit Redis connection error; rate limiting fails open');
});

module.exports = rateLimitRedis;
