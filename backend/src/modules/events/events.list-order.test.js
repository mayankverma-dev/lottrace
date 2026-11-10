/**
 * P2-12 regression test — stable event list pagination.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p002_test \
 *   npx jest --runInBand src/modules/events/events.list-order.test.js
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
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P2-12 stable event list pagination', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let organizationId;
  let userId;

  const seedOrganization = async () => {
    organizationId = uuidv4();
    userId = uuidv4();

    await db('organizations').insert({
      id: organizationId,
      name: 'P2-12 pagination',
      slug: `p2-12-${organizationId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'P2',
      last_name: 'Tester',
      email: `${organizationId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });
  };

  /**
   * Inserts events that share one `created_at`, the same shape PostgreSQL
   * produces when concurrent transactions begin in the same millisecond.
   */
  const seedTiedTimestamps = async (count) => {
    const createdAt = new Date('2026-06-01T12:00:00.000Z');

    for (let index = 0; index < count; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await db('events').insert({
        id: uuidv4(),
        organization_id: organizationId,
        event_type: 'creation',
        event_datetime: new Date(Date.UTC(2026, 5, 1, 12, 0, index)),
        recorded_by: userId,
        source: 'manual',
        kde_payload: JSON.stringify({ sequence: index }),
        record_hash: `p2-12-hash-${index + 1}`,
        prev_hash: index === 0 ? 'GENESIS' : `p2-12-hash-${index}`,
        chain_seq: index + 1,
        created_at: createdAt,
      });
    }
  };

  const page = async (pageNumber, limit) => eventsService.getEvents(
    { page: pageNumber, limit },
    organizationId,
  );

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(async () => {
    await seedOrganization();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('orders tied created_at rows by chain position', async () => {
    await seedTiedTimestamps(5);

    const { data } = await page(1, 5);

    expect(data.map((event) => Number(event.chain_seq))).toEqual([5, 4, 3, 2, 1]);
  });

  it('partitions every event into exactly one page', async () => {
    await seedTiedTimestamps(5);

    const first = await page(1, 2);
    const second = await page(2, 2);
    const third = await page(3, 2);

    const seen = [...first.data, ...second.data, ...third.data]
      .map((event) => event.id);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(first.data.map((event) => Number(event.chain_seq))).toEqual([5, 4]);
    expect(second.data.map((event) => Number(event.chain_seq))).toEqual([3, 2]);
    expect(third.data.map((event) => Number(event.chain_seq))).toEqual([1]);
    expect(first.pagination.total).toBe(5);
    expect(third.pagination.hasNextPage).toBe(false);
  });
});
