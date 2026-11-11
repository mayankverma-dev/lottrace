/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('products', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.text('name').notNullable();
    table.text('sku');
    table.text('gtin'); // GS1 GTIN
    table.text('category');
    table.boolean('is_ftl').notNullable().defaultTo(false); // FDA Food Traceability List
    table.text('default_uom').notNullable().defaultTo('kg');
    table.jsonb('custom_kde_schema').notNullable().defaultTo('[]'); // [{name, type, required, label}]
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index('organization_id', 'idx_products_org');
    table.index(['organization_id', 'is_active'], 'idx_products_org_active');

    // Composite key for lots' tenant-safe product FK (P0-14).
    table.unique(['id', 'organization_id'], 'uq_products_id_org');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('products');
};
