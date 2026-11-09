/**
 * P2-11 regression tests — expected 4xx client errors must not be logged at
 * error level. A missing record or a foreign-tenant ID is normal traffic, not
 * an incident, and must not drown real server failures in the logs.
 */

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const logger = require('../utils/logger');
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('errorHandler logging', () => {
  it.each([400, 401, 403, 404, 409, 422])(
    'logs an operational %i as warn, not error',
    async (statusCode) => {
      const app = buildApp(() => {
        throw new AppError('Something failed', 'SOME_CODE', statusCode);
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(statusCode);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Request failed'
      );
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it('keeps the response envelope for an operational 404', async () => {
    const app = buildApp(() => {
      throw new AppError('Notification not found', 'NOT_FOUND', 404);
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: 'Notification not found',
      error: { code: 'NOT_FOUND' },
    });
  });

  it('logs an operational 500 at error level', async () => {
    const app = buildApp(() => {
      throw new AppError('Downstream failed', 'INTERNAL_ERROR', 500);
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Request error'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs an unknown error at error level', async () => {
    const app = buildApp(() => {
      throw new Error('boom');
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a non-operational error carrying a 404 status at error level', async () => {
    const app = buildApp(() => {
      const err = new Error('unexpected');
      err.statusCode = 404;
      throw err;
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
