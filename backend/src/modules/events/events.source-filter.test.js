/**
 * P1-08 regression tests — event list filters by `source`.
 *
 * Schema cases need no database. The query cases require a disposable local
 * PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p108_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p108_test \
 *   npx jest --runInBand src/modules/events/events.source-filter.test.js
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
const { getEventsQuerySchema } = require('./events.validation');

describe('P1-08 event list source validation', () => {
  it('accepts a known source and keeps the cursor pagination default', () => {
    const parsed = getEventsQuerySchema.parse({ source: 'scan' });

    expect(parsed.source).toBe('scan');
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.page).toBeUndefined();
  });

  it('rejects an unknown source', () => {
    const result = getEventsQuerySchema.safeParse({ source: 'barcode' });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['source']);
  });

  it('rejects the removed offset page parameter', () => {
    const result = getEventsQuerySchema.safeParse({ page: 2 });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual([]);
  });
});

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-08 event list source filter', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;

  const seedOrganization = async (label) => {
    const organizationId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: organizationId,
      name: `P1-08 ${label}`,
      slug: `p1-08-${label}-${organizationId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'P1',
      last_name: 'Source',
      email: `${organizationId}@example.test`,
      role: 'operator',
      status: 'active',
    });

    return { organizationId, userId };
  };

  const seedEvent = async ({
    organizationId,
    userId,
    source,
    eventType = 'receiving',
    chainSeq,
  }) => {
    const id = uuidv4();

    await db('events').insert({
      id,
      organization_id: organizationId,
      event_type: eventType,
      event_datetime: new Date('2026-06-01T12:00:00.000Z'),
      recorded_by: userId,
      source,
      kde_payload: JSON.stringify({}),
      record_hash: `p1-08-hash-${id}`,
      prev_hash: chainSeq === 1 ? 'GENESIS' : `p1-08-hash-${chainSeq - 1}`,
      chain_seq: chainSeq,
      hash_key_id: 'p1-08-test-key',
    });

    return id;
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('returns only events with the requested source', async () => {
    const { organizationId, userId } = await seedOrganization('primary');

    await seedEvent({ organizationId, userId, source: 'scan', chainSeq: 1 });
    await seedEvent({ organizationId, userId, source: 'scan', chainSeq: 2 });
    await seedEvent({ organizationId, userId, source: 'manual', chainSeq: 3 });

    const { data, pagination } = await eventsService.getEvents(
      { limit: 20, source: 'scan' },
      organizationId,
    );

    expect(data).toHaveLength(2);
    expect(data.every((event) => event.source === 'scan')).toBe(true);
    expect(pagination).toEqual({
      limit: 20,
      hasNextPage: false,
      nextCursor: null,
    });
  });

  it('combines the source filter with the event type filter', async () => {
    const { organizationId, userId } = await seedOrganization('combined');

    await seedEvent({ organizationId, userId, source: 'scan', eventType: 'receiving', chainSeq: 1 });
    await seedEvent({ organizationId, userId, source: 'scan', eventType: 'shipping', chainSeq: 2 });
    await seedEvent({ organizationId, userId, source: 'manual', eventType: 'receiving', chainSeq: 3 });

    const { data } = await eventsService.getEvents(
      { limit: 20, source: 'scan', eventType: 'receiving' },
      organizationId,
    );

    expect(data).toHaveLength(1);
    expect(data[0].source).toBe('scan');
    expect(data[0].event_type).toBe('receiving');
  });

  it('never returns another organization\'s matching events', async () => {
    const first = await seedOrganization('first');
    const second = await seedOrganization('second');

    await seedEvent({ organizationId: first.organizationId, userId: first.userId, source: 'scan', chainSeq: 1 });
    await seedEvent({ organizationId: second.organizationId, userId: second.userId, source: 'scan', chainSeq: 1 });

    const { data, pagination } = await eventsService.getEvents(
      { limit: 20, source: 'scan' },
      first.organizationId,
    );

    expect(data).toHaveLength(1);
    expect(data[0].organization_id).toBe(first.organizationId);
    expect(pagination).toEqual({
      limit: 20,
      hasNextPage: false,
      nextCursor: null,
    });
  });
});
