const TENANT_TABLES = [
  'users',
  'locations',
  'products',
  'lots',
  'events',
  'event_lot_links',
  'attachments',
  'audit_log',
  'api_keys',
  'webhooks',
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  for (const table of TENANT_TABLES) {
    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`
      CREATE POLICY tenant_isolation_${table} ON ${table}
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    `);
  }
  await knex.raw(`
    CREATE POLICY user_auth_lookup ON users
    FOR SELECT
    USING (
      email = NULLIF(current_setting('app.auth_email', true), '')
      OR id = NULLIF(current_setting('app.auth_user_id', true), '')::uuid
    );
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  for (const table of TENANT_TABLES.reverse()) {
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation_${table} ON ${table};`);
    await knex.raw(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
  }
  await knex.raw('DROP POLICY IF EXISTS user_auth_lookup ON users;');
};
