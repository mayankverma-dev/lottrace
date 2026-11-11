/**
 * Optional Sentry reporting must never break hash verification.
 */

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureMessage: jest.fn(),
}));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.ACCESS_JWT_SECRET = process.env.ACCESS_JWT_SECRET || 'a'.repeat(64);
process.env.REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET || 'b'.repeat(64);
process.env.ARGON2_SECRET = process.env.ARGON2_SECRET || 'c'.repeat(32);
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key';
process.env.HASH_CHAIN_KEY_ID = process.env.HASH_CHAIN_KEY_ID || 'test-k1';
process.env.HASH_CHAIN_SECRET = process.env.HASH_CHAIN_SECRET || 'd'.repeat(64);

describe('lib/sentry', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('stays inert when SENTRY_DSN is not configured', () => {
    delete process.env.SENTRY_DSN;

    const Sentry = require('@sentry/node');
    const sentry = require('./sentry');

    expect(sentry.initSentry()).toBeNull();
    expect(sentry.captureHashVerificationFailure({
      organizationId: 'org-1',
      eventId: 'event-1',
      reason: 'payload_mismatch',
    })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes once and captures a tagged message when configured', () => {
    process.env.SENTRY_DSN = 'https://public@example.test/1';

    const Sentry = require('@sentry/node');
    const sentry = require('./sentry');

    sentry.initSentry();
    sentry.initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.test/1',
      environment: 'test',
    }));

    expect(sentry.captureHashVerificationFailure({
      organizationId: 'org-1',
      eventId: 'event-1',
      reason: 'payload_mismatch',
    })).toBe(true);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Hash chain verification failed',
      {
        level: 'error',
        tags: { organizationId: 'org-1', eventId: 'event-1', reason: 'payload_mismatch' },
      },
    );
  });

  it('swallows a reporting failure', () => {
    process.env.SENTRY_DSN = 'https://public@example.test/1';

    const Sentry = require('@sentry/node');
    const sentry = require('./sentry');

    Sentry.init.mockImplementationOnce(() => {
      throw new Error('sentry down');
    });

    expect(() => sentry.captureHashVerificationFailure({
      organizationId: 'org-1',
      eventId: 'event-1',
      reason: 'payload_mismatch',
    })).not.toThrow();
    expect(sentry.captureHashVerificationFailure({
      organizationId: 'org-1',
      eventId: 'event-1',
      reason: 'payload_mismatch',
    })).toBe(true);
  });
});
