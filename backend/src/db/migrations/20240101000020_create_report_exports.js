/**
 * Persistent export jobs. The worker updates this row as the export moves from
 * `queued` to `processing` to `complete` or `failed`. Downloads are signed only
 * after the row is verified against the caller's organization.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('report_exports', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('requested_by').notNullable().references('id').inTable('users');
    table.text('type').notNullable().defaultTo('events');
    table.text('format').notNullable();
    table.text('status').notNullable().defaultTo('queued');
    table.text('storage_key');
    row_count: table.integer('row_count');
    table.jsonb('filters').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text('error');
    table.text('error_code');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('started_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });

    table.index(['organization_id', 'created_at'], 'idx_report_exports_org_created');
    table.index(['status', 'created_at'], 'idx_report_exports_status_created');

    table.check("type IN ('events', 'audit')", [], 'report_exports_type_check');
    table.check("format IN ('csv', 'json')", [], 'report_exports_format_check');
    table.check("jsonb_typeof(filters) = 'object'", [], 'report_exports_filters_object_check');
    table.check(
      "status IN ('queued', 'processing', 'complete', 'failed')",
      [],
      'report_exports_status_check',
    );
    table.check('row_count IS NULL OR row_count >= 0', [], 'report_exports_row_count_check');
  });

  await knex.raw('ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY tenant_isolation_report_exports ON report_exports
    USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP POLICY IF EXISTS tenant_isolation_report_exports ON report_exports');
  await knex.schema.dropTableIfExists('report_exports');
};
