/**
 * Adds an explicit, monotonic chain position to events (P0-02).
 *
 * `events.created_at` defaults to CURRENT_TIMESTAMP, which is the transaction start
 * time, not the insert time. Two transactions can therefore interleave on the
 * organization advisory lock and still receive `created_at` values that do not match
 * the order in which their hashes were chained. `ORDER BY created_at` is also not a
 * total order when two rows share the same timestamp.
 *
 * `chain_seq` is assigned inside the same transaction that holds
 * `pg_advisory_xact_lock(<org lock>)`, so it is a total order per organization.
 * Chain reads (tip lookup, verifier) must use it instead of `created_at`.
 *
 * The column is metadata only and is NOT part of the hash payload, so existing
 * record_hash/prev_hash values stay valid. No re-seal is performed.
 *
 * Existing rows are backfilled by following `prev_hash` from `GENESIS`, never by
 * `created_at`: created_at is the value that is tied/inverted under concurrency, so
 * ordering by it would assign positions that disagree with the hashes. `created_at`
 * and `id` are used only to break ties for rows that are not reachable from GENESIS
 * (fork, orphan, cycle). Those chains were already unverifiable before this
 * migration and remain reported as failures; the backfill does not hide them.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('events', (table) => {
    table.bigInteger('chain_seq');
  });

  // The recursive walk joins events on (organization_id, prev_hash). Without this
  // index the join degrades to a sequential scan per chain step.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_events_org_prev_hash_backfill ON events(organization_id, prev_hash)',
  );

  // Backfill by following the hash linkage from GENESIS.
  //
  // depth is the distance from the root. On a valid chain each depth holds exactly one
  // event, so ordering by depth reproduces the linkage order regardless of created_at.
  // Rows that are not reachable from GENESIS (fork, orphan, cycle) sort last by
  // created_at/id. That keeps the backfill total and deterministic instead of
  // aborting a deploy on historical forks, which the pre-fix writer could produce.
  //
  // The depth bound stops a tampered cycle from recursing forever: a simple path
  // cannot be longer than the organization's event count.
  await knex.raw(`
    WITH RECURSIVE org_totals AS (
      SELECT organization_id, COUNT(*)::int AS total
        FROM events
       GROUP BY organization_id
    ),
    walk AS (
      SELECT e.id, e.organization_id, e.record_hash, 1 AS depth
        FROM events e
       WHERE e.prev_hash = 'GENESIS'
      UNION ALL
      SELECT e.id, e.organization_id, e.record_hash, w.depth + 1
        FROM walk w
        JOIN events e
          ON e.organization_id = w.organization_id
         AND e.prev_hash = w.record_hash
        JOIN org_totals t ON t.organization_id = w.organization_id
       WHERE w.depth < t.total
    ),
    depths AS (
      SELECT id, MIN(depth) AS depth FROM walk GROUP BY id
    ),
    ordered AS (
      SELECT e.id,
             ROW_NUMBER() OVER (
               PARTITION BY e.organization_id
               ORDER BY d.depth ASC NULLS LAST, e.created_at ASC, e.id ASC
             ) AS seq
        FROM events e
        LEFT JOIN depths d ON d.id = e.id
    )
    UPDATE events e
       SET chain_seq = ordered.seq
      FROM ordered
     WHERE e.id = ordered.id
  `);

  await knex.raw('DROP INDEX IF EXISTS idx_events_org_prev_hash_backfill');

  // Surface, do not hide, chains that were already broken before the backfill. A valid
  // chain must report zero breaks here. Broken chains stay broken: they are a data
  // repair task, not a reason to block the ordering fix.
  const linkageBreaks = await knex.raw(`
    WITH ordered AS (
      SELECT organization_id, chain_seq, prev_hash,
             LAG(record_hash) OVER (
               PARTITION BY organization_id ORDER BY chain_seq
             ) AS prior_hash
        FROM events
    )
    SELECT organization_id, COUNT(*)::int AS breaks
      FROM ordered
     WHERE (chain_seq = 1 AND prev_hash <> 'GENESIS')
        OR (chain_seq > 1 AND prev_hash <> prior_hash)
     GROUP BY organization_id
  `);
  if (linkageBreaks.rows.length > 0) {
    const detail = linkageBreaks.rows
      .map((row) => `${row.organization_id} (${row.breaks} break(s))`)
      .join(', ');
    console.warn(`[chain_seq backfill] pre-existing chain breaks: ${detail}`);
  }

  await knex.raw('ALTER TABLE events ALTER COLUMN chain_seq SET NOT NULL');

  // Also serves the tip lookup: WHERE organization_id = ? ORDER BY chain_seq DESC LIMIT 1
  await knex.raw(
    'CREATE UNIQUE INDEX idx_events_org_chain_seq ON events(organization_id, chain_seq)',
  );

  await knex.raw(
    'ALTER TABLE events ADD CONSTRAINT events_chain_seq_positive CHECK (chain_seq >= 1)',
  );

  await knex.raw(
    `COMMENT ON COLUMN events.chain_seq IS 'Monotonic per-organization chain position. Assigned inside the transaction that holds pg_advisory_xact_lock(org). Chain order is chain_seq, never created_at. Not part of the hash payload.'`,
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.raw('ALTER TABLE events DROP CONSTRAINT IF EXISTS events_chain_seq_positive');
  await knex.raw('DROP INDEX IF EXISTS idx_events_org_chain_seq');

  await knex.schema.alterTable('events', (table) => {
    table.dropColumn('chain_seq');
  });
};
