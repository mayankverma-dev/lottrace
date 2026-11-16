/**
 * P1-02 regression tests — persistent export pipeline, formats, status,
 * download, notifications, tenant isolation, and audit trail.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p102_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p102_test \
 *   HASH_CHAIN_KEY_ID=p102-test-k1 \
 *   HASH_CHAIN_SECRET=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
 *   npx jest --runInBand src/modules/reports/reports.export-pipeline.test.js
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

process.env.HASH_CHAIN_KEY_ID = process.env.HASH_CHAIN_KEY_ID || 'p102-test-k1';
process.env.HASH_CHAIN_SECRET = process.env.HASH_CHAIN_SECRET || 'd'.repeat(64);

require('express-async-errors');

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

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

jest.mock('../../middleware/tenantScope', () => (req, res, next) => {
  req.organizationId = req.user.organizationId;
  next();
});

jest.mock('../../middleware/rateLimiter', () => ({
  exportLimiter: (req, res, next) => next(),
}));

jest.mock('../../jobs/queues', () => ({
  exportQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  connection: {},
}));

jest.mock('../../lib/storage', () => ({
  uploadFile: jest.fn(),
  generatePresignedDownloadUrl: jest.fn(),
  deleteObject: jest.fn(),
}));

jest.mock('../../utils/auditTrail', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const reportsRoutes = require('./reports.routes');
const errorHandler = require('../../middleware/errorHandler');
const { exportQueue } = require('../../jobs/queues');
const storage = require('../../lib/storage');
const { writeAuditLog } = require('../../utils/auditTrail');
const { processExport } = require('../../jobs/workers/export-processor');
const { csvHeader, EXPORT_LIMITS } = require('../../jobs/workers/export-format');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');
const REPORTS_BASE = '/api/v1/reports';

const mockUploads = [];

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(REPORTS_BASE, reportsRoutes);
  app.use(errorHandler);
  return app;
};

const as = (req, actor) => req
  .set('x-test-role', actor.role)
  .set('x-test-user-id', actor.userId)
  .set('x-test-org-id', actor.orgId);

const flushAudit = () => new Promise((resolve) => setImmediate(resolve));

describeDb('P1-02 persistent export pipeline', () => {
  jest.setTimeout(120000);

  let db;
  let app;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-02 ${label}`,
      slug: `p1-02-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: label,
      email: `${userId}@example.test`,
      role: 'compliance_manager',
      status: 'active',
    });

    return {
      orgId,
      userId,
      actor: { role: 'compliance_manager', userId, orgId },
    };
  };

  const insertEvent = async ({
    orgId,
    userId,
    chainSeq,
    status = 'active',
    eventType = 'creation',
    eventDatetime = '2026-11-16T10:00:00.000Z',
  }) => {
    const id = uuidv4();

    await db('events').insert({
      id,
      organization_id: orgId,
      event_type: eventType,
      event_datetime: eventDatetime,
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({ lot_code: `LOT-${chainSeq}` }),
      counterparty_info: JSON.stringify({ name: 'Supplier A' }),
      notes: `event ${chainSeq}`,
      record_hash: `hash-${id}`,
      prev_hash: 'prev-hash',
      chain_seq: chainSeq,
      hash_key_id: 'p102-test-k1',
      status,
    });

    return id;
  };

  const insertLinkedLot = async ({ orgId, userId, eventId }) => {
    const productId = uuidv4();
    const lotId = uuidv4();

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: 'P1-02 product',
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    await db('lots').insert({
      id: lotId,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `TLC-${lotId.slice(0, 8)}`,
      quantity: 10,
      uom: 'kg',
      created_by: userId,
    });

    await db('event_lot_links').insert({
      organization_id: orgId,
      event_id: eventId,
      lot_id: lotId,
      direction: 'input',
      quantity: 10,
      uom: 'kg',
    });

    return { productId, lotId };
  };

  const postExport = (actor, body) => as(
    request(app).post(`${REPORTS_BASE}/export`),
    actor,
  ).send(body);

  const insertExportRecord = async (actor, overrides = {}) => {
    const [record] = await db('report_exports')
      .insert({
        organization_id: actor.orgId,
        requested_by: actor.userId,
        type: 'events',
        format: 'csv',
        status: 'queued',
        ...overrides,
      })
      .returning('*');

    return record;
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

  beforeEach(() => {
    mockUploads.length = 0;
    exportQueue.add.mockClear();
    storage.uploadFile.mockReset();
    storage.uploadFile.mockImplementation(async (key, filePath, contentType) => {
      const content = await fs.readFile(filePath, 'utf8');
      mockUploads.push({ key, content, contentType });
      return key;
    });
    storage.generatePresignedDownloadUrl.mockReset();
    storage.generatePresignedDownloadUrl.mockResolvedValue('http://localhost:9000/signed-download');
    writeAuditLog.mockClear();
  });

  it('creates a CSV export, records status, notifies, and downloads it', async () => {
    const org = await seedOrganization('csv');
    const activeEventId = await insertEvent({
      orgId: org.orgId,
      userId: org.userId,
      chainSeq: 1,
    });
    const voidEventId = await insertEvent({
      orgId: org.orgId,
      userId: org.userId,
      chainSeq: 2,
      status: 'void',
      eventType: 'shipping',
    });

    const created = await postExport(org.actor, { format: 'csv' });

    expect(created.status).toBe(202);
    expect(created.body.data.status).toBe('queued');
    expect(created.body.data.format).toBe('csv');
    expect(created.body.data).not.toHaveProperty('jobId');
    expect(exportQueue.add).toHaveBeenCalledWith(
      'export-events',
      { exportId: created.body.data.id },
      { jobId: created.body.data.id },
    );

    const exportId = created.body.data.id;
    const result = await processExport(exportId);

    expect(result).toEqual({ exportId, status: 'complete', rowCount: 2 });
    expect(mockUploads).toHaveLength(1);
    expect(mockUploads[0].key).toBe(`exports/org_${org.orgId}/${exportId}.csv`);
    expect(mockUploads[0].contentType).toBe('text/csv');
    expect(mockUploads[0].content.startsWith(csvHeader())).toBe(true);
    expect(mockUploads[0].content).toContain(activeEventId);
    expect(mockUploads[0].content).toContain(voidEventId);
    expect(mockUploads[0].content).toContain('void');

    const status = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}`),
      org.actor,
    );

    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('complete');
    expect(status.body.data.rowCount).toBe(2);
    expect(status.body.data.downloadAvailable).toBe(true);
    expect(JSON.stringify(status.body)).not.toContain('storage_key');

    const notification = await db('notifications')
      .where({ entity_id: exportId, type: 'export_ready' })
      .first();
    expect(notification).toBeDefined();
    expect(notification.user_id).toBe(org.userId);
    expect(notification.link).toBe(`/reports/exports/${exportId}`);

    const download = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}/download`),
      org.actor,
    );

    expect(download.status).toBe(200);
    expect(download.body.data.downloadUrl).toBe('http://localhost:9000/signed-download');
    expect(download.body.data.filename).toBe(`lottrace-events-${exportId}.csv`);
    expect(download.body.data.contentType).toBe('text/csv');
    expect(storage.generatePresignedDownloadUrl).toHaveBeenCalledWith(
      `exports/org_${org.orgId}/${exportId}.csv`,
      expect.objectContaining({
        expiresIn: 300,
        filename: `lottrace-events-${exportId}.csv`,
        contentType: 'text/csv',
      }),
    );

    await flushAudit();
    const auditActions = writeAuditLog.mock.calls.map(([entry]) => entry.action);
    expect(auditActions).toEqual(expect.arrayContaining(['report.export', 'report.download']));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'report.download',
      entityType: 'report',
      entityId: exportId,
    }));
  });

  it('writes a structured JSON export with lot links', async () => {
    const org = await seedOrganization('json');
    const eventId = await insertEvent({
      orgId: org.orgId,
      userId: org.userId,
      chainSeq: 1,
      eventType: 'receiving',
    });
    await insertLinkedLot({
      orgId: org.orgId,
      userId: org.userId,
      eventId,
    });

    const created = await postExport(org.actor, { format: 'json' });
    const exportId = created.body.data.id;
    await processExport(exportId);

    expect(mockUploads[0].key).toBe(`exports/org_${org.orgId}/${exportId}.json`);
    expect(mockUploads[0].contentType).toBe('application/json');

    const rows = JSON.parse(mockUploads[0].content);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(eventId);
    expect(rows[0].event_datetime).toBe('2026-11-16T10:00:00.000Z');
    expect(rows[0].lot_links).toHaveLength(1);
    expect(rows[0].lot_links[0].traceabilityLotCode).toMatch(/^TLC-/);
  });

  it('completes an empty export with a header-only CSV and an empty JSON array', async () => {
    const org = await seedOrganization('empty');

    const csvCreated = await postExport(org.actor, { format: 'csv' });
    await processExport(csvCreated.body.data.id);

    expect(mockUploads[0].content).toBe(csvHeader());
    const csvStatus = await as(
      request(app).get(`${REPORTS_BASE}/exports/${csvCreated.body.data.id}`),
      org.actor,
    );
    expect(csvStatus.body.data.status).toBe('complete');
    expect(csvStatus.body.data.rowCount).toBe(0);

    const jsonCreated = await postExport(org.actor, { format: 'json' });
    await processExport(jsonCreated.body.data.id);

    expect(JSON.parse(mockUploads[1].content)).toEqual([]);
    const jsonStatus = await as(
      request(app).get(`${REPORTS_BASE}/exports/${jsonCreated.body.data.id}`),
      org.actor,
    );
    expect(jsonStatus.body.data.rowCount).toBe(0);

    const notifications = await db('notifications')
      .whereIn('entity_id', [csvCreated.body.data.id, jsonCreated.body.data.id]);
    expect(notifications).toHaveLength(2);
  });

  it('rejects download before completion and after failure', async () => {
    const org = await seedOrganization('not-ready');
    const queued = await insertExportRecord(org.actor, { status: 'queued' });
    const failed = await insertExportRecord(org.actor, {
      status: 'failed',
      error: 'S3 unavailable',
      completed_at: new Date(),
    });

    const queuedDownload = await as(
      request(app).get(`${REPORTS_BASE}/exports/${queued.id}/download`),
      org.actor,
    );
    expect(queuedDownload.status).toBe(409);
    expect(queuedDownload.body.error.code).toBe('EXPORT_NOT_READY');

    const failedDownload = await as(
      request(app).get(`${REPORTS_BASE}/exports/${failed.id}/download`),
      org.actor,
    );
    expect(failedDownload.status).toBe(409);
    expect(failedDownload.body.error.code).toBe('EXPORT_FAILED');
  });

  it('marks a failed upload as failed and notifies the requester', async () => {
    const org = await seedOrganization('failed');
    await insertEvent({
      orgId: org.orgId,
      userId: org.userId,
      chainSeq: 1,
    });

    const created = await postExport(org.actor, { format: 'csv' });
    const exportId = created.body.data.id;
    storage.uploadFile.mockRejectedValueOnce(new Error('S3 unavailable'));

    await expect(processExport(exportId)).rejects.toThrow('S3 unavailable');

    const record = await db('report_exports').where({ id: exportId }).first();
    expect(record.status).toBe('failed');
    expect(record.error).toBe('S3 unavailable');
    expect(record.completed_at).not.toBeNull();

    const notification = await db('notifications')
      .where({ entity_id: exportId, type: 'export_failed' })
      .first();
    expect(notification).toBeDefined();
    expect(notification.user_id).toBe(org.userId);

    const download = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}/download`),
      org.actor,
    );
    expect(download.status).toBe(409);
    expect(download.body.error.code).toBe('EXPORT_FAILED');
  });

  it('marks the export failed and notifies the requester when queueing fails', async () => {
    const org = await seedOrganization('enqueue');
    exportQueue.add.mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await postExport(org.actor, { format: 'csv' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('EXPORT_QUEUE_UNAVAILABLE');

    const record = await db('report_exports')
      .where({ organization_id: org.orgId })
      .first();
    expect(record.status).toBe('failed');
    expect(record.error).toBe('Failed to queue export');
    expect(record.completed_at).not.toBeNull();

    const notification = await db('notifications')
      .where({ entity_id: record.id, type: 'export_failed' })
      .first();
    expect(notification).toBeDefined();
    expect(notification.user_id).toBe(org.userId);
    expect(notification.link).toBe(`/reports/exports/${record.id}`);
  });

  it('fails an export that exceeds the row cap and reports a safe limit error', async () => {
    const org = await seedOrganization('limit');
    for (let chainSeq = 1; chainSeq <= 3; chainSeq += 1) {
      // eslint-disable-next-line no-await-in-loop
      await insertEvent({ orgId: org.orgId, userId: org.userId, chainSeq });
    }

    const created = await postExport(org.actor, { format: 'csv' });
    const exportId = created.body.data.id;

    await expect(processExport(exportId, {
      limits: { maxRows: 2, maxBytes: EXPORT_LIMITS.maxBytes },
    })).rejects.toMatchObject({ code: 'EXPORT_LIMIT_EXCEEDED' });

    const record = await db('report_exports').where({ id: exportId }).first();
    expect(record.status).toBe('failed');
    expect(record.error_code).toBe('EXPORT_LIMIT_EXCEEDED');
    expect(record.error).toBe('Export limit exceeded');
    expect(storage.uploadFile).not.toHaveBeenCalled();

    const notification = await db('notifications')
      .where({ entity_id: exportId, type: 'export_failed' })
      .first();
    expect(notification).toBeDefined();
    expect(notification.user_id).toBe(org.userId);

    const status = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}`),
      org.actor,
    );
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('failed');
    expect(status.body.data.errorCode).toBe('EXPORT_LIMIT_EXCEEDED');
    expect(status.body.data.error).toBe(
      'This export is too large. Narrow the filters and request a smaller export.',
    );

    const download = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}/download`),
      org.actor,
    );
    expect(download.status).toBe(409);
    expect(download.body.error.code).toBe('EXPORT_FAILED');
  });

  it('returns 404 for another organization status and download', async () => {
    const orgA = await seedOrganization('cross-a');
    const orgB = await seedOrganization('cross-b');
    const created = await postExport(orgA.actor, { format: 'csv' });
    const exportId = created.body.data.id;

    const status = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}`),
      orgB.actor,
    );
    expect(status.status).toBe(404);
    expect(status.body.error.code).toBe('NOT_FOUND');

    const download = await as(
      request(app).get(`${REPORTS_BASE}/exports/${exportId}/download`),
      orgB.actor,
    );
    expect(download.status).toBe(404);
    expect(download.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects unsupported formats and malformed export IDs', async () => {
    const org = await seedOrganization('validation');

    const format = await postExport(org.actor, { format: 'pdf' });
    expect(format.status).toBe(422);
    expect(format.body.error.code).toBe('VALIDATION_ERROR');

    const params = await as(
      request(app).get(`${REPORTS_BASE}/exports/not-a-uuid`),
      org.actor,
    );
    expect(params.status).toBe(422);
    expect(params.body.error.code).toBe('VALIDATION_ERROR');
  });
});
