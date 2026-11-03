/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema.alterTable('users', (table) => {
    // idx_users_email_org is a UNIQUE constraint (created with table.unique in
    // 20240101000002_create_users), not a plain index — it must be dropped as a
    // constraint or PostgreSQL rejects the statement.
    table.dropUnique([], 'idx_users_email_org');
    table.dropIndex([], 'idx_users_email');
    table.unique('email', { indexName: 'users_email_unique' });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropUnique([], 'users_email_unique');
    table.unique(['email', 'organization_id'], { indexName: 'idx_users_email_org' });
    table.index('email', 'idx_users_email');
  });
};
