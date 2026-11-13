/**
 * HTTP idempotency records for mutating requests that carry an
 * `Idempotency-Key` header.
 *
 * A row is inserted with `response_status = NULL` while the original request is
 * in flight, then updated with the stored 2xx response. Rows older than
 * `expires_at` are ignored by the middleware and removed by the maintenance
 * worker.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('idempotency_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('key').notNullable();
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.text('request_hash').notNullable(); // SHA-256 of method + route + canonical body
    table.integer('response_status'); // NULL while the original request is in flight
    table.jsonb('response_body');
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['organization_id', 'key'], 'idx_idempotency_org_key');
    table.index('expires_at', 'idx_idempotency_expires');
  });

  await knex.raw(`
    ALTER TABLE idempotency_keys
    ADD CONSTRAINT idempotency_key_length CHECK (char_length(key) BETWEEN 1 AND 255)
  `);
  await knex.raw(`
    ALTER TABLE idempotency_keys
    ADD CONSTRAINT idempotency_response_status_2xx CHECK (
      response_status IS NULL OR (response_status >= 200 AND response_status < 300)
    )
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('idempotency_keys');
};
