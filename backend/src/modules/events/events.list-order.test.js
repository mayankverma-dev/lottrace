/**
 * P2-05/P2-12 regression tests — stable keyset event-list pagination.
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
  bumpTraceCacheVersion: jest.fn().mockResolvedValue(undefined),
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

describeDb('P2-05 stable keyset event-list pagination', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let hashChain;
  let organizationId;
  let userId;

  const seedOrganization = async () => {
    organizationId = uuidv4();
    userId = uuidv4();

    await db('organizations').insert({
      id: organizationId,
      name: 'P2-05 pagination',
      slug: `p2-05-${organizationId.slice(0, 8)}`,
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
  const seedTiedTimestamps = async (count, startSeq = 1) => {
    const createdAt = new Date('2026-06-01T12:00:00.000Z');

    for (let index = 0; index < count; index += 1) {
      const chainSeq = startSeq + index;
      // eslint-disable-next-line no-await-in-loop
      await db('events').insert({
        id: uuidv4(),
        organization_id: organizationId,
        event_type: 'creation',
        event_datetime: new Date(Date.UTC(2026, 5, 1, 12, 0, chainSeq)),
        recorded_by: userId,
        source: 'manual',
        kde_payload: JSON.stringify({ sequence: chainSeq }),
        record_hash: `p2-05-hash-${chainSeq}`,
        prev_hash: chainSeq === 1 ? 'GENESIS' : `p2-05-hash-${chainSeq - 1}`,
        chain_seq: chainSeq,
        hash_key_id: hashChain.getCurrentHashKeyId(),
        created_at: createdAt,
      });
    }
  };

  const seedEventAt = async (createdAt, chainSeq) => {
    await db('events').insert({
      id: uuidv4(),
      organization_id: organizationId,
      event_type: 'creation',
      event_datetime: new Date('2026-06-01T12:00:00.000Z'),
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({ sequence: chainSeq }),
      record_hash: `p2-05-micro-hash-${chainSeq}`,
      prev_hash: chainSeq === 1 ? 'GENESIS' : `p2-05-micro-hash-${chainSeq - 1}`,
      chain_seq: chainSeq,
      hash_key_id: hashChain.getCurrentHashKeyId(),
      created_at: db.raw('?::timestamptz', [createdAt]),
    });
  };

  const listEvents = ({ limit = 20, cursor } = {}) => eventsService.getEvents(
    { limit, ...(cursor ? { cursor } : {}) },
    organizationId,
  );

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    hashChain = require('../../utils/hashChain');

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

    const { data } = await listEvents({ limit: 5 });

    expect(data.map((event) => Number(event.chain_seq))).toEqual([5, 4, 3, 2, 1]);
  });

  it('partitions every event into exactly one page with cursors', async () => {
    await seedTiedTimestamps(5);

    const first = await listEvents({ limit: 2 });
    const second = await listEvents({ limit: 2, cursor: first.pagination.nextCursor });
    const third = await listEvents({ limit: 2, cursor: second.pagination.nextCursor });

    const seen = [...first.data, ...second.data, ...third.data]
      .map((event) => event.id);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(first.data.map((event) => Number(event.chain_seq))).toEqual([5, 4]);
    expect(second.data.map((event) => Number(event.chain_seq))).toEqual([3, 2]);
    expect(third.data.map((event) => Number(event.chain_seq))).toEqual([1]);
    expect(first.pagination).toEqual({
      limit: 2,
      hasNextPage: true,
      nextCursor: expect.any(String),
    });
    expect(third.pagination).toEqual({
      limit: 2,
      hasNextPage: false,
      nextCursor: null,
    });
  });

  it('does not duplicate rows when a newer event arrives between pages', async () => {
    await seedTiedTimestamps(5);

    const first = await listEvents({ limit: 2 });
    await seedTiedTimestamps(1, 6);
    const second = await listEvents({ limit: 2, cursor: first.pagination.nextCursor });

    expect(first.data.map((event) => Number(event.chain_seq))).toEqual([5, 4]);
    expect(second.data.map((event) => Number(event.chain_seq))).toEqual([3, 2]);
    expect(second.data.map((event) => event.id)).not.toContain(first.data[0].id);
  });

  it('preserves microsecond created_at values in the cursor', async () => {
    await seedEventAt('2026-06-01T12:00:00.000100Z', 1);
    await seedEventAt('2026-06-01T12:00:00.000200Z', 2);
    await seedEventAt('2026-06-01T12:00:00.000300Z', 3);

    const first = await listEvents({ limit: 1 });
    const second = await listEvents({ limit: 1, cursor: first.pagination.nextCursor });
    const third = await listEvents({ limit: 1, cursor: second.pagination.nextCursor });

    expect(first.data.map((event) => Number(event.chain_seq))).toEqual([3]);
    expect(second.data.map((event) => Number(event.chain_seq))).toEqual([2]);
    expect(third.data.map((event) => Number(event.chain_seq))).toEqual([1]);
  });
});
