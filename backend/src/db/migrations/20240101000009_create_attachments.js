/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('attachments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.text('parent_type').notNullable(); // event | lot
    table.uuid('parent_id').notNullable();
    table.text('storage_key').notNullable(); // S3 object key
    table.text('filename').notNullable();
    table.text('content_type').notNullable(); // MIME type
    table.bigInteger('size_bytes');
    table.uuid('uploaded_by').notNullable().references('id').inTable('users');
    table.text('status').notNullable().defaultTo('pending');
    table.timestamp('uploaded_at', { useTz: true });
    table.timestamp('deleted_at', { useTz: true });
    table.uuid('deleted_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("status IN ('pending', 'uploaded', 'deleting', 'deleted')", [], 'attachments_status_check');

    table.index(['parent_type', 'parent_id'], 'idx_attachments_parent');
    table.index('organization_id', 'idx_attachments_org');
    table.index(['organization_id', 'parent_type', 'parent_id', 'status'], 'idx_attachments_parent_status');
    table.index(['status', 'created_at'], 'idx_attachments_status_created');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('attachments');
};
