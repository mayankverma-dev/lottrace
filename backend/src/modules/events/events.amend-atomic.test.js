/**
 * P0-04 regression tests — amendment must be atomic.
 *
 * The replacement event, the `amended` status on the superseded row, and its
 * signed evidence all commit in one transaction. A failure at any point leaves
 * no replacement behind, and a superseded event can never be superseded twice.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p004_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p004_test \
 *   npx jest --runInBand src/modules/events/events.amend-atomic.test.js
 *
 * Redis is replaced with an in-memory map so the cache assertions do not depend
 * on a live Redis instance. The suite drops and recreates the public schema in
 * the disposable database. dbGuard refuses Neon, non-local hosts, and names
 * without the `_test` suffix.
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
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));
jest.mock('../../lib/sentry', () => ({
  initSentry: jest.fn(),
  captureHashVerificationFailure: jest.fn().mockReturnValue(false),
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P0-04 atomic event amendment', () => {
  jest.setTimeout(120000);

  let db;
  let redis;
  let eventsService;
  let traceService;
  let verifyHashChain;
  let hashChain;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-04 ${label}`,
      slug: `p0-04-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P0',
      last_name: 'Amend',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P0-04 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    const lotIds = Array.from({ length: 4 }, () => uuidv4());
    await db('lots').insert(lotIds.map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-04-${label}-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    })));

    return {
      orgId,
      userId,
      productId,
      inputLotId: lotIds[0],
      oldOutputLotId: lotIds[1],
      newOutputLotId: lotIds[2],
      spareLotId: lotIds[3],
    };
  };

  const createTransformation = (org, overrides = {}) => eventsService.createEvent({
    eventType: 'transformation',
    eventDatetime: '2026-11-12T10:00:00.000Z',
    source: 'manual',
    kdePayload: {},
    counterpartyInfo: null,
    inputs: [{ lotId: org.inputLotId, quantity: 10, uom: 'kg' }],
    outputs: [{ lotId: org.oldOutputLotId, quantity: 9, uom: 'kg' }],
    ...overrides,
  }, org.orgId, org.userId);

  const buildAmendPayload = (org, overrides = {}) => ({
    eventType: 'transformation',
    eventDatetime: '2026-11-12T11:00:00.000Z',
    source: 'manual',
    kdePayload: { corrected: true },
    counterpartyInfo: null,
    inputs: [{ lotId: org.inputLotId, quantity: 10, uom: 'kg' }],
    outputs: [{ lotId: org.oldOutputLotId, quantity: 9, uom: 'kg' }],
    voidReason: 'corrected quantity',
    ...overrides,
  });

  const evidenceRows = (eventId) => db('event_evidence')
    .where({ event_id: eventId })
    .orderBy('seq', 'asc');

  const eventRows = (orgId) => db('events')
    .where({ organization_id: orgId })
    .orderBy('chain_seq', 'asc');

  const failedAudits = (orgId) => db('audit_log')
    .where({ organization_id: orgId, action: 'hash.verify_failed' });

  /**
   * Forces the `active` -> `amended` transition to fail at the database level.
   * The seal update only rewrites `record_hash`, so it is unaffected.
   */
  const blockAmendTransition = async () => {
    await db.raw(`
      CREATE OR REPLACE FUNCTION p0_04_block_amend() RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'active' AND NEW.status = 'amended' THEN
          RAISE EXCEPTION 'p0-04 forced amend failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.raw(
      'CREATE TRIGGER p0_04_block_amend BEFORE UPDATE ON events '
      + 'FOR EACH ROW EXECUTE FUNCTION p0_04_block_amend()',
    );
  };

  const unblockAmendTransition = async () => {
    await db.raw('DROP TRIGGER IF EXISTS p0_04_block_amend ON events');
    await db.raw('DROP FUNCTION IF EXISTS p0_04_block_amend()');
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    redis = require('../../config/redis');
    eventsService = require('./events.service');
    traceService = require('../trace/trace.service');
    ({ verifyHashChain } = require('../../jobs/workers/hash-verifier'));
    hashChain = require('../../utils/hashChain');

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

  it('leaves no replacement when the status transition fails', async () => {
    const org = await seedOrganization('rollback');
    const original = await createTransformation(org);

    await blockAmendTransition();
    try {
      await expect(
        eventsService.amendEvent(original.id, buildAmendPayload(org), org.orgId, org.userId),
      ).rejects.toThrow('p0-04 forced amend failure');
    } finally {
      await unblockAmendTransition();
    }

    expect(await db('events').where({ supersedes_event_id: original.id })).toHaveLength(0);

    const rows = await eventRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(original.id);
    expect(rows[0].status).toBe('active');
    expect(Number(rows[0].chain_seq)).toBe(1);
    expect(await evidenceRows(original.id)).toHaveLength(0);
  });

  it('rejects a second supersede of the same event at the database level', async () => {
    const org = await seedOrganization('unique');
    const original = await createTransformation(org);
    await eventsService.amendEvent(original.id, buildAmendPayload(org), org.orgId, org.userId);

    await expect(db('events').insert({
      id: uuidv4(),
      organization_id: org.orgId,
      event_type: 'transformation',
      event_datetime: '2026-11-12T12:00:00.000Z',
      recorded_by: org.userId,
      source: 'manual',
      kde_payload: JSON.stringify({}),
      record_hash: 'p0-04-test-hash',
      prev_hash: 'p0-04-test-prev',
      chain_seq: 99,
      hash_version: hashChain.HASH_VERSION,
      hash_key_id: 'p0-04-test-key',
      status: 'active',
      supersedes_event_id: original.id,
    })).rejects.toMatchObject({ code: '23505' });
  });

  it('lets exactly one of two concurrent amendments win', async () => {
    const org = await seedOrganization('concurrent');
    const original = await createTransformation(org);

    const results = await Promise.allSettled([
      eventsService.amendEvent(original.id, buildAmendPayload(org), org.orgId, org.userId),
      eventsService.amendEvent(original.id, buildAmendPayload(org), org.orgId, org.userId),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'EVENT_IMMUTABLE', statusCode: 409 });

    expect(await db('events').where({ supersedes_event_id: original.id })).toHaveLength(1);

    const rows = await eventRows(org.orgId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === 'active')).toHaveLength(1);
    expect(rows.filter((row) => row.status === 'amended')).toHaveLength(1);
    expect(rows[0].status).toBe('amended');
    expect(rows[1].status).toBe('active');
  });

  it('commits one chain position, one evidence row, and a verifiable history', async () => {
    const org = await seedOrganization('single-commit');
    const original = await createTransformation(org);

    const replacement = await eventsService.amendEvent(
      original.id,
      buildAmendPayload(org),
      org.orgId,
      org.userId,
    );

    const rows = await eventRows(org.orgId);
    expect(rows.map((row) => Number(row.chain_seq))).toEqual([1, 2]);
    expect(rows[0].status).toBe('amended');
    expect(rows[0].void_reason).toBe('corrected quantity');
    expect(rows[1].id).toBe(replacement.id);
    expect(rows[1].status).toBe('active');
    expect(rows[1].supersedes_event_id).toBe(original.id);

    const evidence = await evidenceRows(original.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ seq: 1, kind: 'status_change', prev_hash: original.record_hash });
    expect(evidence[0].payload).toMatchObject({
      fromStatus: 'active',
      toStatus: 'amended',
      reason: 'corrected quantity',
      actorId: org.userId,
    });

    await verifyHashChain({ organizationId: org.orgId });
    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('rolls back everything when the replacement payload references an unknown lot', async () => {
    const org = await seedOrganization('bad-payload');
    const original = await createTransformation(org);

    await expect(
      eventsService.amendEvent(
        original.id,
        buildAmendPayload(org, { outputs: [{ lotId: uuidv4(), quantity: 9, uom: 'kg' }] }),
        org.orgId,
        org.userId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    expect(await db('events').where({ supersedes_event_id: original.id })).toHaveLength(0);
    expect((await db('events').where({ id: original.id }).first()).status).toBe('active');
    expect(await evidenceRows(original.id)).toHaveLength(0);
  });

  it('rejects an amendment that changes the event type', async () => {
    const org = await seedOrganization('type-change');
    const original = await createTransformation(org);

    await expect(
      eventsService.amendEvent(
        original.id,
        buildAmendPayload(org, { eventType: 'receiving' }),
        org.orgId,
        org.userId,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

    expect(await db('events').where({ supersedes_event_id: original.id })).toHaveLength(0);
    expect((await db('events').where({ id: original.id }).first()).status).toBe('active');
  });

  it('keeps the original source instead of trusting the amend payload', async () => {
    const org = await seedOrganization('source');
    const original = await createTransformation(org, { source: 'scan' });

    const replacement = await eventsService.amendEvent(
      original.id,
      buildAmendPayload(org, { source: 'manual' }),
      org.orgId,
      org.userId,
    );

    expect(replacement.source).toBe('scan');
    const stored = await db('events').where({ id: replacement.id }).first();
    expect(stored.source).toBe('scan');
  });

  it('invalidates the superseded event\'s lots after commit only', async () => {
    const org = await seedOrganization('cache');
    const original = await createTransformation(org);

    // Warm the graph for the lot the amendment is about to drop, plus a key for
    // a lot that only the replacement will reference.
    await traceService.backwardTrace(org.oldOutputLotId, org.orgId);
    await traceService.fullTrace(org.inputLotId, org.orgId);
    const oldKey = `trace:v2:${org.orgId}:${org.oldOutputLotId}:backward`;
    const inputKey = `trace:v2:${org.orgId}:${org.inputLotId}:full`;
    const newKey = `trace:v2:${org.orgId}:${org.newOutputLotId}:backward`;
    await redis.set(newKey, JSON.stringify({ marker: 'stale' }));
    expect(redis.__store.has(oldKey)).toBe(true);
    expect(redis.__store.has(inputKey)).toBe(true);

    await eventsService.amendEvent(
      original.id,
      buildAmendPayload(org, { outputs: [{ lotId: org.newOutputLotId, quantity: 8, uom: 'kg' }] }),
      org.orgId,
      org.userId,
    );

    expect(redis.__store.has(oldKey)).toBe(false);
    expect(redis.__store.has(inputKey)).toBe(false);
    expect(redis.__store.has(newKey)).toBe(false);

    // A rejected amendment must not evict a valid cache entry.
    const second = await createTransformation(org);
    await traceService.fullTrace(org.inputLotId, org.orgId);
    const warmKey = `trace:v2:${org.orgId}:${org.inputLotId}:full`;
    expect(redis.__store.has(warmKey)).toBe(true);

    await expect(
      eventsService.amendEvent(
        second.id,
        buildAmendPayload(org, { outputs: [{ lotId: uuidv4(), quantity: 8, uom: 'kg' }] }),
        org.orgId,
        org.userId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(redis.__store.has(warmKey)).toBe(true);
  });
});
