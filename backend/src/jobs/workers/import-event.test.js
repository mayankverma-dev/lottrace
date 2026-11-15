/**
 * P0-10 regression tests — an imported shipping row consumes the lot.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p010_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p010_test \
 *   HASH_CHAIN_KEY_ID=p010-test-k1 \
 *   HASH_CHAIN_SECRET=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
 *   npx jest --runInBand src/jobs/workers/import-event.test.js
 *
 * Redis is replaced with an in-memory map. The suite drops and recreates the
 * public schema in the disposable database. dbGuard refuses Neon, non-local
 * hosts, and names without the `_test` suffix.
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
    incr: jest.fn(async (key) => {
      const next = Number.parseInt(store.get(key) || '0', 10) + 1;
      store.set(key, String(next));
      return next;
    }),
    __store: store,
  };
});

const path = require('path');
const crc32 = require('crc-32');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P0-10 import shipping consumes the lot', () => {
  jest.setTimeout(120000);

  let db;
  let redis;
  let hashChain;
  let traceService;
  let eventsService;
  let processEventGroup;
  let bumpTraceCacheVersion;

  const seedOrganization = async (label, customKdeSchema = []) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();
    const locationId = uuidv4();
    const productName = `P0-10 Product ${label}`;
    const locationName = `P0-10 Location ${label}`;

    await db('organizations').insert({
      id: orgId,
      name: `P0-10 ${label}`,
      slug: `p0-10-${label}-${orgId.slice(0, 8)}`,
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
      name: productName,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify(customKdeSchema),
    });

    await db('locations').insert({
      id: locationId,
      organization_id: orgId,
      name: locationName,
      type: 'warehouse',
    });

    const product = await db('products').where({ id: productId }).first();
    const location = await db('locations').where({ id: locationId }).first();

    return {
      orgId,
      userId,
      productId,
      productMap: new Map([[product.name.toLowerCase().trim(), product]]),
      locationMap: new Map([[location.name.toLowerCase().trim(), location]]),
      productName,
      locationName,
    };
  };

  const insertLot = async (org, traceabilityLotCode, quantity = 100) => {
    const [lot] = await db('lots').insert({
      id: uuidv4(),
      organization_id: org.orgId,
      product_id: org.productId,
      traceability_lot_code: traceabilityLotCode,
      quantity,
      uom: 'kg',
      created_by: org.userId,
    }).returning('*');
    return lot;
  };

  const csvRow = (org, overrides = {}) => ({
    transaction_id: `TRX-${uuidv4()}`,
    event_datetime: '2026-11-15T10:00:00.000Z',
    location_name: org.locationName,
    notes: '',
    traceability_lot_code: '',
    product_name: org.productName,
    quantity: '10',
    uom: 'kg',
    ...overrides,
  });

  const importGroup = async (org, cteType, transactionId, rows) => {
    const group = rows.map((csvRowValue, index) => ({
      row: csvRowValue,
      rowNum: index + 2,
    }));

    await db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [Math.abs(crc32.str(org.orgId))]);
      const tip = await hashChain.getChainTip(trx, org.orgId);
      await processEventGroup(
        trx,
        group,
        transactionId,
        cteType,
        org.orgId,
        org.userId,
        org.productMap,
        org.locationMap,
        tip ? tip.record_hash : hashChain.GENESIS_HASH,
        hashChain.nextChainSeq(tip),
      );
    });
    await bumpTraceCacheVersion(org.orgId);
  };

  const importedEvent = (org, transactionId) => db('events')
    .where({
      organization_id: org.orgId,
      idempotency_key: `import_${org.orgId}_${transactionId}`,
    })
    .first();

  const linksFor = (eventId) => db('event_lot_links')
    .where({ event_id: eventId })
    .orderBy('direction')
    .orderBy('lot_id');

  const directionsFor = (eventId) => linksFor(eventId).then((links) => links.map((link) => link.direction));

  beforeAll(async () => {
    db = require('../../db/knex');
    redis = require('../../config/redis');
    hashChain = require('../../utils/hashChain');
    traceService = require('../../modules/trace/trace.service');
    eventsService = require('../../modules/events/events.service');
    ({ processEventGroup } = require('./import-event'));
    ({ bumpTraceCacheVersion } = traceService);

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(() => {
    redis.__store.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('stores a shipping row as an input link with no output link', async () => {
    const org = await seedOrganization('shipping-only');
    const lot = await insertLot(org, 'P0-10-SHIP-ONLY', 25);
    const transactionId = 'TRX-P0-10-SHIP-ONLY';

    await importGroup(org, 'shipping', transactionId, [
      csvRow(org, {
        transaction_id: transactionId,
        traceability_lot_code: lot.traceability_lot_code,
        quantity: '25',
      }),
    ]);

    const event = await importedEvent(org, transactionId);
    expect(event.event_type).toBe('shipping');
    expect(event.source).toBe('import');
    expect(event.compliance_gaps).toBeNull();
    expect(event.has_compliance_gaps).toBe(false);
    expect(event.record_hash).toMatch(/^[a-f0-9]{64}$/);

    const links = await linksFor(event.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      lot_id: lot.id,
      direction: 'input',
    });

    const detail = await eventsService.getEventById(event.id, org.orgId);
    expect(detail.inputs.map((link) => link.lot_id)).toEqual([lot.id]);
    expect(detail.outputs).toEqual([]);

    const payload = await hashChain.loadEventHashPayload(db, event.id);
    expect(payload.inputs).toHaveLength(1);
    expect(payload.outputs).toHaveLength(0);

    const forward = await traceService.forwardTrace(lot.id, org.orgId);
    expect(forward.nodes.map((node) => node.id)).toEqual([lot.id]);
    expect(forward.edges).toEqual([]);
  });

  it('invalidates an upstream trace after an import transaction commits', async () => {
    const org = await seedOrganization('post-commit-cache');
    const raw = await insertLot(org, 'P0-10-RAW-CACHE', 100);

    const warm = await traceService.forwardTrace(raw.id, org.orgId);
    expect(warm.nodes.map((node) => node.id)).toEqual([raw.id]);
    expect(redis.__store.has(`trace:v3:${org.orgId}:v0:${raw.id}:forward`)).toBe(true);

    const transactionId = 'TRX-P0-10-POST-COMMIT-CACHE';
    await importGroup(org, 'transformation', transactionId, [
      csvRow(org, {
        transaction_id: transactionId,
        direction: 'input',
        traceability_lot_code: raw.traceability_lot_code,
        quantity: '90',
      }),
      csvRow(org, {
        transaction_id: transactionId,
        direction: 'output',
        traceability_lot_code: 'P0-10-FINAL-CACHE',
        quantity: '80',
      }),
    ]);

    const after = await traceService.forwardTrace(raw.id, org.orgId);
    expect(after.cached).toBeUndefined();
    expect(after.nodes.map((node) => node.traceabilityLotCode).sort()).toEqual([
      'P0-10-FINAL-CACHE',
      'P0-10-RAW-CACHE',
    ]);
  });

  it('maps creation, receiving, transformation, and shipping consistently', async () => {
    const org = await seedOrganization('all-ctes');

    await importGroup(org, 'creation', 'TRX-P0-10-CREATE', [
      csvRow(org, {
        transaction_id: 'TRX-P0-10-CREATE',
        traceability_lot_code: 'P0-10-RAW',
        quantity: '100',
      }),
    ]);

    await importGroup(org, 'receiving', 'TRX-P0-10-RECEIVE', [
      csvRow(org, {
        transaction_id: 'TRX-P0-10-RECEIVE',
        traceability_lot_code: 'P0-10-RAW',
        quantity: '100',
      }),
    ]);

    await importGroup(org, 'transformation', 'TRX-P0-10-TRANSFORM', [
      csvRow(org, {
        transaction_id: 'TRX-P0-10-TRANSFORM',
        direction: 'input',
        traceability_lot_code: 'P0-10-RAW',
        quantity: '90',
      }),
      csvRow(org, {
        transaction_id: 'TRX-P0-10-TRANSFORM',
        direction: 'output',
        traceability_lot_code: 'P0-10-FINAL',
        quantity: '80',
      }),
    ]);

    await importGroup(org, 'shipping', 'TRX-P0-10-SHIP', [
      csvRow(org, {
        transaction_id: 'TRX-P0-10-SHIP',
        traceability_lot_code: 'P0-10-FINAL',
        quantity: '70',
      }),
    ]);

    const creation = await importedEvent(org, 'TRX-P0-10-CREATE');
    const receiving = await importedEvent(org, 'TRX-P0-10-RECEIVE');
    const transformation = await importedEvent(org, 'TRX-P0-10-TRANSFORM');
    const shipping = await importedEvent(org, 'TRX-P0-10-SHIP');

    expect(await directionsFor(creation.id)).toEqual(['output']);
    expect(await directionsFor(receiving.id)).toEqual(['input']);
    expect(await directionsFor(transformation.id)).toEqual(['input', 'output']);
    expect(await directionsFor(shipping.id)).toEqual(['input']);

    const raw = await db('lots').where({
      organization_id: org.orgId,
      traceability_lot_code: 'P0-10-RAW',
    }).first();
    const final = await db('lots').where({
      organization_id: org.orgId,
      traceability_lot_code: 'P0-10-FINAL',
    }).first();
    const importedLotCount = await db('lots')
      .where({ organization_id: org.orgId })
      .whereIn('traceability_lot_code', ['P0-10-RAW', 'P0-10-FINAL'])
      .count('id as count')
      .first();
    expect(Number(importedLotCount.count)).toBe(2);

    const forwardRaw = await traceService.forwardTrace(raw.id, org.orgId);
    expect(forwardRaw.nodes.map((node) => node.id).sort()).toEqual([raw.id, final.id].sort());
    expect(forwardRaw.edges).toEqual([
      expect.objectContaining({
        from: raw.id,
        to: final.id,
        eventId: transformation.id,
      }),
    ]);

    const forwardFinal = await traceService.forwardTrace(final.id, org.orgId);
    expect(forwardFinal.nodes.map((node) => node.id)).toEqual([final.id]);
    expect(forwardFinal.edges).toEqual([]);

    const backwardFinal = await traceService.backwardTrace(final.id, org.orgId);
    expect(backwardFinal.nodes.map((node) => node.id).sort()).toEqual([raw.id, final.id].sort());
    expect(backwardFinal.edges).toEqual([
      expect.objectContaining({
        from: raw.id,
        to: final.id,
        eventId: transformation.id,
      }),
    ]);

    const fullRaw = await traceService.fullTrace(raw.id, org.orgId);
    expect(fullRaw.nodes.map((node) => node.id).sort()).toEqual([raw.id, final.id].sort());
    expect(fullRaw.edges).toEqual([
      expect.objectContaining({
        from: raw.id,
        to: final.id,
        eventId: transformation.id,
      }),
    ]);
    expect(fullRaw.edges.some((edge) => edge.eventId === shipping.id)).toBe(false);
  });

  it('builds the same shipping graph as the manual event path', async () => {
    const org = await seedOrganization('manual-equivalence');
    const manualLot = await insertLot(org, 'P0-10-MANUAL-SHIP', 5);
    const importedLot = await insertLot(org, 'P0-10-IMPORTED-SHIP', 5);

    const manual = await eventsService.createEvent({
      eventType: 'shipping',
      eventDatetime: '2026-11-15T12:00:00.000Z',
      source: 'manual',
      kdePayload: {},
      inputs: [{ lotId: manualLot.id, quantity: 5, uom: 'kg' }],
      outputs: [],
    }, org.orgId, org.userId);

    const transactionId = 'TRX-P0-10-MANUAL-EQUIVALENCE';
    await importGroup(org, 'shipping', transactionId, [
      csvRow(org, {
        transaction_id: transactionId,
        traceability_lot_code: importedLot.traceability_lot_code,
        quantity: '5',
      }),
    ]);
    const imported = await importedEvent(org, transactionId);

    const manualLinks = await linksFor(manual.id);
    const importedLinks = await linksFor(imported.id);

    expect(manualLinks).toHaveLength(1);
    expect(importedLinks).toHaveLength(1);
    expect(manualLinks[0]).toMatchObject({
      lot_id: manualLot.id,
      direction: 'input',
      quantity: '5.0000',
    });
    expect(importedLinks[0]).toMatchObject({
      lot_id: importedLot.id,
      direction: 'input',
      quantity: '5.0000',
    });

    for (const lot of [manualLot, importedLot]) {
      // eslint-disable-next-line no-await-in-loop
      const forward = await traceService.forwardTrace(lot.id, org.orgId);
      expect(forward.nodes.map((node) => node.id)).toEqual([lot.id]);
      expect(forward.edges).toEqual([]);
    }

    const manualPayload = await hashChain.loadEventHashPayload(db, manual.id);
    const importedPayload = await hashChain.loadEventHashPayload(db, imported.id);
    expect(manualPayload.inputs).toHaveLength(1);
    expect(manualPayload.outputs).toHaveLength(0);
    expect(importedPayload.inputs).toHaveLength(1);
    expect(importedPayload.outputs).toHaveLength(0);
  });

  it('stores compliance gaps for an imported product with missing required KDEs', async () => {
    const org = await seedOrganization('compliance-gap', [
      { name: 'harvestDate', required: true, label: 'Harvest Date' },
    ]);
    const lot = await insertLot(org, 'P1-01-GAP');
    const transactionId = 'TRX-P1-01-GAP';

    await importGroup(org, 'creation', transactionId, [
      csvRow(org, {
        transaction_id: transactionId,
        traceability_lot_code: lot.traceability_lot_code,
      }),
    ]);

    const event = await importedEvent(org, transactionId);
    expect(event.compliance_gaps).toEqual([
      { field: 'harvestDate', message: 'Harvest Date is required' },
    ]);
    expect(event.has_compliance_gaps).toBe(true);
  });

  it('deduplicates the same required KDE across multiple imported lots', async () => {
    const org = await seedOrganization('compliance-dedupe', [
      { name: 'harvestDate', required: true, label: 'Harvest Date' },
    ]);
    const firstLot = await insertLot(org, 'P1-01-DEDUPE-1');
    const secondLot = await insertLot(org, 'P1-01-DEDUPE-2');
    const transactionId = 'TRX-P1-01-DEDUPE';

    await importGroup(org, 'transformation', transactionId, [
      csvRow(org, {
        transaction_id: transactionId,
        direction: 'input',
        traceability_lot_code: firstLot.traceability_lot_code,
      }),
      csvRow(org, {
        transaction_id: transactionId,
        direction: 'output',
        traceability_lot_code: secondLot.traceability_lot_code,
      }),
    ]);

    const event = await importedEvent(org, transactionId);
    expect(event.compliance_gaps).toEqual([
      { field: 'harvestDate', message: 'Harvest Date is required' },
    ]);
  });

  it('stores all missing required KDEs across multiple imported products', async () => {
    const org = await seedOrganization('compliance-products', [
      { name: 'harvestDate', required: true, label: 'Harvest Date' },
    ]);
    const secondProductId = uuidv4();
    await db('products').insert({
      id: secondProductId,
      organization_id: org.orgId,
      name: `${org.productName} second`,
      is_ftl: true,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([
        { name: 'supplierLot', required: true, label: 'Supplier Lot' },
      ]),
    });
    const secondProduct = await db('products').where({ id: secondProductId }).first();
    org.productMap.set(secondProduct.name.toLowerCase().trim(), secondProduct);
    const firstLot = await insertLot(org, 'P1-01-PRODUCT-1');
    const [secondLot] = await db('lots').insert({
      id: uuidv4(),
      organization_id: org.orgId,
      product_id: secondProductId,
      traceability_lot_code: 'P1-01-PRODUCT-2',
      quantity: 100,
      uom: 'kg',
      created_by: org.userId,
    }).returning('*');
    const transactionId = 'TRX-P1-01-PRODUCTS';

    await importGroup(org, 'transformation', transactionId, [
      csvRow(org, {
        transaction_id: transactionId,
        direction: 'input',
        traceability_lot_code: firstLot.traceability_lot_code,
      }),
      csvRow(org, {
        transaction_id: transactionId,
        product_name: secondProduct.name,
        direction: 'output',
        traceability_lot_code: secondLot.traceability_lot_code,
      }),
    ]);

    const event = await importedEvent(org, transactionId);
    expect(event.compliance_gaps).toEqual([
      { field: 'harvestDate', message: 'Harvest Date is required' },
      { field: 'supplierLot', message: 'Supplier Lot is required' },
    ]);
  });
});
