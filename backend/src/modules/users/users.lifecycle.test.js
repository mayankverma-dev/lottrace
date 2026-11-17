/**
 * P1-12 regression tests — user lifecycle with globally unique email.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p112_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p112_test \
 *   npx jest --runInBand src/modules/users/users.lifecycle.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

// The local .env does not define a refresh-token encryption key, and
// auth.service validates it on import. This suite needs a disposable value.
process.env.REFRESH_TOKEN_ENCRYPTION_KEY ||= 'p1-12-test-refresh-token-encryption-key';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../../utils/email', () => ({
  sendInviteEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../config/redis', () => ({
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
}));
jest.mock('../../jobs/queues', () => ({
  emailQueue: { add: jest.fn() },
}));

const crypto = require('crypto');
const path = require('path');
const argon2 = require('argon2');
const { v4: uuid } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');
const PASSWORD = 'P1-12-password!';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const uniqueEmail = (label) => `p1-12-${label}-${uuid()}@example.test`;

describeDb('P1-12 user lifecycle with global email uniqueness', () => {
  jest.setTimeout(120000);

  let db;
  let usersService;
  let authService;
  let emailService;

  const createOrganization = async (label) => {
    const id = uuid();
    await db('organizations').insert({
      id,
      name: `P1-12 ${label}`,
      slug: `p1-12-${label}-${id.slice(0, 8)}`,
    });
    return id;
  };

  const createUser = async ({
    organizationId,
    email,
    status = 'active',
    passwordHash = null,
    inviteTokenHash = null,
    inviteExpiresAt = null,
  }) => {
    const [user] = await db('users')
      .insert({
        organization_id: organizationId,
        first_name: 'P1-12',
        last_name: 'Tester',
        email,
        password_hash: passwordHash,
        role: 'operator',
        status,
        invite_token_hash: inviteTokenHash,
        invite_expires_at: inviteExpiresAt,
      })
      .returning('*');
    return user;
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    usersService = require('./users.service');
    authService = require('../auth/auth.service');
    emailService = require('../../utils/email');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invites a new email with a fresh token', async () => {
    const organizationId = await createOrganization('invite');
    const email = uniqueEmail('invite');

    const user = await usersService.inviteUser(organizationId, {
      email,
      firstName: 'New',
      lastName: 'Operator',
      role: 'operator',
    });

    const row = await db('users').where({ email }).first();
    expect(user.status).toBe('invited');
    expect(row.status).toBe('invited');
    expect(row.invite_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(row.invite_expires_at).getTime())
      .toBeGreaterThan(Date.now() + 71 * 60 * 60 * 1000);
    expect(emailService.sendInviteEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendInviteEmail.mock.calls[0][0]).toBe(email);
  });

  it('rejects a second invite for the same organization', async () => {
    const organizationId = await createOrganization('same-org');
    const email = uniqueEmail('same-org');
    const data = { email, firstName: 'Same', lastName: 'Org', role: 'operator' };

    await usersService.inviteUser(organizationId, data);

    await expect(usersService.inviteUser(organizationId, data))
      .rejects.toMatchObject({ code: 'DUPLICATE_ENTRY', statusCode: 409 });
    expect(await db('users').where({ email })).toHaveLength(1);
  });

  it('rejects an active email owned by another organization', async () => {
    const ownerOrganizationId = await createOrganization('active-owner');
    const invitingOrganizationId = await createOrganization('active-other');
    const email = uniqueEmail('active-other');

    await createUser({ organizationId: ownerOrganizationId, email });

    await expect(usersService.inviteUser(invitingOrganizationId, {
      email,
      firstName: 'Other',
      lastName: 'Org',
      role: 'operator',
    })).rejects.toMatchObject({
      code: 'DUPLICATE_ENTRY',
      statusCode: 409,
      message: 'This email is already registered to an existing LotTrace account',
    });

    expect(await db('users').where({ email, organization_id: invitingOrganizationId })).toHaveLength(0);
    expect(emailService.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('returns EMAIL_DEACTIVATED for a deactivated user in the same organization', async () => {
    const organizationId = await createOrganization('deactivated-same');
    const email = uniqueEmail('deactivated-same');

    await createUser({ organizationId, email, status: 'deactivated' });

    await expect(usersService.inviteUser(organizationId, {
      email,
      firstName: 'Deactivated',
      lastName: 'Same',
      role: 'operator',
    })).rejects.toMatchObject({
      code: 'EMAIL_DEACTIVATED',
      statusCode: 409,
      details: [{ field: 'email', message: 'Reactivate the existing user in this organization.' }],
    });

    expect(await db('users').where({ email })).toHaveLength(1);
    expect(emailService.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('returns EMAIL_DEACTIVATED for a deactivated user in another organization', async () => {
    const ownerOrganizationId = await createOrganization('deactivated-owner');
    const invitingOrganizationId = await createOrganization('deactivated-other');
    const email = uniqueEmail('deactivated-other');

    await createUser({ organizationId: ownerOrganizationId, email, status: 'deactivated' });

    await expect(usersService.inviteUser(invitingOrganizationId, {
      email,
      firstName: 'Deactivated',
      lastName: 'Other',
      role: 'operator',
    })).rejects.toMatchObject({
      code: 'EMAIL_DEACTIVATED',
      statusCode: 409,
      details: [{
        field: 'email',
        message: 'The account must be reactivated by its organization before it can be invited.',
      }],
    });

    expect(await db('users').where({ email, organization_id: invitingOrganizationId })).toHaveLength(0);
    expect(emailService.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('reactivates a user who already has a password without sending an invite', async () => {
    const organizationId = await createOrganization('reactivate-active');
    const email = uniqueEmail('reactivate-active');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    const user = await createUser({
      organizationId,
      email,
      status: 'deactivated',
      passwordHash,
    });

    const result = await usersService.reactivateUser(organizationId, user.id);
    const row = await db('users').where({ id: user.id }).first();

    expect(result.status).toBe('active');
    expect(row.status).toBe('active');
    expect(row.password_hash).toBe(passwordHash);
    expect(emailService.sendInviteEmail).not.toHaveBeenCalled();

    const login = await authService.login({ email, password: PASSWORD });
    expect(login.accessToken).toBeDefined();
  });

  it('re-invites a deactivated user who never accepted the invitation', async () => {
    const organizationId = await createOrganization('reactivate-invited');
    const email = uniqueEmail('reactivate-invited');
    const oldToken = `old-${uuid()}`;

    const user = await createUser({
      organizationId,
      email,
      status: 'deactivated',
      passwordHash: null,
      inviteTokenHash: hashToken(oldToken),
      inviteExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const result = await usersService.reactivateUser(organizationId, user.id);
    const row = await db('users').where({ id: user.id }).first();

    expect(result.status).toBe('invited');
    expect(row.status).toBe('invited');
    expect(row.password_hash).toBeNull();
    expect(row.invite_token_hash).not.toBe(user.invite_token_hash);
    expect(new Date(row.invite_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(emailService.sendInviteEmail).toHaveBeenCalledTimes(1);

    await expect(authService.login({ email, password: PASSWORD }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    await expect(authService.acceptInvite({ token: oldToken, email, password: PASSWORD }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN', statusCode: 400 });

    const [, freshToken] = emailService.sendInviteEmail.mock.calls[0];
    const accepted = await authService.acceptInvite({ token: freshToken, email, password: PASSWORD });
    expect(accepted.accessToken).toBeDefined();
    expect((await db('users').where({ id: user.id }).first()).status).toBe('active');

    const login = await authService.login({ email, password: PASSWORD });
    expect(login.accessToken).toBeDefined();
  });

  it('rejects reactivation of a user who is not deactivated', async () => {
    const organizationId = await createOrganization('reactivate-conflict');
    const email = uniqueEmail('reactivate-conflict');
    const user = await createUser({ organizationId, email, status: 'active' });

    await expect(usersService.reactivateUser(organizationId, user.id))
      .rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('does not resend an invitation owned by another organization', async () => {
    const ownerOrganizationId = await createOrganization('resend-owner');
    const otherOrganizationId = await createOrganization('resend-other');
    const email = uniqueEmail('resend-other');
    const originalTokenHash = hashToken(`original-${uuid()}`);

    const user = await createUser({
      organizationId: ownerOrganizationId,
      email,
      status: 'invited',
      inviteTokenHash: originalTokenHash,
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(usersService.resendInvite(otherOrganizationId, user.id))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    const row = await db('users').where({ id: user.id }).first();
    expect(row.invite_token_hash).toBe(originalTokenHash);
    expect(emailService.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('enforces global unique email at the database layer', async () => {
    const firstOrganizationId = await createOrganization('unique-first');
    const secondOrganizationId = await createOrganization('unique-second');
    const email = uniqueEmail('unique');

    await createUser({ organizationId: firstOrganizationId, email });

    await expect(createUser({ organizationId: secondOrganizationId, email }))
      .rejects.toMatchObject({ code: '23505' });

    const index = await db('pg_indexes')
      .where({ schemaname: 'public', tablename: 'users', indexname: 'users_email_unique' })
      .first();
    expect(index).toBeDefined();
    expect(index.indexdef).toContain('UNIQUE');
  });
});
