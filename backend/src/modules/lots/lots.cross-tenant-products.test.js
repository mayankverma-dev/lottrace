/**
 * P0-14 regression tests — lot creation rejects foreign and unknown products.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`.
 * The suite drops and recreates the public schema in that database.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P0-14 tenant-safe lot products', () => {
  jest.setTimeout(120000);

  let db;
  let lotsService;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-14 ${label}`,
      slug: `p0-14-${label}-${orgId.slice(0, 8)}`,
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
      name: `P0-14 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    return { orgId, userId, productId };
  };

  const lotFor = (productId) => ({
    productId,
    traceabilityLotCode: `P0-14-${uuidv4().slice(0, 8)}`,
    quantity: 10,
    uom: 'kg',
  });

  beforeAll(async () => {
    db = require('../../db/knex');
    lotsService = require('./lots.service');
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('rejects a foreign product with 404 and inserts no lot or audit row', async () => {
    const orgA = await seedOrganization('a');
    const orgB = await seedOrganization('b');

    await expect(
      lotsService.createLot(lotFor(orgB.productId), orgA.orgId, orgA.userId),
    ).rejects.toMatchObject({
      message: 'Product not found',
      code: 'NOT_FOUND',
      statusCode: 404,
    });

    expect(await db('lots').where({ organization_id: orgA.orgId })).toHaveLength(0);
    expect(await db('audit_log').where({ organization_id: orgA.orgId })).toHaveLength(0);
  });

  it('rejects an unknown product with the same 404 response', async () => {
    const org = await seedOrganization('unknown');

    await expect(
      lotsService.createLot(lotFor(uuidv4()), org.orgId, org.userId),
    ).rejects.toMatchObject({
      message: 'Product not found',
      code: 'NOT_FOUND',
      statusCode: 404,
    });

    expect(await db('lots').where({ organization_id: org.orgId })).toHaveLength(0);
    expect(await db('audit_log').where({ organization_id: org.orgId })).toHaveLength(0);
  });

  it('creates a lot with an organization-owned product and audits it', async () => {
    const org = await seedOrganization('valid');
    const lot = await lotsService.createLot(lotFor(org.productId), org.orgId, org.userId);

    expect(lot.organizationId).toBe(org.orgId);
    expect(lot.productId).toBe(org.productId);
    expect(await db('audit_log').where({
      organization_id: org.orgId,
      action: 'lot.create',
      entity_id: lot.id,
    })).toHaveLength(1);
  });
});
