/**
 * P0-01 regression tests — hash verification of events with lot links.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p001_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p001_test \
 *   npx jest --runInBand src/modules/events/events.hash-canonical.test.js
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
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P0-01 canonical event hash verification', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let verifyHashChain;
  let hashChain;

  const seedOrganization = async (label, lotCount = 4) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-01 ${label}`,
      slug: `p0-01-${label}-${orgId.slice(0, 8)}`,
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
      name: `P0-01 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    const lotIds = Array.from({ length: lotCount }, () => uuidv4()).sort();
    await db('lots').insert(lotIds.map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-01-${label}-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    })));

    return { orgId, userId, productId, lotIds };
  };

  /**
   * Two inputs and two outputs in the requested order, a second-precision
   * datetime (no milliseconds), and no KDE payload — the combination the audit
   * called out as failing on every real event.
   */
  const buildLinkedEvent = (org, overrides = {}) => {
    const [lotA, lotB, lotC, lotD] = org.lotIds;
    return {
      eventType: 'transformation',
      eventDatetime: '2026-01-01T10:00:00Z',
      source: 'manual',
      kdePayload: {},
      counterpartyInfo: null,
      inputs: [
        { lotId: lotB, quantity: 1, uom: 'kg' },
        { lotId: lotA, quantity: 12.5, uom: 'kg' },
      ],
      outputs: [
        { lotId: lotD, quantity: 2, uom: 'kg' },
        { lotId: lotC, quantity: 0.5, uom: 'kg' },
      ],
      ...overrides,
    };
  };

  const failedAudits = (orgId) => db('audit_log')
    .where({ organization_id: orgId, action: 'hash.verify_failed' });

  const readChain = (orgId) => db('events')
    .where({ organization_id: orgId })
    .orderBy('chain_seq', 'asc');

  const quantityByLotId = async (eventId) => {
    const rows = await db('event_lot_links').where({ event_id: eventId });
    return new Map(rows.map((row) => [row.lot_id, row.quantity]));
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    ({ verifyHashChain } = require('../../jobs/workers/hash-verifier'));
    hashChain = require('../../utils/hashChain');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('verifies an event with two inputs, two outputs, and a second-precision datetime', async () => {
    const org = await seedOrganization('basic');

    const event = await eventsService.createEvent(buildLinkedEvent(org), org.orgId, org.userId);

    expect(event.hash_version).toBe(2);
    expect(event.record_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.prev_hash).toBe('GENESIS');

    await verifyHashChain({ organizationId: org.orgId });

    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('hashes links canonically regardless of request order', async () => {
    const org = await seedOrganization('link-order');
    const [lotA, lotB, lotC, lotD] = org.lotIds;

    const forward = await eventsService.createEvent(
      buildLinkedEvent(org),
      org.orgId,
      org.userId,
    );
    const reversed = await eventsService.createEvent(
      buildLinkedEvent(org, {
        eventDatetime: '2026-01-02T10:00:00Z',
        inputs: [
          { lotId: lotA, quantity: 12.5, uom: 'kg' },
          { lotId: lotB, quantity: 1, uom: 'kg' },
        ],
        outputs: [
          { lotId: lotC, quantity: 0.5, uom: 'kg' },
          { lotId: lotD, quantity: 2, uom: 'kg' },
        ],
      }),
      org.orgId,
      org.userId,
    );

    const forwardPayload = await hashChain.loadEventHashPayload(db, forward.id);
    const reversedPayload = await hashChain.loadEventHashPayload(db, reversed.id);

    expect(reversedPayload.inputs).toEqual(forwardPayload.inputs);
    expect(reversedPayload.outputs).toEqual(forwardPayload.outputs);

    await verifyHashChain({ organizationId: org.orgId });

    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('hashes quantities as persisted numeric(15,4) text', async () => {
    const org = await seedOrganization('quantity-text');
    const [lotA, lotB] = org.lotIds;

    const event = await eventsService.createEvent(
      buildLinkedEvent(org, {
        inputs: [
          { lotId: lotA, quantity: 1, uom: 'kg' },
          { lotId: lotB, quantity: 12.5, uom: 'kg' },
        ],
      }),
      org.orgId,
      org.userId,
    );

    const quantities = await quantityByLotId(event.id);
    expect(quantities.get(lotA)).toBe('1.0000');
    expect(quantities.get(lotB)).toBe('12.5000');

    const payload = await hashChain.loadEventHashPayload(db, event.id);
    const payloadQuantities = new Map(payload.inputs.map((link) => [link.lotId, link.quantity]));
    expect(payloadQuantities.get(lotA)).toBe('1.0000');
    expect(payloadQuantities.get(lotB)).toBe('12.5000');

    await verifyHashChain({ organizationId: org.orgId });

    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('verifies a ten-event chain built through the service', async () => {
    const org = await seedOrganization('chain');

    for (let index = 0; index < 10; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await eventsService.createEvent(
        buildLinkedEvent(org, {
          eventDatetime: new Date(Date.UTC(2026, 2, 1, 0, 0, index)).toISOString(),
          kdePayload: { sequence: index, nested: { beta: index, alpha: index * 2 } },
          inputs: [
            { lotId: org.lotIds[0], quantity: 1 + index, uom: 'kg' },
            { lotId: org.lotIds[1], quantity: 2.25, uom: 'kg' },
          ],
        }),
        org.orgId,
        org.userId,
      );
    }

    const chain = await readChain(org.orgId);
    expect(chain).toHaveLength(10);
    expect(chain.map((event) => event.hash_version)).toEqual(Array(10).fill(2));

    await verifyHashChain({ organizationId: org.orgId });

    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('verifies an import-style event sealed after insert', async () => {
    const org = await seedOrganization('import-style');
    const eventId = uuidv4();

    await db.transaction(async (trx) => {
      await trx('events').insert({
        id: eventId,
        organization_id: org.orgId,
        event_type: 'receiving',
        location_id: null,
        counterparty_info: JSON.stringify({ name: 'Supplier' }),
        event_datetime: new Date('2026-04-01T00:00:00.000Z'),
        recorded_by: org.userId,
        source: 'import',
        kde_payload: JSON.stringify({}),
        record_hash: hashChain.PENDING_RECORD_HASH,
        prev_hash: hashChain.GENESIS_HASH,
        chain_seq: 1,
        hash_version: hashChain.HASH_VERSION,
        status: 'active',
      });

      await trx('event_lot_links').insert({
        id: uuidv4(),
        event_id: eventId,
        lot_id: org.lotIds[2],
        direction: 'input',
        quantity: 3,
        uom: 'kg',
      });

      const sealed = await hashChain.sealEventHash(trx, eventId, hashChain.GENESIS_HASH);
      expect(sealed.record_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    await verifyHashChain({ organizationId: org.orgId });

    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('detects tampering with a link quantity', async () => {
    const org = await seedOrganization('tamper-quantity');
    const event = await eventsService.createEvent(buildLinkedEvent(org), org.orgId, org.userId);

    await db('event_lot_links')
      .where({ event_id: event.id, lot_id: org.lotIds[0] })
      .update({ quantity: 99 });

    await verifyHashChain({ organizationId: org.orgId });

    const failures = await failedAudits(org.orgId);
    expect(failures).toHaveLength(1);
    expect(failures[0].entity_id).toBe(event.id);
    expect(failures[0].metadata.reason).toBe('payload_mismatch');
  });

  it('detects tampering with the event datetime', async () => {
    const org = await seedOrganization('tamper-datetime');
    const event = await eventsService.createEvent(buildLinkedEvent(org), org.orgId, org.userId);

    await db('events')
      .where({ id: event.id })
      .update({ event_datetime: new Date('2025-01-01T00:00:00.000Z') });

    await verifyHashChain({ organizationId: org.orgId });

    const failures = await failedAudits(org.orgId);
    expect(failures).toHaveLength(1);
    expect(failures[0].entity_id).toBe(event.id);
    expect(failures[0].metadata.reason).toBe('payload_mismatch');
  });

  it('refuses to verify an unsupported hash version', async () => {
    const org = await seedOrganization('hash-version');
    const event = await eventsService.createEvent(buildLinkedEvent(org), org.orgId, org.userId);

    await db('events').where({ id: event.id }).update({ hash_version: 1 });

    await verifyHashChain({ organizationId: org.orgId });

    const failures = await failedAudits(org.orgId);
    expect(failures).toHaveLength(1);
    expect(failures[0].metadata.reason).toBe('unsupported_hash_version');
    expect(failures[0].metadata.found_version).toBe(1);
    expect(failures[0].metadata.expected_version).toBe(2);
  });

  it('stores hash_version as a required smallint defaulting to the current version', async () => {
    const column = await db('information_schema.columns')
      .where({
        table_schema: 'public',
        table_name: 'events',
        column_name: 'hash_version',
      })
      .first();

    expect(column.data_type).toBe('smallint');
    expect(column.is_nullable).toBe('NO');
    expect(column.column_default).toContain('2');
  });
});
