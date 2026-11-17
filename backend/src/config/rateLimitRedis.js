const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

// Rate limiting must never take the API down. This client fails commands
// immediately when Redis is unavailable so limiters can fail open instead of
// hanging. It is deliberately separate from the shared BullMQ client, which
// requires maxRetriesPerRequest: null.
const rateLimitRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
  commandTimeout: 2000,
});

rateLimitRedis.on('error', (err) => {
  logger.error({ err }, 'Rate-limit Redis connection error; rate limiting fails open');
});

module.exports = rateLimitRedis;
