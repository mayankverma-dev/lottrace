const argon2 = require('argon2');
const knexFactory = require('knex');
const uuid = require('uuid');

const {
  MIN_PASSWORD_LENGTH,
  SUPER_ADMIN_EMAIL,
  SYSTEM_ORGANIZATION_SLUG,
  assertSeedingAllowed,
  generatePassword,
  isLocalDatabaseHost,
  parseDatabaseTarget,
  parseSeedFlag,
  resolvePasswordDecision,
  seedSuperAdmin,
} = require('./seed-super-admin');

jest.setTimeout(30000);

const LOCAL_DATABASE_URL = 'postgresql://user:secret@localhost:5432/lottrace';
const REMOTE_DATABASE_URL = 'postgresql://user:secret@db.example.com:5432/lottrace';

describe('seed target parsing', () => {
  it('parses a local target without exposing credentials', () => {
    const target = parseDatabaseTarget(LOCAL_DATABASE_URL);

    expect(target).toMatchObject({
      host: 'localhost',
      port: '5432',
      database: 'lottrace',
    });
    expect(target.display).toBe('localhost:5432/lottrace');
    expect(target.display).not.toContain('user');
    expect(target.display).not.toContain('secret');
  });

  it('normalizes IPv6 loopback brackets', () => {
    const target = parseDatabaseTarget('postgresql://user:secret@[::1]:5432/lottrace');

    expect(target.host).toBe('::1');
    expect(isLocalDatabaseHost(target.host)).toBe(true);
  });

  it('rejects a missing or malformed DATABASE_URL', () => {
    expect(() => parseDatabaseTarget()).toThrow(/DATABASE_URL is required/);
    expect(() => parseDatabaseTarget('not a url')).toThrow(/not a valid URL/);
    expect(() => parseDatabaseTarget('mysql://user:secret@localhost/lottrace')).toThrow(
      /postgres/
    );
  });
});

describe('seed opt-in flag parsing', () => {
  it.each(['true', 'TRUE', '1', ' true ', true])('treats %p as enabled', (value) => {
    expect(parseSeedFlag(value)).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'yes', '', false, null, undefined])(
    'treats %p as disabled',
    (value) => {
      expect(parseSeedFlag(value)).toBe(false);
    }
  );
});

