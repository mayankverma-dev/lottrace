const express = require('express');
const request = require('supertest');

jest.mock('../config/rateLimitRedis', () => ({ call: jest.fn() }));
jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  })),
}));

const {
  apiLimiter,
  authLimiter,
  userLimiter,
  exportLimiter,
} = require('./rateLimiter');

const APP_CASES = [
  ['apiLimiter', apiLimiter, null],
  ['authLimiter', authLimiter, null],
  ['userLimiter', userLimiter, (req) => { req.user = { id: 'user-1' }; }],
  ['exportLimiter', exportLimiter, (req) => { req.user = { organizationId: 'org-1' }; }],
];

describe('rate limiter store failures', () => {
  let errorSpy;

  beforeAll(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it.each(APP_CASES)('%s fails open when the store rejects', async (_name, limiter, setup) => {
    const app = express();
    app.use((req, _res, next) => {
      if (setup) setup(req);
      next();
    });
    app.use(limiter);
    app.get('/', (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('logs the store failure', () => {
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('allowing request without rate-limiting'),
      expect.any(Error)
    );
  });
});
