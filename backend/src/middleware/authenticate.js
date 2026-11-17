const jwt = require('jsonwebtoken');
const env = require('../config/env');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const redis = require('../config/rateLimitRedis');
const { userLimiter } = require('./rateLimiter');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return apiResponse.unauthorized(res, 'AUTH_REQUIRED', 'Missing or invalid authorization header');
  }

  const token = authHeader.split(' ')[1];

  // Revocation checks must fail fast when Redis is unavailable. The shared
  // BullMQ client retries indefinitely (maxRetriesPerRequest: null), which
  // would leave requests hanging instead of returning a decision.
  let isBlacklisted;
  try {
    isBlacklisted = await redis.get(`bl_${token}`);
  } catch (err) {
    if (req.log && req.log.error) {
      req.log.error({ err }, 'Token blacklist lookup failed; denying request');
    } else {
      logger.error({ err }, 'Token blacklist lookup failed; denying request');
    }
    res.set('Retry-After', '5');
    return apiResponse.error(
      res,
      'Authentication temporarily unavailable',
      'AUTH_UNAVAILABLE',
      503
    );
  }

  if (isBlacklisted) {
    return apiResponse.unauthorized(res, 'AUTH_SESSION_REVOKED', 'Token has been revoked');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.ACCESS_JWT_SECRET);
  } catch (err) {
    return apiResponse.unauthorized(res, 'AUTH_TOKEN_EXPIRED', 'Token is invalid or expired');
  }

  req.user = {
    id: decoded.sub,
    organizationId: decoded.orgId,
    role: decoded.role,
  };

  // Apply the per-user limiter only after the token is verified, so rejected
  // requests cannot create buckets for arbitrary user IDs.
  return userLimiter(req, res, next);
};

module.exports = authenticate;
