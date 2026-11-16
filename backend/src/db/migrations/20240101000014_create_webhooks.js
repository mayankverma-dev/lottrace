/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('webhooks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.text('url').notNullable();
    table.specificType('subscribed_events', 'text[]').notNullable().defaultTo('{}');
    table.text('secret_hash').notNullable();
    table.text('status').notNullable().defaultTo('active');
    table.integer('failure_count').notNullable().defaultTo(0);
    table.timestamp('last_triggered_at', { useTz: true });
    table.timestamp('last_success_at', { useTz: true });
    table.uuid('created_by').notNullable().references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['organization_id', 'status'], 'idx_webhooks_org');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('webhooks');
};
