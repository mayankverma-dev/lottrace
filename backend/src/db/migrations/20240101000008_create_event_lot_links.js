/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('event_lot_links', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.uuid('event_id').notNullable();
    table.uuid('lot_id').notNullable();
    table.text('direction').notNullable(); // input | output
    table.decimal('quantity', 15, 4);
    table.text('uom');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Critical indexes for recursive trace CTEs
    table.index('event_id', 'idx_ell_event');
    table.index('lot_id', 'idx_ell_lot');
    table.index('organization_id', 'idx_ell_org');
    table.index(['lot_id', 'direction'], 'idx_ell_lot_direction');
    table.index(['event_id', 'direction'], 'idx_ell_event_direction');

    table.foreign(['event_id', 'organization_id'])
      .references(['id', 'organization_id'])
      .inTable('events');
    table.foreign(['lot_id', 'organization_id'])
      .references(['id', 'organization_id'])
      .inTable('lots');
  });

  // No duplicate lot+direction per event
  await knex.raw(`
    CREATE UNIQUE INDEX idx_ell_event_lot_direction
    ON event_lot_links(event_id, lot_id, direction)
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('event_lot_links');
};
