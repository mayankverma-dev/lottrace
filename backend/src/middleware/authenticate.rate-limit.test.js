jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));
jest.mock('../config/env', () => ({ ACCESS_JWT_SECRET: 'test-access-secret' }));
jest.mock('../config/rateLimitRedis', () => ({ get: jest.fn() }));
jest.mock('./rateLimiter', () => ({ userLimiter: jest.fn() }));
jest.mock('../utils/apiResponse', () => ({
  unauthorized: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

const jwt = require('jsonwebtoken');
const redis = require('../config/rateLimitRedis');
const logger = require('../utils/logger');
const apiResponse = require('../utils/apiResponse');
const { userLimiter } = require('./rateLimiter');
const authenticate = require('./authenticate');

const VALID_HEADERS = { authorization: 'Bearer access-token' };
const DECODED = { sub: 'user-1', orgId: 'org-1', role: 'operator' };

describe('authenticate per-user rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
    userLimiter.mockImplementation((_req, _res, next) => next());
  });

  it('applies userLimiter after a valid token sets req.user', async () => {
    jwt.verify.mockReturnValue(DECODED);
    userLimiter.mockImplementationOnce((req, _res, next) => {
      expect(req.user).toEqual({
        id: 'user-1',
        organizationId: 'org-1',
        role: 'operator',
      });
      next();
    });

    const req = { headers: VALID_HEADERS };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(redis.get).toHaveBeenCalledWith('bl_access-token');
    expect(jwt.verify).toHaveBeenCalledWith('access-token', 'test-access-secret');
    expect(userLimiter).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not apply userLimiter when the authorization header is missing', async () => {
    const req = { headers: {} };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(apiResponse.unauthorized).toHaveBeenCalledWith(
      res,
      'AUTH_REQUIRED',
      'Missing or invalid authorization header'
    );
    expect(redis.get).not.toHaveBeenCalled();
    expect(userLimiter).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not apply userLimiter when the token is blacklisted', async () => {
    redis.get.mockResolvedValue('1');

    const req = { headers: VALID_HEADERS };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(apiResponse.unauthorized).toHaveBeenCalledWith(
      res,
      'AUTH_SESSION_REVOKED',
      'Token has been revoked'
    );
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(userLimiter).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the blacklist cannot be checked', async () => {
    redis.get.mockRejectedValue(new Error('redis unavailable'));

    const req = { headers: VALID_HEADERS };
    const res = { set: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.set).toHaveBeenCalledWith('Retry-After', '5');
    expect(apiResponse.error).toHaveBeenCalledWith(
      res,
      'Authentication temporarily unavailable',
      'AUTH_UNAVAILABLE',
      503
    );
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Token blacklist lookup failed; denying request'
    );
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(userLimiter).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not apply userLimiter when the token is invalid', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });

    const req = { headers: VALID_HEADERS };
    const res = {};
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(apiResponse.unauthorized).toHaveBeenCalledWith(
      res,
      'AUTH_TOKEN_EXPIRED',
      'Token is invalid or expired'
    );
    expect(userLimiter).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
