/**
 * Append-only signed evidence for mutable facts that happen after an event is
 * sealed: status transitions (void/amend) and attachment additions.
 *
 * The chain is rooted at the parent event's `record_hash`, so tampering with a
 * status, void reason, or attachment is detectable without re-sealing the event.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('event_evidence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.uuid('event_id').notNullable().references('id').inTable('events');
    table.integer('seq').notNullable(); // 1-based per event
    table.text('kind').notNullable(); // status_change | attachment_added
    table.jsonb('payload').notNullable();
    table.text('record_hash').notNullable();
    table.text('prev_hash').notNullable();
    table.smallint('hash_version').notNullable().defaultTo(3);
    table.text('hash_key_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['event_id', 'seq'], 'idx_event_evidence_event_seq');
    table.index(['organization_id', 'event_id'], 'idx_event_evidence_org_event');
  });

  await knex.raw(`
    ALTER TABLE event_evidence
    ADD CONSTRAINT event_evidence_seq_positive CHECK (seq >= 1)
  `);

  await knex.raw('ALTER TABLE event_evidence ENABLE ROW LEVEL SECURITY;');
  await knex.raw(`
    CREATE POLICY tenant_isolation_event_evidence ON event_evidence
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('event_evidence');
};
