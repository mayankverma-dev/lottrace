/**
 * P1-11 regression tests — refresh rotation must survive concurrent callers.
 *
 * Run only against a disposable local database whose name ends in `_test`:
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://.../lottrace_p111_test \
 *   pnpm --filter backend test -- --runInBand src/modules/auth/auth.refresh.test.js
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  require('../../test/dbGuard').announceTarget();
}

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
const { v4: uuid } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-11 refresh-token rotation', () => {
  jest.setTimeout(120000);

  let db;
  let authService;

  const createSession = async () => {
    const organizationId = uuid();
    const userId = uuid();
    const rawRefreshToken = `refresh-${uuid()}`;
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const sessionFamily = uuid();

    await db('organizations').insert({
      id: organizationId,
      name: `P1-11 ${organizationId.slice(0, 8)}`,
      slug: `p1-11-${organizationId}`,
    });
    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'Refresh',
      last_name: 'Tester',
      email: `${userId}@example.test`,
      role: 'org_admin',
      status: 'active',
      password_hash: 'unused',
    });
    const [storedToken] = await db('refresh_tokens').insert({
      user_id: userId,
      token_hash: tokenHash,
      session_family: sessionFamily,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    }).returning('*');

    return { organizationId, userId, rawRefreshToken, sessionFamily, storedToken };
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    authService = require('./auth.service');
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('rotates a token once and links the replacement', async () => {
    const session = await createSession();

    const result = await authService.refresh({ refreshToken: session.rawRefreshToken });
    const source = await db('refresh_tokens').where({ id: session.storedToken.id }).first();
    const replacement = await db('refresh_tokens').where({ id: source.replaced_by_token_id }).first();

    expect(result.refreshToken).toBeDefined();
    expect(source.is_used).toBe(true);
    expect(source.rotated_at).toBeTruthy();
    expect(source.replacement_token_ciphertext).toBeTruthy();
    expect(replacement.session_family).toBe(session.sessionFamily);
  });

  it('does not fork the family under ten parallel refresh calls', async () => {
    const session = await createSession();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => authService.refresh({ refreshToken: session.rawRefreshToken }))
    );
    const rows = await db('refresh_tokens').where({ session_family: session.sessionFamily });

    expect(new Set(results.map((result) => result.refreshToken)).size).toBe(1);
    expect(rows).toHaveLength(2);
  });

  it('revokes the family when the old token is reused after grace', async () => {
    const session = await createSession();
    await authService.refresh({ refreshToken: session.rawRefreshToken });

    await db('refresh_tokens')
      .where({ id: session.storedToken.id })
      .update({ rotated_at: new Date(Date.now() - 11 * 1000) });

    await expect(authService.refresh({ refreshToken: session.rawRefreshToken }))
      .rejects.toMatchObject({ code: 'TOKEN_REUSE', statusCode: 401 });
    expect(await db('refresh_tokens').where({ session_family: session.sessionFamily })).toHaveLength(0);
  });
});
