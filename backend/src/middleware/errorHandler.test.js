/**
 * P1-13 regression tests — the global error handler must preserve the status
 * code carried by an operational AppError.
 *
 * The bug: `new AppError('...', 404)` put 404 in the `code` slot and left
 * `statusCode` undefined, so the handler produced a bare 500 instead of the
 * standard 404 envelope.
 */

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const AppError = require('../utils/AppError');
const errorHandler = require('./errorHandler');

/**
 * Builds a throwaway app that runs one handler and the real error handler.
 * @param {Function} handler
 * @returns {import('express').Express}
 */
const buildApp = (handler) => {
  const app = express();
  app.get('/test', handler);
  app.use(errorHandler);
  return app;
};

describe('errorHandler operational errors', () => {
  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'AUTH_REQUIRED'],
    [403, 'AUTH_FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'VALIDATION_ERROR'],
  ])('returns %i with code %s', async (statusCode, code) => {
    const app = buildApp(() => {
      throw new AppError('Something failed', code, statusCode);
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(statusCode);
    expect(res.body).toEqual({
      success: false,
      message: 'Something failed',
      error: { code },
    });
  });

  it('includes details when the AppError carries them', async () => {
    const details = [{ field: 'traceabilityLotCode', message: 'Lot code is required' }];
    const app = buildApp(() => {
      throw new AppError('Validation failed', 'VALIDATION_ERROR', 422, details);
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', details });
  });
});

describe('errorHandler other failures', () => {
  it('maps an unknown error to 500 INTERNAL_ERROR', async () => {
    const app = buildApp(() => {
      throw new Error('boom');
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('maps a unique constraint violation to 409 DUPLICATE_ENTRY', async () => {
    const app = buildApp(() => {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_ENTRY');
  });
});
