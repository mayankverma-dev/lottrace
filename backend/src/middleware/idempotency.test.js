/**
 * P0-06 regression tests — HTTP idempotency for event creation.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p006_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p006_test \
 *   npx jest --runInBand src/middleware/idempotency.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

require('express-async-errors');

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../test/dbGuard').announceTarget();
}

jest.mock('../modules/trace/trace.service', () => ({
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../jobs/queues', () => ({
  connection: {},
}));

const path = require('path');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const apiResponse = require('../utils/apiResponse');
const validate = require('./validate');
const idempotency = require('./idempotency');
const errorHandler = require('./errorHandler');
const { createEventSchema } = require('../modules/events/events.validation');
const { purgeExpiredIdempotencyKeys } = require('../utils/idempotency');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');

describeDb('P0-06 event creation idempotency', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-06 ${label}`,
      slug: `p0-06-${label}-${orgId.slice(0, 8)}`,
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
      name: `P0-06 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    const lotIds = [uuidv4(), uuidv4()];
    await db('lots').insert(lotIds.map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-06-${label}-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    })));

    return { orgId, userId, productId, lotIds };
  };

  const buildApp = (org) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.organizationId = org.orgId;
      req.user = { id: org.userId, organizationId: org.orgId, role: 'org_admin' };
      next();
    });
    app.post(
      '/api/v1/events',
      validate(createEventSchema),
      idempotency,
      async (req, res) => {
        const event = await eventsService.createEvent(
          req.validatedBody,
          req.organizationId,
          req.user.id,
        );
        return apiResponse.created(res, event, 'Event created successfully');
      },
    );
    app.use(errorHandler);
    return app;
  };

  const eventBody = (org, overrides = {}) => ({
    eventType: 'creation',
    eventDatetime: '2026-11-13T10:00:00.000Z',
    kdePayload: {},
    outputs: [{ lotId: org.lotIds[0], quantity: 1, uom: 'kg' }],
    ...overrides,
  });

  const countEvents = async (orgId) => {
    const [row] = await db('events').where({ organization_id: orgId }).count('* as count');
    return Number(row.count);
  };

  const send = (app, key, body) => {
    const req = request(app).post('/api/v1/events');
    return key ? req.set('Idempotency-Key', key).send(body) : req.send(body);
  };

  beforeAll(async () => {
    db = require('../db/knex');
    eventsService = require('../modules/events/events.service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('replays the original response for the same key and body', async () => {
    const org = await seedOrganization('replay');
    const app = buildApp(org);
    const key = uuidv4();
    const body = eventBody(org);

    const first = await send(app, key, body);
    const second = await send(app, key, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await countEvents(org.orgId)).toBe(1);
    expect(await db('event_lot_links').where({ event_id: first.body.data.id })).toHaveLength(1);
  });

  it('returns 409 when the same key is used with a different body', async () => {
    const org = await seedOrganization('mismatch');
    const app = buildApp(org);
    const key = uuidv4();

    const first = await send(app, key, eventBody(org));
    const second = await send(
      app,
      key,
      eventBody(org, {
        outputs: [{ lotId: org.lotIds[1], quantity: 2, uom: 'kg' }],
      }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await countEvents(org.orgId)).toBe(1);
  });

  it('creates exactly one event for two concurrent requests with the same key', async () => {
    const org = await seedOrganization('concurrent');
    const app = buildApp(org);
    const key = uuidv4();
    const body = eventBody(org);

    const [first, second] = await Promise.all([
      send(app, key, body),
      send(app, key, body),
    ]);

    const statuses = [first.status, second.status];
    expect(statuses).toContain(201);
    statuses.forEach((status) => expect([201, 409]).toContain(status));
    expect(await countEvents(org.orgId)).toBe(1);

    const retry = await send(app, key, body);
    expect(retry.status).toBe(201);
    expect(await countEvents(org.orgId)).toBe(1);
  });

  it('executes anew when the stored key has expired', async () => {
    const org = await seedOrganization('expired');
    const app = buildApp(org);
    const key = uuidv4();
    const body = eventBody(org);

    const first = await send(app, key, body);
    expect(first.status).toBe(201);

    await db('idempotency_keys')
      .where({ organization_id: org.orgId, key })
      .update({ expires_at: new Date(Date.now() - 1000) });

    const second = await send(app, key, body);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect(await countEvents(org.orgId)).toBe(2);

    const rows = await db('idempotency_keys').where({ organization_id: org.orgId, key });
    expect(rows).toHaveLength(1);
    expect(rows[0].response_status).toBe(201);
  });

  it('reclaims a stale in-flight claim after its short TTL', async () => {
    const org = await seedOrganization('stale-claim');
    const app = buildApp(org);
    const key = uuidv4();

    await db('idempotency_keys').insert({
      organization_id: org.orgId,
      key,
      request_hash: 'stale',
      response_status: null,
      response_body: null,
      expires_at: new Date(Date.now() - 1000),
    });

    const response = await send(app, key, eventBody(org));

    expect(response.status).toBe(201);
    expect(await countEvents(org.orgId)).toBe(1);
  });

  it('does not cache a validation error', async () => {
    const org = await seedOrganization('validation');
    const app = buildApp(org);
    const key = uuidv4();

    const invalid = await send(app, key, {
      eventType: 'creation',
      eventDatetime: '2026-11-13T10:00:00.000Z',
      outputs: [],
    });
    expect(invalid.status).toBe(422);
    expect(await db('idempotency_keys').where({ organization_id: org.orgId, key })).toHaveLength(0);

    const valid = await send(app, key, eventBody(org));
    expect(valid.status).toBe(201);
    expect(await countEvents(org.orgId)).toBe(1);
  });

  it('does not cache a failed handler response', async () => {
    const org = await seedOrganization('handler-failure');
    const app = buildApp(org);
    const key = uuidv4();

    const missingLot = await send(
      app,
      key,
      eventBody(org, {
        outputs: [{ lotId: uuidv4(), quantity: 1, uom: 'kg' }],
      }),
    );
    expect(missingLot.status).toBe(404);
    expect(missingLot.body.error.code).toBe('NOT_FOUND');

    const valid = await send(app, key, eventBody(org));
    expect(valid.status).toBe(201);
    expect(await countEvents(org.orgId)).toBe(1);
  });

  it('scopes keys per organization so two tenants may reuse the same value', async () => {
    const orgA = await seedOrganization('tenant-a');
    const orgB = await seedOrganization('tenant-b');
    const key = uuidv4();

    const first = await send(buildApp(orgA), key, eventBody(orgA));
    const second = await send(buildApp(orgB), key, eventBody(orgB));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await countEvents(orgA.orgId)).toBe(1);
    expect(await countEvents(orgB.orgId)).toBe(1);
    expect(await db('idempotency_keys').where({ key })).toHaveLength(2);
  });

  it('rejects an idempotency key longer than 255 characters', async () => {
    const org = await seedOrganization('long-key');
    const app = buildApp(org);
    const key = 'a'.repeat(256);

    const response = await send(app, key, eventBody(org));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await countEvents(org.orgId)).toBe(0);
    expect(await db('idempotency_keys').where({ organization_id: org.orgId })).toHaveLength(0);
  });

  it('purges only expired idempotency rows', async () => {
    const org = await seedOrganization('purge');
    const now = Date.now();

    await db('idempotency_keys').insert([
      {
        organization_id: org.orgId,
        key: 'expired-key',
        request_hash: 'expired',
        response_status: 201,
        response_body: { success: true },
        expires_at: new Date(now - 60_000),
      },
      {
        organization_id: org.orgId,
        key: 'live-key',
        request_hash: 'live',
        response_status: 201,
        response_body: { success: true },
        expires_at: new Date(now + 60_000),
      },
    ]);

    const deleted = await purgeExpiredIdempotencyKeys(db);

    expect(deleted).toBe(1);
    const remaining = await db('idempotency_keys').where({ organization_id: org.orgId });
    expect(remaining.map((row) => row.key)).toEqual(['live-key']);
  });

  it('creates events with the same idempotency_key in different organizations only', async () => {
    const orgA = await seedOrganization('events-key-a');
    const orgB = await seedOrganization('events-key-b');
    const sharedKey = 'import-shared-transaction';

    const eventRow = (org, chainSeq) => ({
      organization_id: org.orgId,
      event_type: 'creation',
      event_datetime: new Date('2026-11-13T10:00:00.000Z'),
      recorded_by: org.userId,
      source: 'import',
      kde_payload: JSON.stringify({}),
      idempotency_key: sharedKey,
      record_hash: 'PENDING',
      prev_hash: 'GENESIS',
      chain_seq: chainSeq,
      hash_version: 3,
      hash_key_id: 'PENDING',
      status: 'active',
    });

    await db('events').insert(eventRow(orgA, 1));
    await db('events').insert(eventRow(orgB, 1));

    await expect(db('events').insert(eventRow(orgA, 2)))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('still creates two events when no key is sent', async () => {
    const org = await seedOrganization('no-key');
    const app = buildApp(org);
    const body = eventBody(org);

    const first = await send(app, null, body);
    const second = await send(app, null, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await countEvents(org.orgId)).toBe(2);
  });
});
