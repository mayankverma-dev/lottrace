/**
 * P0-12 regression tests — operators can read events.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p012_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:REPLACE_WITH_LOCAL_PASSWORD@127.0.0.1:5432/lottrace_p012_test \
 *   npx jest --runInBand src/modules/events/events.operator-read.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

// Deterministic test-only HMAC key. Never used outside this disposable suite.
process.env.HASH_CHAIN_KEY_ID = process.env.HASH_CHAIN_KEY_ID || 'p012-test-k1';
process.env.HASH_CHAIN_SECRET = process.env.HASH_CHAIN_SECRET || 'd'.repeat(64);

require('express-async-errors');

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../trace/trace.service', () => ({
  bumpTraceCacheVersion: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));
jest.mock('../../middleware/authenticate', () => (req, res, next) => {
  const role = req.get('x-test-role');
  const userId = req.get('x-test-user-id');
  const organizationId = req.get('x-test-org-id');

  if (!role || !userId || !organizationId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: { code: 'AUTH_REQUIRED' },
    });
  }

  req.user = { id: userId, organizationId, role };
  next();
});

const path = require('path');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const eventsRoutes = require('./events.routes');
const errorHandler = require('../../middleware/errorHandler');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/events', eventsRoutes);
  app.use(errorHandler);
  return app;
};

const as = (req, actor) => req
  .set('x-test-role', actor.role)
  .set('x-test-user-id', actor.userId)
  .set('x-test-org-id', actor.orgId);

const creationBody = (org) => ({
  eventType: 'creation',
  eventDatetime: '2026-11-14T10:00:00.000Z',
  kdePayload: {},
  outputs: [{ lotId: org.lotId, quantity: 1, uom: 'kg' }],
});

describeDb('P0-12 operator event read access', () => {
  jest.setTimeout(120000);

  let db;
  let app;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const operatorId = uuidv4();
    const auditorId = uuidv4();
    const productId = uuidv4();
    const lotId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P0-12 ${label}`,
      slug: `p0-12-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert([
      {
        id: operatorId,
        organization_id: orgId,
        first_name: 'P0',
        last_name: 'Operator',
        email: `${orgId}-operator@example.test`,
        role: 'operator',
        status: 'active',
      },
      {
        id: auditorId,
        organization_id: orgId,
        first_name: 'P0',
        last_name: 'Auditor',
        email: `${orgId}-auditor@example.test`,
        role: 'auditor',
        status: 'active',
      },
    ]);

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P0-12 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    await db('lots').insert({
      id: lotId,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P0-12-${label}-${orgId.slice(0, 8)}`,
      quantity: 100,
      uom: 'kg',
      created_by: operatorId,
    });

    return {
      orgId,
      operatorId,
      auditorId,
      productId,
      lotId,
      operator: { role: 'operator', userId: operatorId, orgId },
      auditor: { role: 'auditor', userId: auditorId, orgId },
    };
  };

  const createEventAsOperator = async (org) => {
    const res = await as(request(app).post('/api/v1/events'), org.operator).send(creationBody(org));
    expect(res.status).toBe(201);
    return res.body.data;
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    app = buildApp();

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('lets an operator create an event, list it, and open its detail', async () => {
    const org = await seedOrganization('readback');
    const created = await createEventAsOperator(org);

    const list = await as(request(app).get('/api/v1/events'), org.operator);
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data.map((event) => event.id)).toContain(created.id);
    expect(list.body.pagination).toEqual({
      limit: 20,
      hasNextPage: false,
      nextCursor: null,
    });

    const detail = await as(request(app).get(`/api/v1/events/${created.id}`), org.operator);
    expect(detail.status).toBe(200);
    expect(detail.body.success).toBe(true);
    expect(detail.body.data.id).toBe(created.id);
    expect(detail.body.data.outputs).toHaveLength(1);
    expect(detail.body.data.inputs).toHaveLength(0);
  });

  it('returns only events from the operator organization', async () => {
    const orgA = await seedOrganization('list-a');
    const orgB = await seedOrganization('list-b');
    const eventA = await createEventAsOperator(orgA);
    const eventB = await createEventAsOperator(orgB);

    const list = await as(request(app).get('/api/v1/events'), orgA.operator);

    expect(list.status).toBe(200);
    expect(list.body.data.map((event) => event.id)).toEqual([eventA.id]);
    expect(list.body.data.map((event) => event.id)).not.toContain(eventB.id);
  });

  it('returns 404 when an operator requests another organization event', async () => {
    const orgA = await seedOrganization('cross-a');
    const orgB = await seedOrganization('cross-b');
    const eventB = await createEventAsOperator(orgB);

    const res = await as(request(app).get(`/api/v1/events/${eventB.id}`), orgA.operator);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('still forbids operators from voiding or amending events', async () => {
    const org = await seedOrganization('mutations');
    const created = await createEventAsOperator(org);

    const voidRes = await as(
      request(app).post(`/api/v1/events/${created.id}/void`),
      org.operator,
    ).send({ voidReason: 'operator must not void' });
    expect(voidRes.status).toBe(403);
    expect(voidRes.body.error.code).toBe('AUTH_FORBIDDEN');

    const amendRes = await as(
      request(app).post(`/api/v1/events/${created.id}/amend`),
      org.operator,
    ).send({ amendReason: 'operator must not amend' });
    expect(amendRes.status).toBe(403);
    expect(amendRes.body.error.code).toBe('AUTH_FORBIDDEN');

    const rows = await db('events').where({ organization_id: org.orgId });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].status).toBe('active');
    expect(rows[0].status_reason).toBeNull();
  });

  it('keeps auditor read access and denies auditor creation', async () => {
    const org = await seedOrganization('auditor');
    const created = await createEventAsOperator(org);

    const list = await as(request(app).get('/api/v1/events'), org.auditor);
    expect(list.status).toBe(200);
    expect(list.body.data.map((event) => event.id)).toContain(created.id);

    const detail = await as(request(app).get(`/api/v1/events/${created.id}`), org.auditor);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(created.id);

    const create = await as(request(app).post('/api/v1/events'), org.auditor)
      .send(creationBody(org));
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});
