/**
 * P1-22 regression tests — lot create/update/void must write audit_log rows.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p122_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p122_test \
 *   npx jest --runInBand src/modules/lots/lots.audit.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
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

describeDb('P1-22 lot audit trail', () => {
  jest.setTimeout(120000);

  let db;
  let lotsService;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-22 ${label}`,
      slug: `p1-22-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Audit',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P1-22 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    return { orgId, userId, productId };
  };

  const createLot = (org, overrides = {}) => lotsService.createLot({
    productId: org.productId,
    traceabilityLotCode: `P1-22-${org.orgId.slice(0, 8)}`,
    quantity: 10,
    uom: 'kg',
    notes: 'initial',
    ...overrides,
  }, org.orgId, org.userId, { ipAddress: '127.0.0.1' });

  const auditRows = (orgId, action) => db('audit_log')
    .where({ organization_id: orgId, action })
    .orderBy('created_at', 'asc');

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

  it('writes lot.create with actor, IP, and after state', async () => {
    const org = await seedOrganization('create');
    const lot = await createLot(org);

    const rows = await auditRows(org.orgId, 'lot.create');
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row).toMatchObject({
      organization_id: org.orgId,
      actor_id: org.userId,
      actor_type: 'user',
      entity_type: 'lot',
      entity_id: lot.id,
      ip_address: '127.0.0.1',
      before_state: null,
    });
    expect(row.after_state).toMatchObject({
      id: lot.id,
      organizationId: org.orgId,
      traceabilityLotCode: lot.traceabilityLotCode,
      quantity: '10.0000',
      uom: 'kg',
      notes: 'initial',
      status: 'active',
      version: 1,
    });
  });

  it('writes lot.update with before and after state', async () => {
    const org = await seedOrganization('update');
    const lot = await createLot(org);

    const updated = await lotsService.updateLot(
      lot.id,
      { quantity: 12.5, notes: 'updated' },
      org.orgId,
      org.userId,
      { ipAddress: '127.0.0.2' },
    );

    expect(updated.quantity).toBe('12.5000');

    const rows = await auditRows(org.orgId, 'lot.update');
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row).toMatchObject({
      actor_id: org.userId,
      entity_type: 'lot',
      entity_id: lot.id,
      ip_address: '127.0.0.2',
    });
    expect(row.before_state).toMatchObject({
      quantity: '10.0000',
      notes: 'initial',
      status: 'active',
      version: 1,
    });
    expect(row.after_state).toMatchObject({
      quantity: '12.5000',
      notes: 'updated',
      status: 'active',
      version: 2,
    });
  });

  it('writes lot.void with actor, IP, reason, and before/after status', async () => {
    const org = await seedOrganization('void');
    const lot = await createLot(org);

    await lotsService.updateLot(
      lot.id,
      { quantity: 12.5, notes: 'updated' },
      org.orgId,
      org.userId,
      { ipAddress: '127.0.0.2' },
    );

    const voided = await lotsService.voidLot(
      lot.id,
      'damaged in transit',
      org.orgId,
      org.userId,
      { ipAddress: '10.1.2.3' },
    );

    expect(voided.status).toBe('void');
    expect(voided.voidReason).toBe('damaged in transit');

    const rows = await auditRows(org.orgId, 'lot.void');
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row).toMatchObject({
      organization_id: org.orgId,
      actor_id: org.userId,
      actor_type: 'user',
      entity_type: 'lot',
      entity_id: lot.id,
      ip_address: '10.1.2.3',
    });
    expect(row.before_state).toMatchObject({
      status: 'active',
      version: 2,
    });
    expect(row.after_state).toMatchObject({
      status: 'void',
      voidReason: 'damaged in transit',
      version: 3,
    });
    expect(row.metadata).toEqual({ reason: 'damaged in transit' });
  });

  it('does not write lot.update when the mutation is rejected', async () => {
    const org = await seedOrganization('rejected');
    const lot = await createLot(org);

    await lotsService.voidLot(
      lot.id,
      'voided before update',
      org.orgId,
      org.userId,
      { ipAddress: '127.0.0.1' },
    );

    await expect(
      lotsService.updateLot(
        lot.id,
        { quantity: 5 },
        org.orgId,
        org.userId,
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({ code: 'LOT_VOIDED', statusCode: 400 });

    expect(await auditRows(org.orgId, 'lot.update')).toHaveLength(0);
  });
});
