const express = require('express');
const request = require('supertest');

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const AppError = require('../utils/AppError');
const errorHandler = require('./errorHandler');

/**
 * Builds a minimal Express app whose only route throws the supplied error.
 * @param {Error} err
 * @returns {import('express').Express}
 */
const buildApp = (err) => {
  const app = express();

  app.get('/boom', (_req, _res, next) => {
    next(err);
  });

  app.use(errorHandler);
  return app;
};

describe('errorHandler', () => {
  it.each([
    ['EMAIL_IN_USE', 400],
    ['AUTH_REQUIRED', 401],
    ['AUTH_FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
  ])('maps operational %s to HTTP %i with the standard envelope', async (code, statusCode) => {
    const app = buildApp(new AppError(`message-${code}`, code, statusCode));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(statusCode);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      success: false,
      message: `message-${code}`,
      error: { code },
    });
  });

  it('includes AppError details on a 422 response', async () => {
    const details = [{ field: 'id', message: 'Must be a valid ID' }];
    const app = buildApp(new AppError('Validation failed', 'VALIDATION_ERROR', 422, details));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: 'Validation failed',
      error: { code: 'VALIDATION_ERROR', details },
    });
  });

  it('returns 500 INTERNAL_ERROR for an unknown error', async () => {
    const app = buildApp(new Error('boom'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR' });
  });
});
