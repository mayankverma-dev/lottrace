/**
 * P2-29 schema and runtime-RLS tests.
 * Requires RUN_DB_TESTS=1 and a disposable local database ending in _test.
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
const ROLE = 'lottrace_p229_test';
const PASSWORD = 'lottrace_p229_password';

describeDb('P2-29 API key and webhook schema', () => {
  jest.setTimeout(120000);

  let ownerDb;
  let appDb;
  let withTenantTransaction;
  const orgA = uuid();
  const orgB = uuid();
  const userA = uuid();

  beforeAll(async () => {
    ownerDb = knex({ client: 'pg', connection: process.env.DATABASE_URL });
    await ownerDb.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await ownerDb.raw('CREATE SCHEMA public');
    await ownerDb.migrate.latest({ directory: MIGRATIONS_DIR });
    await ownerDb.raw(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN DROP OWNED BY ${ROLE}; END IF; END $$`);
    await ownerDb.raw(`DROP ROLE IF EXISTS ${ROLE}`);
    await ownerDb.raw(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    await ownerDb.raw(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await ownerDb.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
    await ownerDb.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);

    await ownerDb('organizations').insert([
      { id: orgA, name: 'P2-29 A', slug: `p2-29-a-${orgA.slice(0, 8)}` },
      { id: orgB, name: 'P2-29 B', slug: `p2-29-b-${orgB.slice(0, 8)}` },
    ]);
    await ownerDb('users').insert({
      id: userA,
      organization_id: orgA,
      first_name: 'P2',
      last_name: 'Tester',
      email: `${userA}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    process.env.APP_DATABASE_URL = process.env.DATABASE_URL.replace(
      /^postgresql:\/\/[^@]+@/,
      `postgresql://${ROLE}:${PASSWORD}@`,
    );
    appDb = require('./knex');
    ({ withTenantTransaction } = require('./tenantTransaction'));
  });

  afterAll(async () => {
    if (appDb) await appDb.destroy();
    if (ownerDb) {
      await ownerDb.raw(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN DROP OWNED BY ${ROLE}; END IF; END $$`);
      await ownerDb.raw(`DROP ROLE IF EXISTS ${ROLE}`);
      await ownerDb.destroy();
    }
  });

  it('creates both documented tables with required schema and forced RLS', async () => {
    const tables = await ownerDb('pg_class as c')
      .join('pg_namespace as n', 'n.oid', 'c.relnamespace')
      .where('n.nspname', 'public')
      .whereIn('c.relname', ['api_keys', 'webhooks'])
      .select('c.relname', 'c.relrowsecurity', 'c.relforcerowsecurity');

    expect(tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ relname: 'api_keys', relrowsecurity: true, relforcerowsecurity: true }),
      expect.objectContaining({ relname: 'webhooks', relrowsecurity: true, relforcerowsecurity: true }),
    ]));

    const apiColumns = await ownerDb('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'api_keys' }).pluck('column_name');
    const webhookColumns = await ownerDb('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'webhooks' }).pluck('column_name');

    expect(apiColumns).toEqual(expect.arrayContaining([
      'organization_id', 'label', 'key_prefix', 'key_hash', 'scopes', 'created_by', 'created_at',
    ]));
    expect(webhookColumns).toEqual(expect.arrayContaining([
      'organization_id', 'url', 'subscribed_events', 'secret_hash', 'status', 'created_by', 'updated_at',
    ]));
  });

  it('isolates both tables and rejects foreign-tenant writes', async () => {
    await withTenantTransaction(orgA, async () => {
      await appDb.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', orgA]);
      await appDb('api_keys').insert({
        id: uuid(), organization_id: orgA, label: 'A key', key_prefix: 'ltk_test',
        key_hash: uuid(), scopes: ['read'], created_by: userA,
      });
      await appDb('webhooks').insert({
        id: uuid(), organization_id: orgA, url: 'https://example.test/hook',
        subscribed_events: ['event.created'], secret_hash: 'hash', created_by: userA,
      });
    });

    await expect(withTenantTransaction(orgA, async () => {
      await appDb.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', orgA]);
      await appDb('api_keys').insert({
        id: uuid(), organization_id: orgB, label: 'B key', key_prefix: 'ltk_test',
        key_hash: uuid(), scopes: ['read'], created_by: userA,
      });
    })).rejects.toMatchObject({ code: '42501' });

    const visible = await withTenantTransaction(orgA, async () => {
      await appDb.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', orgA]);
      return {
        keys: await appDb('api_keys').select('organization_id'),
        webhooks: await appDb('webhooks').select('organization_id'),
      };
    });
    expect(visible.keys).toEqual([{ organization_id: orgA }]);
    expect(visible.webhooks).toEqual([{ organization_id: orgA }]);
  });

  it('includes password-reset columns in fresh users schema', async () => {
    const columns = await ownerDb('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'users' }).pluck('column_name');
    expect(columns).toEqual(expect.arrayContaining([
      'password_reset_token_hash',
      'password_reset_expires_at',
    ]));
  });
});
