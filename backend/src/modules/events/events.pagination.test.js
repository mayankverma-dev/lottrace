/**
 * P2-05 regression tests — cursor pagination, filters, and validation.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:REPLACE_WITH_LOCAL_PASSWORD@127.0.0.1:5432/lottrace_p205_test \
 *   npx jest --runInBand src/modules/events/events.pagination.test.js
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

describe('P2-05 event list query validation', () => {
  it('defaults to limit 20 and rejects the removed page parameter', () => {
    expect(getEventsQuerySchema.parse({})).toEqual({ limit: 20 });

    const page = getEventsQuerySchema.safeParse({ page: 2 });
    expect(page.success).toBe(false);
  });

  it('rejects limits outside 1..100', () => {
    expect(getEventsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(getEventsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(getEventsQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });
});

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P2-05 event list keyset pagination', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let organizationId;
  let fixture;

  const seedOrganization = async () => {
    const orgId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: 'P2-05 pagination',
      slug: `p2-05-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P2',
      last_name: 'Pagination',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    return { orgId, userId };
  };

  const seedFixture = async () => {
    const org = await seedOrganization();
    const productId = uuidv4();
    const lotId = uuidv4();
    const locationId = uuidv4();

    await db('products').insert({
      id: productId,
      organization_id: org.orgId,
      name: 'P2-05 product',
    });
    await db('lots').insert({
      id: lotId,
      organization_id: org.orgId,
      product_id: productId,
      traceability_lot_code: `P2-05-${lotId.slice(0, 8)}`,
      quantity: 1,
      uom: 'kg',
    });
    await db('locations').insert({
      id: locationId,
      organization_id: org.orgId,
      name: 'P2-05 location',
      type: 'plant',
    });

    const eventIds = [];
    for (let index = 1; index <= 6; index += 1) {
      const eventId = uuidv4();
      eventIds.push(eventId);
      // eslint-disable-next-line no-await-in-loop
      await db('events').insert({
        id: eventId,
        organization_id: org.orgId,
        event_type: index % 2 === 0 ? 'shipping' : 'creation',
        event_datetime: new Date(Date.UTC(2026, 10, 19, 10, 0, index)),
        location_id: index <= 3 ? locationId : null,
        recorded_by: org.userId,
        source: index <= 3 ? 'scan' : 'manual',
        kde_payload: JSON.stringify({ index }),
        record_hash: `p2-05-page-hash-${index}`,
        prev_hash: index === 1 ? 'GENESIS' : `p2-05-page-hash-${index - 1}`,
        chain_seq: index,
        hash_key_id: 'p2-05-test-key',
        status: index === 5 ? 'amended' : index === 6 ? 'void' : 'active',
        created_at: new Date(Date.UTC(2026, 10, 19, 10, 0, index)),
      });
    }

    for (const eventId of eventIds.slice(0, 3)) {
      // eslint-disable-next-line no-await-in-loop
      await db('event_lot_links').insert({
        organization_id: org.orgId,
        event_id: eventId,
        lot_id: lotId,
        direction: 'output',
        quantity: 1,
        uom: 'kg',
      });
    }

    return {
      ...org,
      locationId,
      lotId,
      eventIds,
      linkedEventIds: new Set(eventIds.slice(0, 3)),
    };
  };

  const list = (params = {}, orgId = organizationId) => eventsService.getEvents(
    { limit: 20, ...params },
    orgId,
  );

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(async () => {
    fixture = await seedFixture();
    organizationId = fixture.orgId;
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('returns the cursor pagination shape and strips the internal cursor field', async () => {
    const result = await list({ limit: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.data.every((event) => !Object.hasOwn(event, 'created_at_cursor'))).toBe(true);
    expect(result.pagination).toEqual({
      limit: 2,
      hasNextPage: true,
      nextCursor: expect.any(String),
    });
  });

  it('returns an empty page with a null cursor', async () => {
    const result = await list({ limit: 2, eventType: 'transformation' });

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      limit: 2,
      hasNextPage: false,
      nextCursor: null,
    });
  });

  it('rejects an invalid cursor with a 422 validation error', async () => {
    await expect(list({ cursor: 'not-json' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it.each([
    ['eventType', { eventType: 'shipping' }, (event) => event.event_type === 'shipping'],
    ['status', { status: 'active' }, (event) => event.status === 'active'],
    ['source', { source: 'scan' }, (event) => event.source === 'scan'],
  ])('keeps the %s filter while following a cursor', async (_name, filters, predicate) => {
    const first = await list({ limit: 1, ...filters });
    const second = await list({ limit: 1, ...filters, cursor: first.pagination.nextCursor });

    expect(first.data).toHaveLength(1);
    expect(second.data).toHaveLength(1);
    expect(predicate(first.data[0])).toBe(true);
    expect(predicate(second.data[0])).toBe(true);
    expect(second.data[0].id).not.toBe(first.data[0].id);
  });

  it('keeps the location filter while following a cursor', async () => {
    const first = await list({ limit: 1, locationId: fixture.locationId });
    const second = await list({
      limit: 1,
      locationId: fixture.locationId,
      cursor: first.pagination.nextCursor,
    });

    expect(first.data[0].location_id).toBe(fixture.locationId);
    expect(second.data[0].location_id).toBe(fixture.locationId);
    expect(second.data[0].id).not.toBe(first.data[0].id);
  });

  it('keeps the lot filter while following a cursor', async () => {
    const first = await list({ limit: 1, lotId: fixture.lotId });
    const second = await list({
      limit: 1,
      lotId: fixture.lotId,
      cursor: first.pagination.nextCursor,
    });

    expect(fixture.linkedEventIds.has(first.data[0].id)).toBe(true);
    expect(fixture.linkedEventIds.has(second.data[0].id)).toBe(true);
    expect(second.data[0].id).not.toBe(first.data[0].id);
  });

  it('keeps the date range filter while following a cursor', async () => {
    const filters = {
      dateFrom: '2026-11-19T10:00:02.000Z',
      dateTo: '2026-11-19T10:00:04.000Z',
    };
    const first = await list({ limit: 1, ...filters });
    const second = await list({ limit: 1, ...filters, cursor: first.pagination.nextCursor });

    expect(first.data[0].event_datetime.toISOString()).toBe('2026-11-19T10:00:04.000Z');
    expect(second.data[0].event_datetime.toISOString()).toBe('2026-11-19T10:00:03.000Z');
  });

  it('keeps the public created_at order when a date range matches backdated events', async () => {
    const backdatedId = uuidv4();
    const outsideId = uuidv4();

    await db('events').insert([
      {
        id: backdatedId,
        organization_id: organizationId,
        event_type: 'receiving',
        event_datetime: new Date('2026-11-19T10:00:02.500Z'),
        recorded_by: fixture.userId,
        source: 'scan',
        kde_payload: JSON.stringify({}),
        record_hash: 'p2-41-backdated',
        prev_hash: 'p2-41-prev',
        chain_seq: 7,
        hash_key_id: 'p2-41-test-key',
        status: 'active',
        created_at: new Date('2026-11-19T10:00:10.000Z'),
      },
      {
        id: outsideId,
        organization_id: organizationId,
        event_type: 'shipping',
        event_datetime: new Date('2026-11-19T10:00:05.000Z'),
        recorded_by: fixture.userId,
        source: 'scan',
        kde_payload: JSON.stringify({}),
        record_hash: 'p2-41-outside',
        prev_hash: 'p2-41-prev-2',
        chain_seq: 8,
        hash_key_id: 'p2-41-test-key',
        status: 'active',
        created_at: new Date('2026-11-19T10:00:11.000Z'),
      },
    ]);

    const filters = {
      dateFrom: '2026-11-19T10:00:02.000Z',
      dateTo: '2026-11-19T10:00:04.000Z',
    };

    const first = await list({ limit: 2, ...filters });
    expect(first.data.map((event) => event.id)).toEqual([
      backdatedId,
      fixture.eventIds[3],
    ]);
    expect(first.data.some((event) => event.id === outsideId)).toBe(false);
    expect(first.data.every((event) => !Object.hasOwn(event, 'matched_count'))).toBe(true);

    const second = await list({
      limit: 2,
      ...filters,
      cursor: first.pagination.nextCursor,
    });
    expect(second.data.map((event) => event.id)).toEqual([
      fixture.eventIds[2],
      fixture.eventIds[1],
    ]);
  });

  it('supports open-ended date filters', async () => {
    const fromOnly = await list({ limit: 20, dateFrom: '2026-11-19T10:00:05.000Z' });
    const toOnly = await list({ limit: 20, dateTo: '2026-11-19T10:00:02.000Z' });

    expect(fromOnly.data.map((event) => event.chain_seq)).toEqual(['6', '5']);
    expect(toOnly.data.map((event) => event.chain_seq)).toEqual(['2', '1']);
  });

  it('never returns another organization\'s rows when given a foreign cursor', async () => {
    const first = await list({ limit: 1 });
    const other = await seedOrganization();
    const otherEventId = uuidv4();

    await db('events').insert({
      id: otherEventId,
      organization_id: other.orgId,
      event_type: 'creation',
      event_datetime: new Date('2026-11-19T09:00:00.000Z'),
      recorded_by: other.userId,
      source: 'manual',
      kde_payload: JSON.stringify({}),
      record_hash: 'p2-05-other-hash',
      prev_hash: 'GENESIS',
      chain_seq: 1,
      hash_key_id: 'p2-05-test-key',
      created_at: new Date('2026-11-19T09:00:00.000Z'),
    });

    const result = await list({ cursor: first.pagination.nextCursor }, other.orgId);

    expect(result.data.map((event) => event.id)).toEqual([otherEventId]);
    expect(result.data.map((event) => event.id)).not.toContain(first.data[0].id);
  });
});
