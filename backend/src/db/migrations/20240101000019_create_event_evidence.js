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

  // Append-only at the database level, not just in application code. Evidence
  // rows are sealed when written; an UPDATE or DELETE means the chain no longer
  // describes what happened. Verification also detects that cryptographically,
  // but the database rejects the write first so a stray code path cannot corrupt
  // the ledger. The only permitted UPDATE is the one-time seal that replaces the
  // `PENDING` placeholders with the HMAC and key id on the row just inserted.
  await knex.raw(`
    CREATE FUNCTION reject_event_evidence_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
        AND OLD.record_hash = 'PENDING'
        AND NEW.record_hash <> 'PENDING'
        AND NEW.hash_key_id <> 'PENDING'
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
        AND NEW.event_id IS NOT DISTINCT FROM OLD.event_id
        AND NEW.seq IS NOT DISTINCT FROM OLD.seq
        AND NEW.kind IS NOT DISTINCT FROM OLD.kind
        AND NEW.payload IS NOT DISTINCT FROM OLD.payload
        AND NEW.prev_hash IS NOT DISTINCT FROM OLD.prev_hash
        AND NEW.hash_version IS NOT DISTINCT FROM OLD.hash_version
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'event_evidence is append-only: % is not allowed', TG_OP;
    END;
    $$;
  `);
  await knex.raw(`
    CREATE TRIGGER event_evidence_immutable
    BEFORE UPDATE OR DELETE ON event_evidence
    FOR EACH ROW EXECUTE FUNCTION reject_event_evidence_mutation();
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
  await knex.raw('DROP FUNCTION IF EXISTS reject_event_evidence_mutation()');
};
