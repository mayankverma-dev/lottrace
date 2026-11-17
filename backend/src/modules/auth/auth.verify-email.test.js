/**
 * P0-15 regression test — email verification must return tokens.
 *
 * Run only against a disposable local database whose name ends in `_test`:
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://.../lottrace_p015_test \
 *   npx jest --runInBand src/modules/auth/auth.verify-email.test.js
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

// The local .env does not define a refresh-token encryption key, and
// auth.service validates it on import. This suite needs a disposable value.
process.env.REFRESH_TOKEN_ENCRYPTION_KEY ||= 'p0-15-test-refresh-token-encryption-key';

if (RUN_DB_TESTS) {
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../../config/redis', () => {
  const store = new Map();
  return {
    set: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    get: jest.fn(async (key) => store.get(key) ?? null),
    del: jest.fn(async (key) => store.delete(key)),
    __store: store,
  };
});
jest.mock('../../jobs/queues', () => ({
  emailQueue: { add: jest.fn() },
}));

const path = require('path');
const { v4: uuid } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');
const PASSWORD = 'P0-15-password!';

describeDb('P0-15 email verification', () => {
  jest.setTimeout(120000);

  let db;
  let authService;
  let emailQueue;
  let redis;

  beforeAll(async () => {
    db = require('../../db/knex');
    authService = require('./auth.service');
    ({ emailQueue } = require('../../jobs/queues'));
    redis = require('../../config/redis');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    redis.__store.clear();
  });

  it('registers, verifies the OTP, and returns usable tokens', async () => {
    const email = `p0-15-${uuid()}@example.test`;

    const registration = await authService.register({
      firstName: 'Verify',
      lastName: 'Tester',
      email,
      password: PASSWORD,
      organizationName: `P0-15 Org ${uuid()}`,
    });

    expect(registration).toEqual({ requiresVerification: true, email });

    const verificationJob = emailQueue.add.mock.calls
      .map(([, job]) => job)
      .find((job) => job?.type === 'verification_otp');
    expect(verificationJob).toBeDefined();

    const otp = verificationJob.data.otp;
    expect(otp).toMatch(/^\d{6}$/);

    const verified = await authService.verifyEmail({ email, otp });

    expect(verified).toBeDefined();
    expect(verified.user.email).toBe(email);
    expect(verified.user.role).toBe('org_admin');
    expect(verified.user.organizationId).toBeDefined();
    expect(verified.accessToken).toEqual(expect.any(String));
    expect(verified.refreshToken).toEqual(expect.any(String));

    const user = await db('users').where({ email }).first();
    expect(user.status).toBe('active');
    expect(user.organization_id).toBe(verified.user.organizationId);
    expect(user.password_hash).toBeTruthy();

    const login = await authService.login({ email, password: PASSWORD });
    expect(login.accessToken).toEqual(expect.any(String));
  });

  it('rejects signup for an email with a pending invitation', async () => {
    const email = `p1-36-invited-${uuid()}@example.test`;
    const organizationId = uuid();

    await db('organizations').insert({
      id: organizationId,
      name: `P1-36 Org ${organizationId.slice(0, 8)}`,
      slug: `p1-36-${organizationId}`,
    });
    await db('users').insert({
      id: uuid(),
      organization_id: organizationId,
      first_name: 'Pending',
      last_name: 'Invite',
      email,
      role: 'operator',
      status: 'invited',
      invite_token_hash: 'a'.repeat(64),
      invite_expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(authService.register({
      firstName: 'Signup',
      lastName: 'Attempt',
      email,
      password: PASSWORD,
      organizationName: `P1-36 Signup Org ${uuid()}`,
    })).rejects.toMatchObject({
      code: 'EMAIL_INVITED',
      statusCode: 409,
      details: [{
        field: 'email',
        message: 'Use the invitation link that was sent to this address instead of signing up.',
      }],
    });

    const users = await db('users').where({ email });
    expect(users).toHaveLength(1);
    expect(users[0].status).toBe('invited');
    expect(users[0].organization_id).toBe(organizationId);
    expect(users[0].password_hash).toBeNull();
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(redis.__store.has(`signup:${email}`)).toBe(false);
  });
});
