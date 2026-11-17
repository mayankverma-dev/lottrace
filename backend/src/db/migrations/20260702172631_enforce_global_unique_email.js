/**
 * Email is the global identity key. Enforce uniqueness on the normalized
 * value so a case variant cannot create a second account.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropUnique([], 'idx_users_email_org');
    table.dropIndex([], 'idx_users_email');
  });

  await knex.raw(
    'CREATE UNIQUE INDEX users_email_normalized_unique ON users (lower(email))'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS users_email_normalized_unique');

  await knex.schema.alterTable('users', (table) => {
    table.unique(['email', 'organization_id'], { indexName: 'idx_users_email_org' });
    table.index('email', 'idx_users_email');
  });
};
