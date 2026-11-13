/**
 * P1-28 regression tests — event mutations replay safely with one
 * organization-scoped idempotency key.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

require('express-async-errors');

jest.mock('../../modules/trace/trace.service', () => ({
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));
jest.mock('../../lib/storage', () => ({
  generatePresignedUploadUrl: jest.fn().mockResolvedValue('https://storage.test/upload'),
}));
jest.mock('../../utils/auditTrail', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const path = require('path');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../../db/knex');
const apiResponse = require('../../utils/apiResponse');
const validate = require('../../middleware/validate');
const idempotency = require('../../middleware/idempotency');
const auditLogger = require('../../middleware/auditLogger');
const eventsService = require('./events.service');
const { generatePresignedUploadUrl } = require('../../lib/storage');
const { writeAuditLog } = require('../../utils/auditTrail');
const {
  amendEventSchema,
  voidEventSchema,
  attachmentUploadSchema,
  addAttachmentSchema,
} = require('./events.validation');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-28 mutation idempotency', () => {
  jest.setTimeout(120000);

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();
    const lotId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-28 ${label}`,
      slug: `p1-28-${label}-${orgId.slice(0, 8)}`,
    });
    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Tester',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });
    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P1-28 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });
    await db('lots').insert({
      id: lotId,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P1-28-${label}-LOT`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    });

    return { orgId, userId, productId, lotId };
  };

  const createEvent = async (org) => eventsService.createEvent({
    eventType: 'creation',
    eventDatetime: '2026-11-13T10:00:00.000Z',
    source: 'manual',
    kdePayload: {},
    outputs: [{ lotId: org.lotId, quantity: 1, uom: 'kg' }],
    inputs: [],
  }, org.orgId, org.userId);

  const buildApp = (org) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.organizationId = org.orgId;
      req.user = { id: org.userId, organizationId: org.orgId, role: 'org_admin' };
      next();
    });

    app.post('/:eventId/void', validate(voidEventSchema), idempotency, auditLogger('event'), async (req, res) => {
      const event = await eventsService.voidEvent(
        req.params.eventId,
        req.validatedBody.voidReason,
        req.organizationId,
        req.user.id,
      );
      return apiResponse.success(res, event, 'Event voided successfully');
    });

    app.post('/:eventId/amend', validate(amendEventSchema), idempotency, auditLogger('event'), async (req, res) => {
      const event = await eventsService.amendEvent(
        req.params.eventId,
        req.validatedBody,
        req.organizationId,
        req.user.id,
      );
      return apiResponse.created(res, event, 'Event amended successfully');
    });

    app.post('/:eventId/attachments/presigned-url', validate(attachmentUploadSchema), idempotency, async (req, res) => {
      const data = await eventsService.generateAttachmentUploadUrl(
        req.params.eventId,
        req.organizationId,
        req.validatedBody.filename,
        req.validatedBody.contentType,
      );
      return apiResponse.success(res, data, 'Presigned URL generated');
    });

    app.post('/:eventId/attachments', validate(addAttachmentSchema), idempotency, async (req, res) => {
      const attachment = await eventsService.addAttachment(
        req.params.eventId,
        req.validatedBody,
        req.organizationId,
        req.user.id,
      );
      return apiResponse.created(res, attachment, 'Attachment added successfully');
    });

    // The production app provides this global handler in app.js.
    app.use((err, req, res, _next) => {
      if (err.isOperational) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
          error: { code: err.code },
        });
      }
      throw err;
    });
    return app;
  };

  const waitForAudit = () => new Promise((resolve) => setImmediate(resolve));

  beforeAll(async () => {
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replays void and writes one status transition and audit row', async () => {
    const org = await seedOrganization('void');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();

    const first = await request(app)
      .post(`/${event.id}/void`)
      .set('Idempotency-Key', key)
      .send({ voidReason: 'Correction' });
    const second = await request(app)
      .post(`/${event.id}/void`)
      .set('Idempotency-Key', key)
      .send({ voidReason: 'Correction' });
    await waitForAudit();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await db('events').where({ id: event.id, status: 'void' })).toHaveLength(1);
    expect(await db('event_evidence').where({ event_id: event.id })).toHaveLength(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it('rejects a void key reused with a different reason', async () => {
    const org = await seedOrganization('void-mismatch');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();

    const first = await request(app)
      .post(`/${event.id}/void`)
      .set('Idempotency-Key', key)
      .send({ voidReason: 'First reason' });
    const second = await request(app)
      .post(`/${event.id}/void`)
      .set('Idempotency-Key', key)
      .send({ voidReason: 'Different reason' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('replays amend without creating a second replacement', async () => {
    const org = await seedOrganization('amend');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const body = {
      eventType: 'creation',
      eventDatetime: '2026-11-13T11:00:00.000Z',
      source: 'manual',
      kdePayload: {},
      inputs: [],
      outputs: [{ lotId: org.lotId, quantity: 2, uom: 'kg' }],
      amendReason: 'Corrected quantity',
    };

    const first = await request(app).post(`/${event.id}/amend`).set('Idempotency-Key', key).send(body);
    const second = await request(app).post(`/${event.id}/amend`).set('Idempotency-Key', key).send(body);
    await waitForAudit();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await db('events').where({ organization_id: org.orgId })).toHaveLength(2);
    expect(await db('event_evidence').where({ event_id: event.id })).toHaveLength(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed amend', async () => {
    const org = await seedOrganization('amend-failure');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const invalidBody = {
      eventType: 'creation',
      eventDatetime: '2026-11-13T11:00:00.000Z',
      source: 'manual',
      kdePayload: {},
      inputs: [],
      outputs: [{ lotId: uuidv4(), quantity: 2, uom: 'kg' }],
      amendReason: 'Corrected quantity',
    };
    const validBody = { ...invalidBody, outputs: [{ lotId: org.lotId, quantity: 2, uom: 'kg' }] };

    const failed = await request(app).post(`/${event.id}/amend`).set('Idempotency-Key', key).send(invalidBody);
    const retried = await request(app).post(`/${event.id}/amend`).set('Idempotency-Key', key).send(validBody);

    expect(failed.status).toBe(404);
    expect(retried.status).toBe(201);
    expect(await db('events').where({ organization_id: org.orgId })).toHaveLength(2);
  });

  it('rejects an amend key reused with changed event facts', async () => {
    const org = await seedOrganization('amend-mismatch');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const body = {
      eventType: 'creation',
      eventDatetime: '2026-11-13T11:00:00.000Z',
      source: 'manual',
      kdePayload: {},
      inputs: [],
      outputs: [{ lotId: org.lotId, quantity: 2, uom: 'kg' }],
      amendReason: 'Corrected quantity',
    };

    const first = await request(app).post(`/${event.id}/amend`).set('Idempotency-Key', key).send(body);
    const second = await request(app).post(`/${event.id}/amend`).set('Idempotency-Key', key).send({
      ...body,
      amendReason: 'Different correction',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await db('events').where({ organization_id: org.orgId })).toHaveLength(2);
  });

  it('replays presigned URL generation once', async () => {
    const org = await seedOrganization('presigned');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const body = { filename: 'photo.jpg', contentType: 'image/jpeg' };

    const first = await request(app).post(`/${event.id}/attachments/presigned-url`).set('Idempotency-Key', key).send(body);
    const second = await request(app).post(`/${event.id}/attachments/presigned-url`).set('Idempotency-Key', key).send(body);

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(generatePresignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it('replays attachment registration without a duplicate row', async () => {
    const org = await seedOrganization('attachment');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const body = {
      key: `attachments/${org.orgId}/${event.id}/photo.jpg`,
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 123,
    };

    const first = await request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send(body);
    const second = await request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send(body);

    expect(first.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await db('attachments').where({ parent_type: 'event', parent_id: event.id })).toHaveLength(1);
    expect(await db('event_evidence').where({ event_id: event.id })).toHaveLength(1);
  });

  it('rejects attachment key reuse with changed metadata', async () => {
    const org = await seedOrganization('attachment-mismatch');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const body = {
      key: `attachments/${org.orgId}/${event.id}/photo.jpg`,
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    };

    const first = await request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send(body);
    const second = await request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send({
      ...body,
      filename: 'different.jpg',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await db('attachments').where({ parent_type: 'event', parent_id: event.id })).toHaveLength(1);
  });

  it('creates one attachment under concurrent registration', async () => {
    const org = await seedOrganization('attachment-concurrent');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();
    const body = {
      key: `attachments/${org.orgId}/${event.id}/photo.jpg`,
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    };

    const [first, second] = await Promise.all([
      request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send(body),
      request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send(body),
    ]);

    expect([first.status, second.status].every((status) => [201, 409].includes(status))).toBe(true);
    expect([first.status, second.status]).toContain(201);
    expect(await db('attachments').where({ parent_type: 'event', parent_id: event.id })).toHaveLength(1);
  });

  it('does not cache invalid attachment bodies', async () => {
    const org = await seedOrganization('attachment-validation');
    const event = await createEvent(org);
    const app = buildApp(org);
    const key = uuidv4();

    const invalid = await request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send({ filename: '' });
    const valid = await request(app).post(`/${event.id}/attachments`).set('Idempotency-Key', key).send({
      key: `attachments/${org.orgId}/${event.id}/photo.jpg`,
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(invalid.status).toBe(422);
    expect(valid.status).toBe(201);
    expect(await db('attachments').where({ parent_type: 'event', parent_id: event.id })).toHaveLength(1);
  });

  it('allows the same mutation key in two organizations', async () => {
    const orgA = await seedOrganization('tenant-a');
    const orgB = await seedOrganization('tenant-b');
    const eventA = await createEvent(orgA);
    const eventB = await createEvent(orgB);
    const key = uuidv4();
    const body = { voidReason: 'Tenant-specific correction' };

    const [first, second] = await Promise.all([
      request(buildApp(orgA)).post(`/${eventA.id}/void`).set('Idempotency-Key', key).send(body),
      request(buildApp(orgB)).post(`/${eventB.id}/void`).set('Idempotency-Key', key).send(body),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await db('events').where({ id: eventA.id, status: 'void' })).toHaveLength(1);
    expect(await db('events').where({ id: eventB.id, status: 'void' })).toHaveLength(1);
  });
});
