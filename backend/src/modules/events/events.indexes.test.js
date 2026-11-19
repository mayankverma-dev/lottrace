/**
 * P2-05 regression tests — event-list index definitions.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p205_test \
 *   npx jest --runInBand src/modules/events/events.indexes.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../trace/trace.service', () => ({
  bumpTraceCacheVersion: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));

const path = require('path');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P2-05 event list indexes', () => {
  jest.setTimeout(120000);

  let db;
  let indexes;

  beforeAll(async () => {
    db = require('../../db/knex');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });

    const { rows } = await db.raw(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('events', 'event_lot_links')
    `);
    indexes = new Map(rows.map((row) => [row.indexname, row.indexdef]));
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it.each([
    ['idx_events_org_created_seq', /\(organization_id, created_at DESC, chain_seq DESC\)/],
    ['idx_events_org_type_created_seq', /\(organization_id, event_type, created_at DESC, chain_seq DESC\)/],
    ['idx_events_org_status_created_seq', /\(organization_id, status, created_at DESC, chain_seq DESC\)/],
    ['idx_events_org_source_created_seq', /\(organization_id, source, created_at DESC, chain_seq DESC\)/],
    ['idx_events_org_location_created_seq', /\(organization_id, location_id, created_at DESC, chain_seq DESC\)/],
    ['idx_ell_lot_event', /\(lot_id, event_id\)/],
  ])('defines %s with the keyset column order', (name, pattern) => {
    expect(indexes.get(name)).toMatch(pattern);
  });

  it.each([
    'idx_events_org',
    'idx_events_org_type',
    'idx_events_org_status',
    'idx_ell_lot',
  ])('removes the superseded index %s', (name) => {
    expect(indexes.has(name)).toBe(false);
  });
});
