/**
 * P0-05 runtime RLS tests.
 *
 * Run only with RUN_DB_TESTS=1 and a disposable local database ending in _test.
 */
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  require('../test/dbGuard').announceTarget();
}

const { v4: uuid } = require('uuid');
const path = require('path');
const knex = require('knex');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

describeDb('P0-05 runtime RLS', () => {
  jest.setTimeout(120000);

  let db;
  let ownerDb;
  let withTenantTransaction;
  let organizationA;
  let organizationB;

  const insertOrganization = async (label) => {
    const id = uuid();
    await db('organizations').insert({
      id,
      name: `P0-05 ${label}`,
      slug: `p0-05-${label}-${id.slice(0, 8)}`,
    });
    return id;
  };

  const insertLocation = async (organizationId, label) => withTenantTransaction(
    organizationId,
    (trx) => trx('locations').insert({
      id: uuid(),
      organization_id: organizationId,
      name: `P0-05 ${label}`,
      type: 'plant',
    }).returning('*'),
  );

  beforeAll(async () => {
    ownerDb = knex({ client: 'pg', connection: process.env.DATABASE_URL });
    await ownerDb.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await ownerDb.raw('CREATE SCHEMA public');
    await ownerDb.migrate.latest({ directory: MIGRATIONS_DIR });
    await ownerDb.raw("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lottrace_app_p005_test') THEN DROP OWNED BY lottrace_app_p005_test; END IF; END $$");
    await ownerDb.raw('DROP ROLE IF EXISTS lottrace_app_p005_test');
    await ownerDb.raw("CREATE ROLE lottrace_app_p005_test LOGIN PASSWORD 'p005_test' NOSUPERUSER NOBYPASSRLS");
    await ownerDb.raw('GRANT USAGE ON SCHEMA public TO lottrace_app_p005_test');
    await ownerDb.raw('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lottrace_app_p005_test');
    await ownerDb.raw('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lottrace_app_p005_test');

    process.env.APP_DATABASE_URL = process.env.DATABASE_URL.replace(
      /^postgresql:\/\/[^@]+@/,
      'postgresql://lottrace_app_p005_test:p005_test@',
    );
    db = require('./knex');
    ({ withTenantTransaction } = require('./tenantTransaction'));
    organizationA = await insertOrganization('A');
    organizationB = await insertOrganization('B');
    await ownerDb('locations').insert({
      id: uuid(), organization_id: organizationA, name: 'P0-05 A location', type: 'plant',
    });
    await ownerDb('locations').insert({
      id: uuid(), organization_id: organizationB, name: 'P0-05 B location', type: 'plant',
    });
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (ownerDb) {
      await ownerDb.raw("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lottrace_app_p005_test') THEN DROP OWNED BY lottrace_app_p005_test; END IF; END $$");
      await ownerDb.raw('DROP ROLE IF EXISTS lottrace_app_p005_test');
      await ownerDb.destroy();
    }
  });

  it('fails closed without a tenant setting', async () => {
    await expect(db('locations').select('*')).resolves.toEqual([]);
  });

  it('returns only rows for the active tenant', async () => {
    const rowsA = await withTenantTransaction(
      organizationA,
      (trx) => trx('locations').select('organization_id', 'name').orderBy('name'),
    );
    const rowsB = await withTenantTransaction(
      organizationB,
      (trx) => trx('locations').select('organization_id', 'name').orderBy('name'),
    );

    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].organization_id).toBe(organizationA);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].organization_id).toBe(organizationB);
  });

  it('rejects a foreign-tenant insert through WITH CHECK', async () => {
    await expect(withTenantTransaction(
      organizationA,
      (trx) => trx('locations').insert({
        id: uuid(),
        organization_id: organizationB,
        name: 'P0-05 forbidden',
        type: 'plant',
      }),
    )).rejects.toMatchObject({ code: '42501' });
  });

  it('does not leak tenant state across pooled transactions', async () => {
    await withTenantTransaction(organizationA, (trx) => trx('locations').count('* as count'));
    await expect(db('locations').select('*')).resolves.toEqual([]);
    const rowsB = await withTenantTransaction(
      organizationB,
      (trx) => trx('locations').select('organization_id'),
    );
    expect(rowsB).toEqual([{ organization_id: organizationB }]);
  });
});
