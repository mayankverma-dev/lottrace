/**
 * P2-30 — RedisStore script loading at boot must not hit a disabled offline
 * queue. The client queues commands until the first `ready`, then switches to
 * fail-fast behavior for request-path commands.
 */
jest.mock('ioredis', () => {
  const EventEmitter = require('node:events');

  class FakeRedis extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
    }
  }

  return FakeRedis;
});
jest.mock('./env', () => ({ REDIS_URL: 'redis://127.0.0.1:6379/0' }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const redis = require('./rateLimitRedis');
const logger = require('../utils/logger');

describe('P2-30 rate-limit Redis startup', () => {
  it('queues during the initial connection, then disables the offline queue', () => {
    expect(redis.options).toMatchObject({
      maxRetriesPerRequest: 0,
      enableOfflineQueue: true,
      commandTimeout: 2000,
    });

    redis.emit('ready');

    expect(redis.options.enableOfflineQueue).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      'Rate-limit Redis ready; offline queue disabled',
    );
  });
});
