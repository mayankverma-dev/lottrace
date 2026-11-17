const jwt = require('jsonwebtoken');
const env = require('../config/env');
const apiResponse = require('../utils/apiResponse');
const redis = require('../config/redis');
const { userLimiter } = require('./rateLimiter');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return apiResponse.unauthorized(res, 'AUTH_REQUIRED', 'Missing or invalid authorization header');
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    const isBlacklisted = await redis.get(`bl_${token}`);
    if (isBlacklisted) {
      return apiResponse.unauthorized(res, 'AUTH_SESSION_REVOKED', 'Token has been revoked');
    }

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
