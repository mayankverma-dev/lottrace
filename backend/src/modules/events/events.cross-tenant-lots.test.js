/**
 * P0-03 regression tests — event creation rejects foreign and unknown lots.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`.
 * The suite drops and recreates the public schema in that database.
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
jest.mock('../../jobs/queues', () => ({ connection: {} }));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P0-03 tenant-safe event lot links', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();
    const lotId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-03 ${label}`,
      slug: `p0-03-${label}-${orgId.slice(0, 8)}`,
    });
    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P0',
      last_name: 'Tester',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });
    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P0-03 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });
    await db('lots').insert({
      id: lotId,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-03-${label}`,
      quantity: 10,
      uom: 'kg',
      created_by: userId,
    });

    return { orgId, userId, lotId };
  };

  const eventFor = (lotIds) => ({
    eventType: 'creation',
    eventDatetime: '2026-01-01T10:00:00Z',
    source: 'manual',
    kdePayload: {},
    outputs: lotIds.map(lotId => ({ lotId, quantity: 1, uom: 'kg' })),
  });

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

  it('rejects a foreign lot with 404 and inserts no event or link', async () => {
    const orgA = await seedOrganization('a');
    const orgB = await seedOrganization('b');

    await expect(
      eventsService.createEvent(eventFor([orgB.lotId]), orgA.orgId, orgA.userId),
    ).rejects.toMatchObject({ message: 'Lot not found', code: 'NOT_FOUND', statusCode: 404 });

    expect(await db('events').where({ organization_id: orgA.orgId })).toHaveLength(0);
    expect(await db('event_lot_links').where({ organization_id: orgA.orgId })).toHaveLength(0);
  });

  it('rejects a mixed valid/foreign request atomically', async () => {
    const orgA = await seedOrganization('mixed-a');
    const orgB = await seedOrganization('mixed-b');

    await expect(
      eventsService.createEvent(
        eventFor([orgA.lotId, orgB.lotId]),
        orgA.orgId,
        orgA.userId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    expect(await db('events').where({ organization_id: orgA.orgId })).toHaveLength(0);
    expect(await db('event_lot_links').where({ organization_id: orgA.orgId })).toHaveLength(0);
  });

  it('rejects an unknown lot with the same 404 response', async () => {
    const org = await seedOrganization('unknown');

    await expect(
      eventsService.createEvent(eventFor([uuidv4()]), org.orgId, org.userId),
    ).rejects.toMatchObject({ message: 'Lot not found', code: 'NOT_FOUND', statusCode: 404 });

    expect(await db('events').where({ organization_id: org.orgId })).toHaveLength(0);
  });
});
