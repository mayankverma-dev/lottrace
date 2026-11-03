/**
 * P0-01 regression tests — canonical event hashing.
 *
 * Requires a disposable local PostgreSQL database:
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgres://lottrace:lottrace@localhost:55432/lottrace_p01_test \
 *   pnpm exec jest --runInBand src/jobs/hash-chain-verifier.test.js
 *
 * The suite refuses to run against any non-local host or a database whose name does
 * not end in `_test`, so the Neon URL in backend/.env can never be touched.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

const assertLocalDatabase = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set when RUN_DB_TESTS=1');
  }

  const { hostname, pathname } = new URL(databaseUrl);

  if (hostname === 'neon.tech' || hostname.endsWith('.neon.tech')) {
    throw new Error(`Refusing to run database tests against Neon host "${hostname}"`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(`Refusing to run database tests against non-local host "${hostname}"`);
  }
  if (!/_test$/.test(pathname)) {
    throw new Error(
      `Refusing to run database tests against database "${pathname}" (name must end with _test)`,
    );
  }

  return { hostname, pathname };
};

if (RUN_DB_TESTS) {
  const target = assertLocalDatabase();
  console.log(`[db-tests] target ${target.hostname}${target.pathname}`);
}

jest.mock('../modules/trace/trace.service', () => ({
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));

const { v4: uuidv4 } = require('uuid');
const {
  CURRENT_HASH_VERSION,
  computeEventHash,
} = require('../utils/hashChain');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('P0-01 canonical event hashing', () => {
  jest.setTimeout(30000);

  let db;
  let eventsService;
  let verifyHashChain;

  const orgId = uuidv4();
  const userId = uuidv4();
  const locationId = uuidv4();
  const productId = uuidv4();
  const lotA = uuidv4();
  const lotB = uuidv4();
  const lotC = uuidv4();
  const lotD = uuidv4();
  const createdEventIds = [];

  beforeAll(async () => {
    db = require('../db/knex');
    eventsService = require('../modules/events/events.service');
    ({ verifyHashChain } = require('./hash-chain-verifier'));

    await db('organizations').insert({
      id: orgId,
      name: 'P0-01 Test Organization',
      slug: `p0-01-${orgId.slice(0, 8)}`,
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

    await db('locations').insert({
      id: locationId,
      organization_id: orgId,
      name: 'P0-01 Plant',
      type: 'plant',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: 'P0-01 Product',
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    const lots = [lotA, lotB, lotC, lotD].map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-01-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    }));
    await db('lots').insert(lots);
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('verifies an event with two inputs and two outputs and a datetime without milliseconds', async () => {
    const event = await eventsService.createEvent(
      {
        eventType: 'transformation',
        locationId,
        eventDatetime: '2026-01-01T10:00:00Z',
        source: 'manual',
        kdePayload: {},
        counterpartyInfo: undefined,
        inputs: [
          { lotId: lotA, quantity: 1, uom: 'kg' },
          { lotId: lotB, quantity: 12.5, uom: 'kg' },
        ],
        outputs: [
          { lotId: lotC, quantity: 0.0001, uom: 'kg' },
          { lotId: lotD, quantity: 2.00005, uom: 'kg' },
        ],
      },
      orgId,
      userId,
    );
    createdEventIds.push(event.id);

    expect(event.hash_version).toBe(CURRENT_HASH_VERSION);

    const links = await db('event_lot_links').where({ event_id: event.id });
    const quantityByLot = Object.fromEntries(links.map((link) => [link.lot_id, link.quantity]));

    // The hashed value must be exactly what PostgreSQL stored, including its rounding.
    expect(quantityByLot[lotA]).toBe('1.0000');
    expect(quantityByLot[lotB]).toBe('12.5000');
    expect(quantityByLot[lotC]).toBe('0.0001');
    expect(quantityByLot[lotD]).toBe('2.0001'); // JS toFixed(4) would produce "2.0000"

    const result = await verifyHashChain({ organizationId: orgId });
    expect(result.organizationsChecked).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.legacySkipped).toBe(0);
    expect(result.canonicalVerified).toBe(1);
  });

  it('verifies an event whose links arrive in the reverse order', async () => {
    const event = await eventsService.createEvent(
      {
        eventType: 'transformation',
        locationId,
        eventDatetime: '2026-01-01T10:00:00.000Z',
        source: 'manual',
        kdePayload: {},
        counterpartyInfo: null,
        inputs: [
          { lotId: lotB, quantity: 12.5, uom: 'kg' },
          { lotId: lotA, quantity: 1, uom: 'kg' },
        ],
        outputs: [
          { lotId: lotD, quantity: 2.00005, uom: 'kg' },
          { lotId: lotC, quantity: 0.0001, uom: 'kg' },
        ],
      },
      orgId,
      userId,
    );
    createdEventIds.push(event.id);

    const result = await verifyHashChain({ organizationId: orgId });
    expect(result.failures).toEqual([]);
    expect(result.canonicalVerified).toBe(2);
  });

  it('verifies a chain of ten sequential events', async () => {
    for (let index = 0; index < 10; index += 1) {
      const event = await eventsService.createEvent(
        {
          eventType: index % 2 === 0 ? 'creation' : 'receiving',
          locationId,
          eventDatetime: `2026-01-0${(index % 9) + 1}T0${index}:15:00Z`,
          source: 'manual',
          kdePayload: { sequence: index },
          counterpartyInfo: null,
          inputs: index % 2 === 0 ? [] : [{ lotId: lotA, quantity: 1 + index, uom: 'kg' }],
          outputs: index % 2 === 0 ? [{ lotId: lotC, quantity: 10 + index, uom: 'kg' }] : [],
        },
        orgId,
        userId,
      );
      createdEventIds.push(event.id);
    }

    const result = await verifyHashChain({ organizationId: orgId });
    expect(result.failures).toEqual([]);
    expect(result.canonicalVerified).toBe(12);
  });

  it('detects tampering with a hashed field and records an audit entry', async () => {
    const targetId = createdEventIds[createdEventIds.length - 1];
    const original = await db('events').where({ id: targetId }).first();

    await db('events')
      .where({ id: targetId })
      .update({ event_datetime: new Date('2026-06-06T06:06:06.000Z') });

    const tampered = await verifyHashChain({ organizationId: orgId });
    expect(tampered.failures).toHaveLength(1);
    expect(tampered.failures[0].eventId).toBe(targetId);
    expect(tampered.failures[0].reason).toBe('hash_mismatch');

    const audit = await db('audit_log')
      .where({ action: 'hash.verify_failed', entity_id: targetId })
      .first();
    expect(audit).toBeTruthy();
    expect(audit.metadata.reason).toBe('hash_mismatch');

    await db('events').where({ id: targetId }).update({ event_datetime: original.event_datetime });

    const restored = await verifyHashChain({ organizationId: orgId });
    expect(restored.failures).toEqual([]);
  });

  it('chain-checks legacy rows without false tamper alerts and fails closed when relabelled', async () => {
    const tip = await db('events')
      .where({ organization_id: orgId })
      .orderBy('created_at', 'desc')
      .first();

    const legacyId = uuidv4();
    const legacyDatetime = '2026-03-01T00:00:00.000Z';
    const legacyPayload = {
      eventType: 'receiving',
      locationId: null,
      eventDatetime: legacyDatetime,
      source: 'manual',
      kdePayload: {},
      counterpartyInfo: null,
      inputs: [],
      outputs: [],
    };
    const legacyHash = computeEventHash(legacyPayload, tip.record_hash);

    await db('events').insert({
      id: legacyId,
      organization_id: orgId,
      event_type: 'receiving',
      location_id: null,
      counterparty_info: null,
      event_datetime: legacyDatetime,
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({}),
      record_hash: legacyHash,
      prev_hash: tip.record_hash,
      hash_version: 1,
      status: 'active',
    });

    let result = await verifyHashChain({ organizationId: orgId });
    expect(result.failures).toEqual([]);
    expect(result.legacySkipped).toBe(1);

    const skipAudit = await db('audit_log')
      .where({ action: 'hash.verify_legacy_skipped', organization_id: orgId })
      .first();
    expect(skipAudit).toBeTruthy();

    // Legacy payloads are deliberately not payload-verified (they cannot be reconstructed).
    await db('events')
      .where({ id: legacyId })
      .update({ kde_payload: JSON.stringify({ tampered: true }) });
    result = await verifyHashChain({ organizationId: orgId });
    expect(result.failures).toEqual([]);

    // The same row relabelled as canonical must be detected as a mismatch.
    await db('events').where({ id: legacyId }).update({ hash_version: 2 });
    result = await verifyHashChain({ organizationId: orgId });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].eventId).toBe(legacyId);
    expect(result.failures[0].reason).toBe('hash_mismatch');
  });
});
