/**
 * P0-11 regression tests — trace must exclude superseded (amended) events.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p011_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p011_test \
 *   npx jest --runInBand src/modules/trace/trace.amended-events.test.js
 *
 * Redis is replaced with an in-memory map so the suite does not depend on a
 * live Redis instance. The suite drops and recreates the public schema in the
 * disposable database. dbGuard refuses Neon, non-local hosts, and names
 * without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../../config/redis', () => {
  const store = new Map();
  return {
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys) => {
      let deleted = 0;
      keys.forEach((key) => {
        if (store.delete(key)) deleted += 1;
      });
      return deleted;
    }),
    __store: store,
  };
});

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P0-11 trace excludes amended events', () => {
  jest.setTimeout(120000);

  let db;
  let redis;
  let eventsService;
  let traceService;

  const seedOrganization = async () => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();
    const inputLotId = uuidv4();
    const oldOutputLotId = uuidv4();
    const newOutputLotId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: 'P0-11 trace amendment',
      slug: `p0-11-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P0',
      last_name: 'Amendment',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: 'P0-11 Product',
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    await db('lots').insert([
      {
        id: inputLotId,
        organization_id: orgId,
        product_id: productId,
        traceability_lot_code: 'P0-11-INPUT',
        quantity: 100,
        uom: 'kg',
        created_by: userId,
      },
      {
        id: oldOutputLotId,
        organization_id: orgId,
        product_id: productId,
        traceability_lot_code: 'P0-11-OLD-OUTPUT',
        quantity: 80,
        uom: 'kg',
        created_by: userId,
      },
      {
        id: newOutputLotId,
        organization_id: orgId,
        product_id: productId,
        traceability_lot_code: 'P0-11-NEW-OUTPUT',
        quantity: 70,
        uom: 'kg',
        created_by: userId,
      },
    ]);

    return { orgId, userId, productId, inputLotId, oldOutputLotId, newOutputLotId };
  };

  const createTransformation = (org, overrides = {}) => eventsService.createEvent({
    eventType: 'transformation',
    eventDatetime: '2026-11-11T10:00:00.000Z',
    source: 'manual',
    kdePayload: {},
    counterpartyInfo: null,
    inputs: [{ lotId: org.inputLotId, quantity: 10, uom: 'kg' }],
    outputs: [{ lotId: org.oldOutputLotId, quantity: 9, uom: 'kg' }],
    ...overrides,
  }, org.orgId, org.userId);

  const amendTransformation = (org, eventId, overrides = {}) => eventsService.amendEvent(eventId, {
    eventType: 'transformation',
    eventDatetime: '2026-11-11T11:00:00.000Z',
    source: 'manual',
    kdePayload: { corrected: true },
    counterpartyInfo: null,
    notes: 'corrected event',
    inputs: [{ lotId: org.inputLotId, quantity: 10, uom: 'kg' }],
    outputs: [{ lotId: org.oldOutputLotId, quantity: 9, uom: 'kg' }],
    voidReason: 'wrong output lot recorded',
    ...overrides,
  }, org.orgId, org.userId);

  const nodeIds = (trace) => trace.nodes.map((node) => node.id).sort();

  beforeAll(async () => {
    db = require('../../db/knex');
    redis = require('../../config/redis');
    eventsService = require('../events/events.service');
    traceService = require('./trace.service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(() => {
    redis.__store.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('excludes an amended event with changed links from every trace direction', async () => {
    const org = await seedOrganization();
    const original = await createTransformation(org);

    const warm = await traceService.fullTrace(org.inputLotId, org.orgId);
    expect(nodeIds(warm)).toEqual([org.inputLotId, org.oldOutputLotId].sort());
    expect(warm.edges).toEqual([
      expect.objectContaining({
        from: org.inputLotId,
        to: org.oldOutputLotId,
        eventId: original.id,
      }),
    ]);

    const replacement = await amendTransformation(org, original.id, {
      outputs: [{ lotId: org.newOutputLotId, quantity: 8, uom: 'kg' }],
    });

    const oldRow = await db('events').where({ id: original.id }).first();
    const newRow = await db('events').where({ id: replacement.id }).first();
    expect(oldRow.status).toBe('amended');
    expect(newRow.status).toBe('active');
    expect(newRow.supersedes_event_id).toBe(original.id);

    // The pre-amendment full-trace cache for the input lot must be gone.
    const inputCacheKeys = [...redis.__store.keys()].filter(
      (key) => key.startsWith(`trace:v2:${org.orgId}:${org.inputLotId}:`),
    );
    expect(inputCacheKeys).toEqual([]);

    const forward = await traceService.forwardTrace(org.inputLotId, org.orgId);
    expect(nodeIds(forward)).toEqual([org.inputLotId, org.newOutputLotId].sort());
    expect(forward.edges).toEqual([
      expect.objectContaining({
        from: org.inputLotId,
        to: org.newOutputLotId,
        eventId: replacement.id,
      }),
    ]);
    expect(forward.edges.some((edge) => edge.eventId === original.id)).toBe(false);
    expect(forward.nodes.some((node) => node.id === org.oldOutputLotId)).toBe(false);

    const backwardOldOutput = await traceService.backwardTrace(org.oldOutputLotId, org.orgId);
    expect(nodeIds(backwardOldOutput)).toEqual([org.oldOutputLotId]);
    expect(backwardOldOutput.edges).toEqual([]);

    const backwardNewOutput = await traceService.backwardTrace(org.newOutputLotId, org.orgId);
    expect(nodeIds(backwardNewOutput)).toEqual([org.inputLotId, org.newOutputLotId].sort());
    expect(backwardNewOutput.edges).toEqual([
      expect.objectContaining({
        from: org.inputLotId,
        to: org.newOutputLotId,
        eventId: replacement.id,
      }),
    ]);

    const full = await traceService.fullTrace(org.inputLotId, org.orgId);
    expect(nodeIds(full)).toEqual([org.inputLotId, org.newOutputLotId].sort());
    expect(full.edges).toHaveLength(1);
    expect(full.edges[0]).toMatchObject({
      from: org.inputLotId,
      to: org.newOutputLotId,
      eventId: replacement.id,
    });
    expect(full.edges.some((edge) => edge.eventId === original.id)).toBe(false);
  });

  it('keeps exactly one current edge when the amendment keeps the same links', async () => {
    const org = await seedOrganization();
    const original = await createTransformation(org);

    const replacement = await amendTransformation(org, original.id, {
      eventDatetime: '2026-11-11T12:00:00.000Z',
      inputs: [{ lotId: org.inputLotId, quantity: 11, uom: 'kg' }],
      outputs: [{ lotId: org.oldOutputLotId, quantity: 12, uom: 'kg' }],
    });

    const full = await traceService.fullTrace(org.inputLotId, org.orgId);
    expect(full.edges).toHaveLength(1);
    expect(full.edges[0]).toMatchObject({
      from: org.inputLotId,
      to: org.oldOutputLotId,
      eventId: replacement.id,
    });
    expect(full.edges.some((edge) => edge.eventId === original.id)).toBe(false);
  });

  it('keeps the superseded event available through event detail and the event list', async () => {
    const org = await seedOrganization();
    const original = await createTransformation(org);
    const replacement = await amendTransformation(org, original.id);

    const superseded = await eventsService.getEventById(original.id, org.orgId);
    expect(superseded.status).toBe('amended');
    expect(superseded.inputs.map((link) => link.lot_id)).toEqual([org.inputLotId]);
    expect(superseded.outputs.map((link) => link.lot_id)).toEqual([org.oldOutputLotId]);

    const current = await eventsService.getEventById(replacement.id, org.orgId);
    expect(current.status).toBe('active');
    expect(current.supersedes_event_id).toBe(original.id);

    const listed = await eventsService.getEvents({ page: 1, limit: 20 }, org.orgId);
    const listedOriginal = listed.data.find((event) => event.id === original.id);
    const listedReplacement = listed.data.find((event) => event.id === replacement.id);
    expect(listedOriginal.status).toBe('amended');
    expect(listedReplacement.status).toBe('active');
    expect(listedReplacement.supersedes_event_id).toBe(original.id);
  });

  it('ignores trace results cached under the old cache namespace', async () => {
    const org = await seedOrganization();
    await createTransformation(org);

    const legacyNodeId = uuidv4();
    await redis.set(
      `trace:${org.orgId}:${org.inputLotId}:full`,
      JSON.stringify({
        nodes: [{ id: legacyNodeId, traceabilityLotCode: 'LEGACY-CACHE' }],
        edges: [],
        hops: 99,
        truncated: false,
        startLot: { id: org.inputLotId, traceabilityLotCode: 'P0-11-INPUT' },
        direction: 'full',
      }),
    );

    const trace = await traceService.fullTrace(org.inputLotId, org.orgId);
    expect(trace.hops).not.toBe(99);
    expect(trace.nodes.some((node) => node.id === legacyNodeId)).toBe(false);
    expect(nodeIds(trace)).toEqual([org.inputLotId, org.oldOutputLotId].sort());
  });
});
