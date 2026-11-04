/**
 * P0-02 regression tests — deterministic hash chain ordering.
 *
 * Requires a disposable local PostgreSQL database:
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgres://lottrace:lottrace@localhost:55432/lottrace_p002_test \
 *   npx jest --runInBand src/modules/events/events.chain-seq.test.js
 *
 * The suite refuses to run against any non-local host or a database whose name does
 * not end in `_test`, so the Neon URL in backend/.env can never be touched.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../trace/trace.service', () => ({
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));

const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('P0-02 deterministic hash chain ordering', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let verifyHashChain;

  /**
   * Creates an isolated organization with one product, one location and `lotCount` lots.
   * Each test gets its own org so chain_seq always starts at 1.
   */
  const seedOrganization = async (label, lotCount = 4) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const locationId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-02 ${label}`,
      slug: `p0-02-${label}-${orgId.slice(0, 8)}`,
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
      name: `P0-02 Plant ${label}`,
      type: 'plant',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P0-02 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    const lotIds = Array.from({ length: lotCount }, () => uuidv4());
    await db('lots').insert(lotIds.map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-02-${label}-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    })));

    return { orgId, userId, locationId, lotIds };
  };

  const buildEventData = ({ locationId, lotIds }, index, overrides = {}) => ({
    eventType: 'transformation',
    locationId,
    eventDatetime: `2026-02-0${(index % 9) + 1}T0${index % 10}:00:00Z`,
    source: 'manual',
    kdePayload: { sequence: index },
    counterpartyInfo: null,
    inputs: [{ lotId: lotIds[0], quantity: 1 + index, uom: 'kg' }],
    outputs: [{ lotId: lotIds[1], quantity: 2 + index, uom: 'kg' }],
    ...overrides,
  });

  const readChain = async (orgId) => db('events')
    .where({ organization_id: orgId })
    .orderBy('chain_seq', 'asc');

  beforeAll(() => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    ({ verifyHashChain } = require('../../jobs/hash-chain-verifier'));
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('assigns contiguous chain_seq values for sequential creates', async () => {
    const org = await seedOrganization('sequential');

    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await eventsService.createEvent(buildEventData(org, index), org.orgId, org.userId);
    }

    const events = await readChain(org.orgId);

    expect(events.map((event) => Number(event.chain_seq))).toEqual([1, 2, 3, 4, 5]);
    expect(events[0].prev_hash).toBe('GENESIS');
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].prev_hash).toBe(events[index - 1].record_hash);
    }

    const result = await verifyHashChain({ organizationId: org.orgId });
    expect(result.failures).toEqual([]);
    expect(result.canonicalVerified).toBe(5);
  });

  it('keeps chain_seq unique and ordered under 50 concurrent creates', async () => {
    const org = await seedOrganization('concurrent');
    const concurrency = 50;

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, index) => eventsService.createEvent(
        buildEventData(org, index),
        org.orgId,
        org.userId,
      )),
    );

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.map((result) => result.reason.message)).toEqual([]);

    const events = await readChain(org.orgId);

    expect(events).toHaveLength(concurrency);
    expect(events.map((event) => Number(event.chain_seq))).toEqual(
      Array.from({ length: concurrency }, (_, index) => index + 1),
    );

    expect(events[0].prev_hash).toBe('GENESIS');
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].prev_hash).toBe(events[index - 1].record_hash);
    }

    const result = await verifyHashChain({ organizationId: org.orgId });
    expect(result.failures).toEqual([]);
    expect(result.canonicalVerified).toBe(concurrency);
  });

  it('sequences each organization independently under concurrent load', async () => {
    const orgA = await seedOrganization('org-a');
    const orgB = await seedOrganization('org-b');
    const concurrency = 25;

    const createFor = (org) => Array.from({ length: concurrency }, (_, index) => (
      eventsService.createEvent(buildEventData(org, index), org.orgId, org.userId)
    ));

    const results = await Promise.allSettled([...createFor(orgA), ...createFor(orgB)]);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.map((result) => result.reason.message)).toEqual([]);

    const expected = Array.from({ length: concurrency }, (_, index) => index + 1);

    for (const org of [orgA, orgB]) {
      const events = await readChain(org.orgId);
      expect(events.map((event) => Number(event.chain_seq))).toEqual(expected);

      // eslint-disable-next-line no-await-in-loop
      const result = await verifyHashChain({ organizationId: org.orgId });
      expect(result.failures).toEqual([]);
    }
  });

  it('ignores created_at when reading the tip and the verifier order', async () => {
    const org = await seedOrganization('inverted');

    const first = await eventsService.createEvent(buildEventData(org, 0), org.orgId, org.userId);
    const second = await eventsService.createEvent(buildEventData(org, 1), org.orgId, org.userId);

    expect(Number(first.chain_seq)).toBe(1);
    expect(Number(second.chain_seq)).toBe(2);
    expect(second.prev_hash).toBe(first.record_hash);

    // Simulate the P0-02 inversion: the earlier chain link now looks newer.
    await db('events')
      .where({ id: first.id })
      .update({ created_at: new Date('2030-01-01T00:00:00.000Z') });

    // The verifier must still read the chain in chain_seq order.
    let result = await verifyHashChain({ organizationId: org.orgId });
    expect(result.failures).toEqual([]);

    // And the writer must link to the true tip (chain_seq 2), not the newest created_at.
    const third = await eventsService.createEvent(buildEventData(org, 2), org.orgId, org.userId);
    expect(Number(third.chain_seq)).toBe(3);
    expect(third.prev_hash).toBe(second.record_hash);

    result = await verifyHashChain({ organizationId: org.orgId });
    expect(result.failures).toEqual([]);
    expect(result.canonicalVerified).toBe(3);
  });

  it('still detects tampering after the ordering change', async () => {
    const org = await seedOrganization('tamper');

    const events = [];
    for (let index = 0; index < 3; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      events.push(await eventsService.createEvent(buildEventData(org, index), org.orgId, org.userId));
    }

    const target = events[1];
    await db('events')
      .where({ id: target.id })
      .update({ event_datetime: new Date('2026-09-09T09:09:09.000Z') });

    const result = await verifyHashChain({ organizationId: org.orgId });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].eventId).toBe(target.id);
    expect(result.failures[0].chainSeq).toBe(2);
    expect(result.failures[0].reason).toBe('hash_mismatch');
  });
});
