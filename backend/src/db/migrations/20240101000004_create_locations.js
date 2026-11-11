/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('locations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.text('name').notNullable();
    table.text('type').notNullable(); // farm | plant | warehouse | distributor | retailer | other
    table.boolean('is_external').notNullable().defaultTo(false);
    table.text('address_line1');
    table.text('address_line2');
    table.text('city');
    table.text('state');
    table.text('postal_code');
    table.text('country').notNullable().defaultTo('US');
    table.text('gln'); // GS1 Global Location Number
    table.text('timezone'); // IANA timezone
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('organization_id', 'idx_locations_org');
    table.index(['organization_id', 'is_active'], 'idx_locations_org_active');

    // Composite key for events' tenant-safe location FK (P0-13).
    table.unique(['id', 'organization_id'], 'uq_locations_id_org');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('locations');
};