describe('seed guard', () => {
  it('refuses production even for a local database', () => {
    expect(() =>
      assertSeedingAllowed({ databaseUrl: LOCAL_DATABASE_URL, nodeEnv: 'production' })
    ).toThrow(/NODE_ENV=production/);
  });

  it.each([
    ['localhost', 'postgresql://user:secret@localhost:5432/lottrace'],
    ['127.0.0.1', 'postgresql://user:secret@127.0.0.1:5432/lottrace'],
    ['::1', 'postgresql://user:secret@[::1]:5432/lottrace'],
    ['postgres', 'postgresql://user:secret@postgres:5432/lottrace'],
  ])('allows local host %s without confirmation', (_name, databaseUrl) => {
    const target = assertSeedingAllowed({ databaseUrl, nodeEnv: 'development' });

    expect(target.needsConfirmation).toBe(false);
  });

  it('refuses a remote host without ALLOW_DESTRUCTIVE_SEED', () => {
    expect(() =>
      assertSeedingAllowed({ databaseUrl: REMOTE_DATABASE_URL, nodeEnv: 'development' })
    ).toThrow(/ALLOW_DESTRUCTIVE_SEED/);
  });

  it('refuses a non-interactive remote host without SEED_CONFIRM_REMOTE', () => {
    expect(() =>
      assertSeedingAllowed({
        databaseUrl: REMOTE_DATABASE_URL,
        nodeEnv: 'development',
        allowDestructiveSeed: 'true',
        isInteractive: false,
      })
    ).toThrow(/SEED_CONFIRM_REMOTE/);
  });

  it('allows a remote host when both opt-ins are set', () => {
    const target = assertSeedingAllowed({
      databaseUrl: REMOTE_DATABASE_URL,
      nodeEnv: 'development',
      allowDestructiveSeed: 'true',
      confirmRemote: 'true',
      isInteractive: false,
    });

    expect(target.needsConfirmation).toBe(false);
  });

  it('requires interactive confirmation when only ALLOW_DESTRUCTIVE_SEED is set', () => {
    const target = assertSeedingAllowed({
      databaseUrl: REMOTE_DATABASE_URL,
      nodeEnv: 'development',
      allowDestructiveSeed: 'true',
      isInteractive: true,
    });

    expect(target.needsConfirmation).toBe(true);
  });

  it('refuses production before starting a transaction', async () => {
    const transaction = jest.fn();

    await expect(
      seedSuperAdmin(
        { transaction },
        { databaseUrl: LOCAL_DATABASE_URL, nodeEnv: 'production' }
      )
    ).rejects.toThrow(/NODE_ENV=production/);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('super-admin password decisions', () => {
  it('generates a password for a new super admin', () => {
    const decision = resolvePasswordDecision({
      existingUser: null,
      passwordGenerator: () => 'generated-password-123',
    });

    expect(decision).toEqual({
      password: 'generated-password-123',
      generated: true,
      mode: 'generated',
    });
  });

  it('generates a password when an existing user has no hash', () => {
    const decision = resolvePasswordDecision({
      existingUser: { password_hash: null },
      passwordGenerator: () => 'generated-password-123',
    });

    expect(decision.mode).toBe('generated');
  });

  it('preserves an existing password when no override is provided', () => {
    const decision = resolvePasswordDecision({
      existingUser: { password_hash: 'existing-hash' },
    });

    expect(decision).toEqual({ password: null, generated: false, mode: 'preserved' });
  });

  it('accepts an explicit password of the minimum length', () => {
    const password = 'x'.repeat(MIN_PASSWORD_LENGTH);
    const decision = resolvePasswordDecision({ providedPassword: password });

    expect(decision).toEqual({ password, generated: false, mode: 'provided' });
  });

  it('rejects an explicit password that is too short', () => {
    expect(() =>
      resolvePasswordDecision({ providedPassword: 'short' })
    ).toThrow(/at least 12 characters/);
  });

  it('generates distinct passwords of sufficient length', () => {
    const first = generatePassword();
    const second = generatePassword();

    expect(first.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(first).not.toBe(second);
  });
});

const TEST_DATABASE_URL = process.env.SEED_TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  const target = parseDatabaseTarget(TEST_DATABASE_URL);

  if (!isLocalDatabaseHost(target.host) || !target.database.endsWith('_test')) {
    throw new Error(
      'SEED_TEST_DATABASE_URL must point at a local database whose name ends with _test.'
    );
  }
}

const describeDatabase = TEST_DATABASE_URL ? describe : describe.skip;

describeDatabase('seed against a disposable Postgres database', () => {
  let db;

  const seedOptions = (overrides = {}) => ({
    databaseUrl: TEST_DATABASE_URL,
    nodeEnv: 'test',
    isInteractive: false,
    log: () => {},
    ...overrides,
  });

  const createTestSchema = async () => {
    await db.schema.createTable('organizations', (table) => {
      table.uuid('id').primary();
      table.text('name').notNullable();
      table.text('slug').notNullable().unique();
      table.text('industry_vertical').notNullable().defaultTo('food');
      table.text('plan_tier').notNullable().defaultTo('starter');
      table.text('status').notNullable().defaultTo('active');
      table.jsonb('custom_settings').notNullable().defaultTo('{}');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });

    await db.schema.createTable('users', (table) => {
      table.uuid('id').primary();
      table.uuid('organization_id').notNullable().references('id').inTable('organizations');
      table.text('first_name').notNullable();
      table.text('last_name').notNullable();
      table.text('email').notNullable().unique();
      table.text('password_hash');
      table.text('role').notNullable();
      table.text('status').notNullable().defaultTo('invited');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });

    await db.schema.createTable('products', (table) => {
      table.uuid('id').primary();
      table.uuid('organization_id').notNullable().references('id').inTable('organizations');
      table.text('name').notNullable();
      table.text('default_uom').notNullable().defaultTo('kg');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });

    await db.schema.createTable('lots', (table) => {
      table.uuid('id').primary();
      table.uuid('organization_id').notNullable().references('id').inTable('organizations');
      table.uuid('product_id').notNullable().references('id').inTable('products');
      table.text('traceability_lot_code').notNullable();
      table.decimal('quantity', 15, 4).notNullable();
      table.text('uom').notNullable();
      table.text('status').notNullable().defaultTo('active');
      table.uuid('created_by').references('id').inTable('users');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });
  };

  const resetDatabase = async () => {
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await createTestSchema();
  };

  const insertSentinelData = async () => {
    const [organization] = await db('organizations')
      .insert({
        id: uuid.v4(),
        name: 'Seed Sentinel Org',
        slug: 'seed-sentinel',
        industry_vertical: 'food',
        plan_tier: 'starter',
        status: 'active',
      })
      .returning('*');

    const [user] = await db('users')
      .insert({
        id: uuid.v4(),
        organization_id: organization.id,
        first_name: 'Seed',
        last_name: 'Sentinel',
        email: 'sentinel@example.test',
        password_hash: null,
        role: 'org_admin',
        status: 'active',
      })
      .returning('*');

    const [product] = await db('products')
      .insert({
        id: uuid.v4(),
        organization_id: organization.id,
        name: 'Sentinel Product',
        default_uom: 'kg',
      })
      .returning('*');

    await db('lots')
      .insert({
        id: uuid.v4(),
        organization_id: organization.id,
        product_id: product.id,
        traceability_lot_code: 'SENTINEL-LOT',
        quantity: 1,
        uom: 'kg',
        status: 'active',
        created_by: user.id,
      })
      .returning('*');
  };

  beforeAll(() => {
    db = knexFactory({
      client: 'pg',
      connection: TEST_DATABASE_URL,
      pool: { min: 0, max: 2 },
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await resetDatabase();
    await insertSentinelData();
  });

  it('creates the super admin without deleting unrelated tenant data', async () => {
    const log = jest.fn();
    const result = await seedSuperAdmin(db, seedOptions({ log }));

    expect(result.generatedPassword).toEqual(expect.any(String));
    expect(result.generatedPassword.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);

    const organization = await db('organizations')
      .where({ slug: SYSTEM_ORGANIZATION_SLUG })
      .first();
    const user = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    expect(organization).toBeDefined();
    expect(user).toBeDefined();
    expect(user.organization_id).toBe(organization.id);
    expect(user.role).toBe('super_admin');
    expect(user.status).toBe('active');
    expect(await argon2.verify(user.password_hash, result.generatedPassword)).toBe(true);

    expect(await db('organizations').where({ slug: 'seed-sentinel' }).first()).toBeDefined();
    expect(await db('users').where({ email: 'sentinel@example.test' }).first()).toBeDefined();
    expect(await db('products').where({ name: 'Sentinel Product' }).first()).toBeDefined();
    expect(
      await db('lots').where({ traceability_lot_code: 'SENTINEL-LOT' }).first()
    ).toBeDefined();

    const messages = log.mock.calls.flat().join('\n');
    expect(messages).toContain('Seed target: localhost:5432');
    expect(messages.split(result.generatedPassword)).toHaveLength(2);
  });

  it('is idempotent and preserves the existing password', async () => {
    const first = await seedSuperAdmin(db, seedOptions());
    const before = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    const second = await seedSuperAdmin(db, seedOptions());
    const after = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    expect(second.generatedPassword).toBeNull();
    expect(after.id).toBe(before.id);
    expect(after.password_hash).toBe(before.password_hash);
    expect(await argon2.verify(after.password_hash, first.generatedPassword)).toBe(true);

    expect(
      await db('organizations').where({ slug: SYSTEM_ORGANIZATION_SLUG }).select('id')
    ).toHaveLength(1);
    expect(await db('users').where({ email: SUPER_ADMIN_EMAIL }).select('id')).toHaveLength(1);
    expect(await db('organizations').where({ slug: 'seed-sentinel' }).first()).toBeDefined();
    expect(
      await db('lots').where({ traceability_lot_code: 'SENTINEL-LOT' }).first()
    ).toBeDefined();
  });

  it('resets the password when SEED_SUPER_ADMIN_PASSWORD is provided', async () => {
    const first = await seedSuperAdmin(db, seedOptions());
    const newPassword = 'NewStrongPassword!123';

    const second = await seedSuperAdmin(
      db,
      seedOptions({ superAdminPassword: newPassword })
    );
    const user = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    expect(second.generatedPassword).toBeNull();
    expect(await argon2.verify(user.password_hash, newPassword)).toBe(true);
    expect(await argon2.verify(user.password_hash, first.generatedPassword)).toBe(false);
  });

  it('repairs an existing super admin with a null password hash', async () => {
    await seedSuperAdmin(db, seedOptions());
    await db('users').where({ email: SUPER_ADMIN_EMAIL }).update({ password_hash: null });

    const result = await seedSuperAdmin(db, seedOptions());
    const user = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    expect(result.generatedPassword).toEqual(expect.any(String));
    expect(await argon2.verify(user.password_hash, result.generatedPassword)).toBe(true);
  });
});
