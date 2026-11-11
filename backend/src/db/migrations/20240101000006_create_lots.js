/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('lots', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.uuid('product_id').notNullable().references('id').inTable('products');
    table.text('traceability_lot_code').notNullable();
    table.decimal('quantity', 15, 4).notNullable();
    table.text('uom').notNullable();
    table.text('status').notNullable().defaultTo('active'); // active | recalled | void
    table.text('void_reason');
    table.integer('version').notNullable().defaultTo(1); // optimistic concurrency
    table.text('notes');
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('organization_id', 'idx_lots_org');
    table.index(['organization_id', 'status'], 'idx_lots_org_status');
    table.index('product_id', 'idx_lots_product');

    // Composite key for event_lot_links' tenant-safe FK (P0-03).
    table.unique(['id', 'organization_id'], 'uq_lots_id_org');
  });

  // TLC unique per org+product (excluding voided lots)
  await knex.raw(`
    CREATE UNIQUE INDEX idx_lots_tlc_org_product
    ON lots(organization_id, product_id, traceability_lot_code)
    WHERE status != 'void'
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('lots');
};
