/**
 * P0-02 regression tests — deterministic hash chain ordering.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p002_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p002_test \
 *   npx jest --runInBand src/modules/events/events.chain-seq.test.js
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

describeDb('P0-02 deterministic hash chain ordering', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let verifyHashChain;
  let hashChain;

  const seedOrganization = async (label, lotCount = 2) => {
    const orgId = uuidv4();
    const userId = uuidv4();
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

    return { orgId, userId, productId, lotIds };
  };

  const buildLinkedEventData = (org, index, overrides = {}) => ({
    eventType: 'transformation',
    eventDatetime: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString(),
    source: 'manual',
    kdePayload: { sequence: index },
    counterpartyInfo: null,
    inputs: [{ lotId: org.lotIds[0], quantity: 1 + (index % 5), uom: 'kg' }],
    outputs: [{ lotId: org.lotIds[1], quantity: 2 + (index % 5), uom: 'kg' }],
    ...overrides,
  });

  // Linkless events are used for verifier assertions so P0-01's decimal
  // quantity mismatch does not mask the ordering result.
  const buildLinklessEventData = (index, overrides = {}) => ({
    eventType: 'creation',
    eventDatetime: new Date(Date.UTC(2026, 1, 1, 0, 0, index)).toISOString(),
    source: 'manual',
    kdePayload: { sequence: index },
    counterpartyInfo: null,
    inputs: [],
    outputs: [],
    ...overrides,
  });

  const readChain = (orgId) => db('events')
    .where({ organization_id: orgId })
    .orderBy('chain_seq', 'asc');

  const expectContiguous = (events) => {
    expect(events.map((event) => Number(event.chain_seq))).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
  };

  const expectLinkage = (events) => {
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].prev_hash).toBe('GENESIS');
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].prev_hash).toBe(events[index - 1].record_hash);
    }
  };

  const failedAudits = (orgId) => db('audit_log')
    .where({ organization_id: orgId, action: 'hash.verify_failed' });

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

  it('assigns contiguous chain_seq values for sequential creates', async () => {
    const org = await seedOrganization('sequential');

    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await eventsService.createEvent(buildLinklessEventData(index), org.orgId, org.userId);
    }

    const events = await readChain(org.orgId);
    expectContiguous(events);
    expectLinkage(events);

    await verifyHashChain({ organizationId: org.orgId });
    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('keeps chain_seq unique and ordered under 50 concurrent creates', async () => {
    const org = await seedOrganization('concurrent');
    const concurrency = 50;

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, index) => eventsService.createEvent(
        buildLinkedEventData(org, index),
        org.orgId,
        org.userId,
      )),
    );

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.map((result) => result.reason.message)).toEqual([]);

    const events = await readChain(org.orgId);
    expect(events).toHaveLength(concurrency);
    expectContiguous(events);
    expectLinkage(events);
  });

  it('sequences each organization independently under concurrent load', async () => {
    const orgA = await seedOrganization('org-a');
    const orgB = await seedOrganization('org-b');
    const concurrency = 25;

    const createFor = (org) => Array.from({ length: concurrency }, (_, index) => (
      eventsService.createEvent(buildLinkedEventData(org, index), org.orgId, org.userId)
    ));

    const results = await Promise.allSettled([...createFor(orgA), ...createFor(orgB)]);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.map((result) => result.reason.message)).toEqual([]);

    for (const org of [orgA, orgB]) {
      // eslint-disable-next-line no-await-in-loop
      const events = await readChain(org.orgId);
      expectContiguous(events);
      expectLinkage(events);
    }
  });

  it('ignores created_at when reading the tip and the verifier order', async () => {
    const org = await seedOrganization('inverted');

    const first = await eventsService.createEvent(buildLinklessEventData(0), org.orgId, org.userId);
    const second = await eventsService.createEvent(buildLinklessEventData(1), org.orgId, org.userId);

    expect(Number(first.chain_seq)).toBe(1);
    expect(Number(second.chain_seq)).toBe(2);
    expect(second.prev_hash).toBe(first.record_hash);

    // Simulate the P0-02 inversion: the earlier chain link now looks newer.
    await db('events')
      .where({ id: first.id })
      .update({ created_at: new Date('2030-01-01T00:00:00.000Z') });

    const third = await eventsService.createEvent(buildLinklessEventData(2), org.orgId, org.userId);
    expect(Number(third.chain_seq)).toBe(3);
    expect(third.prev_hash).toBe(second.record_hash);

    // `created_at` is part of the P1-18 hash payload. Restore the sealed value
    // before verification so this test isolates ordering, not tamper detection.
    await db('events').where({ id: first.id }).update({ created_at: first.created_at });

    await verifyHashChain({ organizationId: org.orgId });
    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('still detects tampering after the ordering change', async () => {
    const org = await seedOrganization('tamper');

    const events = [];
    for (let index = 0; index < 3; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      events.push(await eventsService.createEvent(
        buildLinklessEventData(index),
        org.orgId,
        org.userId,
      ));
    }

    await db('events')
      .where({ id: events[1].id })
      .update({ kde_payload: JSON.stringify({ tampered: true }) });

    await verifyHashChain({ organizationId: org.orgId });

    const failures = await failedAudits(org.orgId);
    expect(failures).toHaveLength(1);
    expect(failures[0].entity_id).toBe(events[1].id);
  });

  it('enforces the chain_seq column and per-organization uniqueness', async () => {
    const org = await seedOrganization('schema');
    const otherOrg = await seedOrganization('schema-other');

    const column = await db('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'events', column_name: 'chain_seq' })
      .first();
    expect(column.data_type).toBe('bigint');
    expect(column.is_nullable).toBe('NO');

    const index = await db('pg_indexes')
      .where({ schemaname: 'public', tablename: 'events', indexname: 'idx_events_org_chain_seq' })
      .first();
    expect(index.indexdef).toContain('UNIQUE');

    const baseEvent = {
      event_type: 'creation',
      event_datetime: new Date('2026-03-01T00:00:00.000Z'),
      recorded_by: org.userId,
      source: 'manual',
      kde_payload: JSON.stringify({}),
      record_hash: 'schema-hash',
      prev_hash: 'GENESIS',
      chain_seq: 1,
      hash_key_id: hashChain.getCurrentHashKeyId(),
    };

    await db('events').insert({
      ...baseEvent,
      id: uuidv4(),
      organization_id: org.orgId,
    });

    await expect(db('events').insert({
      ...baseEvent,
      id: uuidv4(),
      organization_id: org.orgId,
    })).rejects.toMatchObject({ code: '23505' });

    await expect(db('events').insert({
      ...baseEvent,
      id: uuidv4(),
      organization_id: otherOrg.orgId,
    })).resolves.toBeDefined();
  });
});
