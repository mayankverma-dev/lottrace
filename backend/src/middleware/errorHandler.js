const logger = require('../utils/logger');

/**
 * Global error handler middleware — must be registered LAST.
 * Catches all errors that bubble up from route handlers.
 *
 * express-async-errors patches Express to catch async errors,
 * so no try/catch is needed in controllers.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  // Expected client errors are part of normal operation. Log them at warn so
  // real server failures stay visible at error level.
  if (err.isOperational && err.statusCode < 500) {
    logger.warn({ err, requestId: req.id }, 'Request failed');
  } else {
    logger.error({ err, requestId: req.id }, 'Request error');
  }

  // Knex: unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Resource already exists',
      error: { code: 'DUPLICATE_ENTRY' },
    });
  }

  // Knex: foreign key violation
  if (err.code === '23503') {
    return res.status(422).json({
      success: false,
      message: 'Referenced resource does not exist',
      error: { code: 'VALIDATION_ERROR' },
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: { code: 'AUTH_INVALID_TOKEN' },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
      error: { code: 'AUTH_TOKEN_EXPIRED' },
    });
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      error: { code: 'VALIDATION_ERROR', details },
    });
  }

  // Operational errors (thrown by app code intentionally via AppError)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      error: {
        code: err.code,
        ...(err.details && { details: err.details }),
      },
    });
  }

  // Unknown errors — don't leak internals in production
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  return res.status(500).json({
    success: false,
    message,
    error: { code: 'INTERNAL_ERROR' },
  });
};

module.exports = errorHandler;
