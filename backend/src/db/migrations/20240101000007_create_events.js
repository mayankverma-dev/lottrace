/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations');
    table.text('event_type').notNullable(); // creation | receiving | transformation | shipping
    table.uuid('location_id');
    table.jsonb('counterparty_info'); // external partner details
    table.timestamp('event_datetime', { useTz: true }).notNullable();
    table.uuid('recorded_by').notNullable().references('id').inTable('users');
    table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('source').notNullable().defaultTo('manual'); // manual | scan | import | api
    table.jsonb('kde_payload').notNullable().defaultTo('{}');
    table.jsonb('compliance_gaps'); // [{field, message}]
    // has_compliance_gaps is a generated column — created via raw SQL below
    table.text('notes');
    // Import dedupe key (`import_<organization_id>_<transaction_id>`). Session
    // HTTP idempotency lives in `idempotency_keys`, not here. Unique per
    // organization so two tenants may use the same key value.
    table.text('idempotency_key');
    table.text('record_hash').notNullable();
    table.text('prev_hash').notNullable();
    table.bigInteger('chain_seq').notNullable(); // monotonic per-org chain position
    table.smallint('hash_version').notNullable().defaultTo(3); // HMAC canonical payload version
    table.text('hash_key_id').notNullable(); // key ID resolved from the env/KMS keyring
    table.text('status').notNullable().defaultTo('active'); // active | amended | void
    table.uuid('supersedes_event_id').references('id').inTable('events');
    table.text('status_reason');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // NO updated_at — events are immutable

    table.index('location_id', 'idx_events_location');
    table.index('recorded_by', 'idx_events_recorded_by');

    // Composite key for event_lot_links' tenant-safe FK (P0-03).
    table.unique(['id', 'organization_id'], 'uq_events_id_org');

    table.unique(['organization_id', 'idempotency_key'], 'uq_events_org_idempotency_key');

    table.foreign(['location_id', 'organization_id'])
      .references(['id', 'organization_id'])
      .inTable('locations');
  });

  // Generated column for compliance gaps
  await knex.raw(`
    ALTER TABLE events
    ADD COLUMN has_compliance_gaps boolean NOT NULL
    GENERATED ALWAYS AS (compliance_gaps IS NOT NULL AND jsonb_array_length(compliance_gaps) > 0) STORED
  `);

  // Chain order and tip lookup. Unique per organization; never order the chain
  // by created_at because that is the transaction start time (P0-02).
  await knex.raw(`
    CREATE UNIQUE INDEX idx_events_org_chain_seq ON events(organization_id, chain_seq)
  `);
  await knex.raw(`
    ALTER TABLE events
    ADD CONSTRAINT events_chain_seq_positive CHECK (chain_seq >= 1)
  `);

  // An event can be superseded at most once. This is a database guarantee, not
  // just a code-path check: a second replace attempt fails with 23505 (P0-04).
  await knex.raw(`
    CREATE UNIQUE INDEX idx_events_supersedes_once
    ON events(supersedes_event_id)
    WHERE supersedes_event_id IS NOT NULL
  `);

  // Event-list indexes. Each non-date filter column is followed by the exact
  // list sort order so PostgreSQL can satisfy equality + keyset paging from one
  // index. The base keyset index includes event_datetime so a date filter can
  // reject rows without a heap fetch; the date-ordered index lets a bounded
  // filter-first plan avoid walking the whole created_at keyset (P2-41).
  await knex.raw(`
    CREATE INDEX idx_events_org_created_seq
    ON events(organization_id, created_at DESC, chain_seq DESC)
    INCLUDE (event_datetime)
  `);
  await knex.raw(`
    CREATE INDEX idx_events_org_type_created_seq
    ON events(organization_id, event_type, created_at DESC, chain_seq DESC)
  `);
  await knex.raw(`
    CREATE INDEX idx_events_org_status_created_seq
    ON events(organization_id, status, created_at DESC, chain_seq DESC)
  `);
  await knex.raw(`
    CREATE INDEX idx_events_org_source_created_seq
    ON events(organization_id, source, created_at DESC, chain_seq DESC)
  `);
  await knex.raw(`
    CREATE INDEX idx_events_org_location_created_seq
    ON events(organization_id, location_id, created_at DESC, chain_seq DESC)
  `);

  // Date-range filter plus the public list order. The old
  // (organization_id, event_datetime) index is a prefix and is removed.
  await knex.raw(`
    CREATE INDEX idx_events_org_datetime_created_seq
    ON events(organization_id, event_datetime DESC, created_at DESC, chain_seq DESC)
  `);
  await knex.raw(`
    CREATE INDEX idx_events_compliance_gaps ON events(organization_id, has_compliance_gaps)
    WHERE has_compliance_gaps = true
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('events');
};
