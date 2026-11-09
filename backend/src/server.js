require('dotenv').config();

const logger = require('./utils/logger');

// Validate environment variables before anything else
// This will throw immediately if required vars are missing
const env = require('./config/env');

const app = require('./app');
const { startWorkers } = require('./jobs');

const PORT = env.PORT;
const HOST = '0.0.0.0'

const server = app.listen(PORT, HOST, () => {
  logger.info(
    { emailDryRun: env.EMAIL_DRY_RUN, emailOverride: Boolean(env.DEV_EMAIL_OVERRIDE) },
    `Server running on port ${PORT} in ${env.NODE_ENV} mode`
  );
  if (env.NODE_ENV === 'production' && env.EMAIL_DRY_RUN) {
    logger.warn('EMAIL_DRY_RUN is enabled in production — outbound email is suppressed');
  }
  startWorkers();
});

// ─── Graceful Shutdown ─────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Unhandled Errors ──────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled Promise rejection');
  // Let the process crash so the orchestrator can restart it
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

module.exports = server;
