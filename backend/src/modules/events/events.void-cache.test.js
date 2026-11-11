/**
 * P1-23 regression tests — voiding an event must invalidate warm trace cache.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p123_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p123_test \
 *   npx jest --runInBand src/modules/events/events.void-cache.test.js
 *
 * Redis is replaced with an in-memory map so the test proves invalidation
 * without depending on a live Redis instance. The suite drops and recreates
 * the public schema in the disposable database. dbGuard refuses Neon,
 * non-local hosts, and names without the `_test` suffix.
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

describeDb('P1-23 event void invalidates trace cache', () => {
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
    const outputLotId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: 'P1-23 trace cache',
      slug: `p1-23-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Cache',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: 'P1-23 Product',
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    await db('lots').insert([
      {
        id: inputLotId,
        organization_id: orgId,
        product_id: productId,
        traceability_lot_code: 'P1-23-INPUT',
        quantity: 100,
        uom: 'kg',
        created_by: userId,
      },
      {
        id: outputLotId,
        organization_id: orgId,
        product_id: productId,
        traceability_lot_code: 'P1-23-OUTPUT',
        quantity: 80,
        uom: 'kg',
        created_by: userId,
      },
    ]);

    return { orgId, userId, productId, inputLotId, outputLotId };
  };

  const createTransformation = (org) => eventsService.createEvent({
    eventType: 'transformation',
    eventDatetime: '2026-11-11T10:00:00.000Z',
    source: 'manual',
    kdePayload: {},
    counterpartyInfo: null,
    inputs: [{ lotId: org.inputLotId, quantity: 20, uom: 'kg' }],
    outputs: [{ lotId: org.outputLotId, quantity: 18, uom: 'kg' }],
  }, org.orgId, org.userId);

  const nodeIds = (trace) => trace.nodes.map((node) => node.id).sort();

  beforeAll(async () => {
    db = require('../../db/knex');
    redis = require('../../config/redis');
    eventsService = require('./events.service');
    traceService = require('../trace/trace.service');

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

  it('recomputes a warm trace without the voided event', async () => {
    const org = await seedOrganization();
    const event = await createTransformation(org);

    const warm = await traceService.fullTrace(org.inputLotId, org.orgId);
    expect(warm.cached).toBeUndefined();
    expect(nodeIds(warm)).toEqual([org.inputLotId, org.outputLotId].sort());
    expect(warm.edges).toEqual([
      expect.objectContaining({ from: org.inputLotId, to: org.outputLotId, eventId: event.id }),
    ]);
    expect(redis.__store.has(`trace:v2:${org.orgId}:${org.inputLotId}:full`)).toBe(true);

    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId);

    const lotKeys = [...redis.__store.keys()].filter(
      (key) => key.startsWith(`trace:v2:${org.orgId}:`),
    );
    expect(lotKeys).toEqual([]);

    const afterVoid = await traceService.fullTrace(org.inputLotId, org.orgId);
    expect(afterVoid.cached).toBeUndefined();
    expect(nodeIds(afterVoid)).toEqual([org.inputLotId]);
    expect(afterVoid.edges).toEqual([]);
  });

  it('keeps the warm trace when the void is rejected', async () => {
    const org = await seedOrganization();
    const event = await createTransformation(org);

    await traceService.fullTrace(org.inputLotId, org.orgId);
    await eventsService.voidEvent(event.id, 'first void', org.orgId);
    await traceService.fullTrace(org.inputLotId, org.orgId);

    await expect(
      eventsService.voidEvent(event.id, 'second void', org.orgId),
    ).rejects.toMatchObject({ code: 'EVENT_IMMUTABLE', statusCode: 409 });

    expect(redis.__store.has(`trace:v2:${org.orgId}:${org.inputLotId}:full`)).toBe(true);
  });
});
