/**
 * Adds the hash algorithm version to events.
 *
 * Existing rows keep the default (1 = legacy request-shaped hash). New events are
 * written with version 2 (canonical payload) by the application. The column is
 * metadata only and is not part of the hash payload; it is a domain separator that
 * lets the verifier pick the right reconstruction algorithm per row.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('events', (table) => {
    table.smallint('hash_version').notNullable().defaultTo(1);
  });

  await knex.raw(
    'ALTER TABLE events ADD CONSTRAINT events_hash_version_positive CHECK (hash_version >= 1)',
  );

  await knex.raw(
    `COMMENT ON COLUMN events.hash_version IS '1 = legacy request-shaped hash (not payload-verifiable), 2 = canonical hash built by utils/hashChain.js'`,
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.raw('ALTER TABLE events DROP CONSTRAINT IF EXISTS events_hash_version_positive');

  await knex.schema.alterTable('events', (table) => {
    table.dropColumn('hash_version');
  });
};
