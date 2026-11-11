/**
 * Optional Sentry integration. The client is initialized only when
 * `SENTRY_DSN` is configured, so local tests and dev runs need no DSN.
 */

let sentryClient = null;

/**
 * Initializes Sentry once.
 * @returns {Object|null} initialized client, or null when no DSN is configured
 */
const initSentry = () => {
  if (sentryClient) return sentryClient;

  const env = require('../config/env');
  if (!env.SENTRY_DSN) return null;

  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
  });
  sentryClient = Sentry;
  return sentryClient;
};

/**
 * Emits a Sentry event for a hash verification failure. Never throws.
 *
 * @param {{ organizationId: string, eventId: string, reason: string }} details
 * @returns {boolean} true when an event was captured
 */
const captureHashVerificationFailure = ({ organizationId, eventId, reason }) => {
  try {
    const client = sentryClient || initSentry();
    if (!client) return false;

    client.captureMessage('Hash chain verification failed', {
      level: 'error',
      tags: { organizationId, eventId, reason },
    });
    return true;
  } catch (_err) {
    return false;
  }
};

module.exports = {
  initSentry,
  captureHashVerificationFailure,
};
