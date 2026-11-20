/**
 * P1-06 regression tests — recall simulation pagination stays tenant-scoped.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:REPLACE_WITH_LOCAL_PASSWORD@127.0.0.1:5432/lottrace_p105_p106_test \
 *   npx jest --runInBand src/modules/recall/recall.pagination.test.js
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../trace/trace.service', () => ({
  fullTrace: jest.fn(),
}));

const path = require('path');
const { v4: uuid } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-06 recall simulation pagination', () => {
  jest.setTimeout(120000);

  let db;
  let recallService;
  let organizationId;
  let otherOrganizationId;
  let userId;
  let lotId;

  beforeAll(async () => {
    db = require('../../db/knex');
    recallService = require('./service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(async () => {
    organizationId = uuid();
    otherOrganizationId = uuid();
    userId = uuid();
    lotId = uuid();

    await db('organizations').insert([
      { id: organizationId, name: 'P1-06 A', slug: `p1-06-a-${organizationId.slice(0, 8)}` },
      { id: otherOrganizationId, name: 'P1-06 B', slug: `p1-06-b-${otherOrganizationId.slice(0, 8)}` },
    ]);
    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'P1',
      last_name: 'Tester',
      email: `${userId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });
    const productId = uuid();
    await db('products').insert({
      id: productId,
      organization_id: organizationId,
      name: 'P1-06 Product',
      created_by: userId,
    });
    await db('lots').insert({
      id: lotId,
      organization_id: organizationId,
      product_id: productId,
      traceability_lot_code: `P1-06-${lotId.slice(0, 8)}`,
      quantity: 1,
      uom: 'kg',
      created_by: userId,
    });

    await db('recall_simulations').insert([
      { organization_id: organizationId, name: 'A-1', triggering_lot_id: lotId, run_by: userId, run_at: '2026-01-03T00:00:00Z' },
      { organization_id: organizationId, name: 'A-2', triggering_lot_id: lotId, run_by: userId, run_at: '2026-01-02T00:00:00Z' },
      { organization_id: organizationId, name: 'A-3', triggering_lot_id: lotId, run_by: userId, run_at: '2026-01-01T00:00:00Z' },
      { organization_id: otherOrganizationId, name: 'B-1', triggering_lot_id: lotId, run_by: userId, run_at: '2026-01-04T00:00:00Z' },
    ]);
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('returns second page with complete pagination metadata', async () => {
    const result = await recallService.listSimulations(organizationId, { page: 2, limit: 2 });

    expect(result.data.map((simulation) => simulation.name)).toEqual(['A-3']);
    expect(result.pagination).toEqual({
      total: 3,
      page: 2,
      limit: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
  });

  it('returns first page and indicates more rows exist', async () => {
    const result = await recallService.listSimulations(organizationId, { page: 1, limit: 2 });

    expect(result.data.map((simulation) => simulation.name)).toEqual(['A-1', 'A-2']);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPrevPage).toBe(false);
  });

  it('returns an empty page beyond the last page', async () => {
    const result = await recallService.listSimulations(organizationId, { page: 4, limit: 2 });

    expect(result.data).toEqual([]);
    expect(result.pagination.page).toBe(4);
  });

  it('excludes simulations from another organization', async () => {
    const result = await recallService.listSimulations(organizationId, { page: 1, limit: 100 });

    expect(result.data).toHaveLength(3);
    expect(result.data.every((simulation) => simulation.organization_id === organizationId)).toBe(true);
  });
});
