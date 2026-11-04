/**
 * P0-02 migration test — chain_seq column and linkage-based backfill.
 *
 * This suite rewinds and re-applies the migration, so it MUST run against its own
 * disposable database whose name ends in `mig_test`:
 *
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgres://lottrace:lottrace@localhost:55432/lottrace_p002_mig_test \
 *   npx jest --runInBand src/db/chain-seq-migration.test.js
 *
 * Do not run this file with the same DATABASE_URL as the other suites.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../test/dbGuard').announceTarget({ requiredSuffix: '_mig_test' });
}

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_NAME = '20261103000001_add_chain_seq_to_events.js';

const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('P0-02 chain_seq migration and backfill', () => {
  jest.setTimeout(60000);

  let db;
  let migration;
  let verifier;

  const orgs = {
    tied: uuidv4(),
    inverted: uuidv4(),
    broken: uuidv4(),
    forked: uuidv4(),
  };

  const users = {
    tied: uuidv4(),
    inverted: uuidv4(),
    broken: uuidv4(),
    forked: uuidv4(),
  };

  /**
   * Builds a hash chain: event i points at event i-1's record_hash, event 0 at GENESIS.
   * `overrides` can rewrite prev_hash to create a fork or an orphan.
   */
  const buildChain = (orgId, userId, prefix, createdAts, overrides = {}) => createdAts.map(
    (createdAt, index) => ({
      id: uuidv4(),
      organization_id: orgId,
      event_type: 'creation',
      location_id: null,
      counterparty_info: null,
      event_datetime: createdAt,
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({}),
      record_hash: `${prefix}-${index}`,
      prev_hash: index === 0 ? 'GENESIS' : `${prefix}-${index - 1}`,
      created_at: createdAt,
      ...(overrides[index] || {}),
    }),
  );

  // created_at is deliberately wrong relative to the hash linkage:
  //   tied     — six events share one timestamp (P0-02 tie),
  //   inverted — timestamps run backwards (P0-02 inversion),
  //   broken   — prev_hash points at a hash that does not exist,
  //   forked   — two events claim the same predecessor.
  const tied = buildChain(
    orgs.tied,
    users.tied,
    'tied',
    Array(6).fill('2026-01-01T00:00:00.000Z'),
  );

  const inverted = buildChain(orgs.inverted, users.inverted, 'inv', [
    '2026-01-01T00:00:04.000Z',
    '2026-01-01T00:00:03.000Z',
    '2026-01-01T00:00:02.000Z',
    '2026-01-01T00:00:01.000Z',
  ]);

  const broken = buildChain(
    orgs.broken,
    users.broken,
    'brk',
    [
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:02.000Z',
      '2026-01-01T00:00:03.000Z',
      '2026-01-01T00:00:04.000Z',
    ],
    { 2: { prev_hash: 'missing-hash' } },
  );

  const forked = buildChain(
    orgs.forked,
    users.forked,
    'fork',
    [
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:02.000Z',
      '2026-01-01T00:00:03.000Z',
      '2026-01-01T00:00:04.000Z',
    ],
    { 2: { prev_hash: 'fork-0' } },
  );

  const fixtures = [...tied, ...inverted, ...broken, ...forked];

  const chainRows = (orgId) => db('events')
    .where({ organization_id: orgId })
    .orderBy('chain_seq', 'asc')
    .select('id', 'record_hash', 'chain_seq');

  const expectChain = async (orgId, expectedHashes) => {
    const rows = await chainRows(orgId);
    expect(rows.map((row) => row.record_hash)).toEqual(expectedHashes);
    expect(rows.map((row) => Number(row.chain_seq))).toEqual(
      expectedHashes.map((_, index) => index + 1),
    );
  };

  beforeAll(async () => {
    db = require('./knex');
    // eslint-disable-next-line global-require
    migration = require('./migrations/20261103000001_add_chain_seq_to_events');
    // eslint-disable-next-line global-require
    verifier = require('../jobs/hash-chain-verifier');

    // Full schema, including the migration under test.
    await db.migrate.latest({ directory: MIGRATIONS_DIR });

    // Rewind using the real down migration so the fixture insert sees the
    // pre-migration schema.
    await migration.down(db);

    await db('organizations').insert(
      Object.entries(orgs).map(([key, id]) => ({
        id,
        name: `P0-02 Migration ${key}`,
        slug: `p0-02-mig-${key}-${id.slice(0, 8)}`,
      })),
    );

    await db('users').insert(
      Object.entries(users).map(([key, id]) => ({
        id,
        organization_id: orgs[key],
        first_name: 'Mig',
        last_name: key,
        email: `${id}@example.test`,
        role: 'org_admin',
        status: 'active',
      })),
    );

    await db('events').insert(fixtures);

    // Re-apply: this is the step that adds and backfills chain_seq.
    await migration.up(db);
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('adds a NOT NULL bigint column with a unique per-org index', async () => {
    const column = await db('information_schema.columns')
      .where({ table_name: 'events', column_name: 'chain_seq' })
      .first();
    expect(column).toBeTruthy();
    expect(column.data_type).toBe('bigint');
    expect(column.is_nullable).toBe('NO');

    const index = await db('pg_indexes')
      .where({ tablename: 'events', indexname: 'idx_events_org_chain_seq' })
      .first();
    expect(index).toBeTruthy();
    expect(index.indexdef).toContain('UNIQUE');

    const constraint = await db('pg_constraint')
      .where({ conname: 'events_chain_seq_positive' })
      .first();
    expect(constraint).toBeTruthy();
  });

  it('backfills a valid chain in linkage order when created_at is tied', async () => {
    await expectChain(orgs.tied, ['tied-0', 'tied-1', 'tied-2', 'tied-3', 'tied-4', 'tied-5']);
  });

  it('backfills a valid chain in linkage order when created_at is inverted', async () => {
    await expectChain(orgs.inverted, ['inv-0', 'inv-1', 'inv-2', 'inv-3']);
  });

  it('leaves valid chains verifiable after the backfill', async () => {
    for (const orgId of [orgs.tied, orgs.inverted]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await verifier.verifyHashChain({ organizationId: orgId });
      expect(result.failures).toEqual([]);
    }
  });

  it('preserves an existing chain break instead of hiding it', async () => {
    await expectChain(orgs.broken, ['brk-0', 'brk-1', 'brk-2', 'brk-3']);

    const result = await verifier.verifyHashChain({ organizationId: orgs.broken });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      eventId: broken[2].id,
      chainSeq: 3,
      reason: 'chain_link_mismatch',
    });
  });

  it('keeps a forked chain deterministic and unique', async () => {
    await expectChain(orgs.forked, ['fork-0', 'fork-1', 'fork-2', 'fork-3']);

    const result = await verifier.verifyHashChain({ organizationId: orgs.forked });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      eventId: forked[2].id,
      chainSeq: 3,
      reason: 'chain_link_mismatch',
    });
  });

  it('numbers each organization independently', async () => {
    const counts = { tied: 6, inverted: 4, broken: 4, forked: 4 };
    for (const [key, orgId] of Object.entries(orgs)) {
      // eslint-disable-next-line no-await-in-loop
      const seq = await db('events').where({ organization_id: orgId }).pluck('chain_seq');
      expect(seq.map(Number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: counts[key] }, (_, index) => index + 1),
      );
    }
  });

  it('rejects duplicate chain_seq values within an organization', async () => {
    await expect(
      db('events').where({ id: tied[0].id }).update({ chain_seq: 99 }),
    ).resolves.toBe(1);

    await expect(
      db('events').where({ id: tied[1].id }).update({ chain_seq: 99 }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('records the migration as applied', async () => {
    const applied = await db('knex_migrations').where({ name: MIGRATION_NAME }).first();
    expect(applied).toBeTruthy();
  });
});
