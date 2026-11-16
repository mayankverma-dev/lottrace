/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('api_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.text('label').notNullable();
    table.text('key_prefix').notNullable();
    table.text('key_hash').notNullable();
    table.specificType('scopes', 'text[]').notNullable().defaultTo('{}');
    table.timestamp('last_used_at', { useTz: true });
    table.timestamp('revoked_at', { useTz: true });
    table.uuid('created_by').notNullable().references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['key_hash'], { indexName: 'idx_api_keys_hash' });
    table.index(['organization_id'], 'idx_api_keys_org');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('api_keys');
};
