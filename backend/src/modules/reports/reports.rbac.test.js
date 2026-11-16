/**
 * P1-03 regression tests — report route RBAC, validation, and audit.
 *
 * No database and no Redis. Authentication, the export rate limiter, and the
 * controller are mocked; the real RBAC, Zod validation, and audit logger run.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/authenticate', () => (req, res, next) => {
  const role = req.get('x-test-role');
  if (!role) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: { code: 'AUTH_REQUIRED' },
    });
  }

  req.user = {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
    role,
  };
  req.organizationId = req.user.organizationId;
  next();
});

jest.mock('../../middleware/rateLimiter', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  exportLimiter: (req, res, next) => next(),
}));

jest.mock('../../utils/auditTrail', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./reports.controller', () => ({
  getComplianceGaps: (req, res) => res.status(200).json({
    success: true,
    message: 'ok',
    data: [],
    pagination: {},
  }),
  requestExport: (req, res) => res.status(202).json({
    success: true,
    message: 'Export queued',
    data: { id: '11111111-1111-4111-8111-111111111111', status: 'queued' },
  }),
  getExport: (req, res) => res.status(200).json({
    success: true,
    message: 'Export retrieved',
    data: { id: req.params.exportId, status: 'complete' },
  }),
  downloadExport: (req, res) => res.status(200).json({
    success: true,
    message: 'Download URL generated',
    data: { downloadUrl: 'http://localhost:9000/signed' },
  }),
}));

const reportsRoutes = require('./reports.routes');
const errorHandler = require('../../middleware/errorHandler');
const { writeAuditLog } = require('../../utils/auditTrail');

const REPORTS_BASE = '/api/v1/reports';
const ROLES = ['org_admin', 'compliance_manager', 'operator', 'auditor', 'api_key', 'unknown'];
const EXPORT_ID = '11111111-1111-4111-8111-111111111111';

const ROUTES = [
  {
    name: 'GET /compliance-gaps',
    method: 'get',
    path: '/compliance-gaps',
    allowed: ['org_admin', 'compliance_manager', 'operator', 'auditor'],
    successStatus: 200,
  },
  {
    name: 'POST /export',
    method: 'post',
    path: '/export',
    allowed: ['org_admin', 'compliance_manager'],
    successStatus: 202,
    body: { type: 'events', format: 'csv' },
  },
  {
    name: 'GET /exports/:exportId',
    method: 'get',
    path: `/exports/${EXPORT_ID}`,
    allowed: ['org_admin', 'compliance_manager'],
    successStatus: 200,
  },
  {
    name: 'GET /exports/:exportId/download',
    method: 'get',
    path: `/exports/${EXPORT_ID}/download`,
    allowed: ['org_admin', 'compliance_manager'],
    successStatus: 200,
  },
];

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(REPORTS_BASE, reportsRoutes);
  app.use(errorHandler);
  return app;
};

const flushAudit = () => new Promise((resolve) => setImmediate(resolve));

describe('P1-03 report route RBAC, validation, and audit', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    writeAuditLog.mockClear();
  });

  describe.each(ROUTES)('$name', ({ method, path, allowed, successStatus, body }) => {
    it.each(allowed)('allows %s', async (role) => {
      const req = request(app)[method](`${REPORTS_BASE}${path}`).set('x-test-role', role);
      const res = await (body ? req.send(body) : req);

      expect(res.status).toBe(successStatus);
      expect(res.body.success).toBe(true);
    });

    it.each(ROLES.filter((role) => !allowed.includes(role)))('denies %s', async (role) => {
      const req = request(app)[method](`${REPORTS_BASE}${path}`).set('x-test-role', role);
      const res = await (body ? req.send(body) : req);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  });

  it('allows super_admin on every report route', async () => {
    for (const route of ROUTES) {
      const req = request(app)[route.method](`${REPORTS_BASE}${route.path}`)
        .set('x-test-role', 'super_admin');
      // eslint-disable-next-line no-await-in-loop
      const res = await (route.body ? req.send(route.body) : req);

      expect(res.status).toBe(route.successStatus);
    }
  });

  it('returns 401 without an authenticated role', async () => {
    const res = await request(app).get(`${REPORTS_BASE}/compliance-gaps`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  describe('compliance-gap query validation', () => {
    it.each([
      ['limit above max', '?limit=101'],
      ['zero limit', '?limit=0'],
      ['zero page', '?page=0'],
      ['non-numeric page', '?page=abc'],
    ])('rejects %s', async (_name, query) => {
      const res = await request(app)
        .get(`${REPORTS_BASE}/compliance-gaps${query}`)
        .set('x-test-role', 'org_admin');

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts the maximum limit', async () => {
      const res = await request(app)
        .get(`${REPORTS_BASE}/compliance-gaps?limit=100`)
        .set('x-test-role', 'org_admin');

      expect(res.status).toBe(200);
    });
  });

  describe('export body validation', () => {
    it.each([
      ['unsupported format', { type: 'events', format: 'exe' }],
      ['unknown format', { type: 'events', format: 'pdf' }],
      ['unknown field', { type: 'events', format: 'csv', scope: 'org' }],
      ['missing type', { format: 'csv' }],
      ['unknown type', { type: 'lots', format: 'csv' }],
      ['filters on events', { type: 'events', format: 'csv', filters: { action: 'lot.void' } }],
      ['unknown audit filter', { type: 'audit', format: 'csv', filters: { scope: 'org' } }],
      ['invalid entity id', { type: 'audit', filters: { entityId: 'not-a-uuid' } }],
      ['invalid actor id', { type: 'audit', filters: { actorId: 'not-a-uuid' } }],
      ['empty action filter', { type: 'audit', filters: { action: '' } }],
    ])('rejects %s', async (_name, body) => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'org_admin')
        .send(body);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('defaults a missing format to csv', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'compliance_manager')
        .send({ type: 'events' });

      expect(res.status).toBe(202);
    });

    it('accepts json export format', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'compliance_manager')
        .send({ type: 'events', format: 'json' });

      expect(res.status).toBe(202);
    });

    it('accepts an audit export with validated filters', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'compliance_manager')
        .send({
          type: 'audit',
          format: 'csv',
          filters: {
            action: 'lot.void',
            entityType: 'lot',
            entityId: '22222222-2222-4222-8222-222222222222',
            actorId: '33333333-3333-4333-8333-333333333333',
          },
        });

      expect(res.status).toBe(202);
    });

    it('returns 403 before validation when the role cannot export', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'operator')
        .send({ type: 'events', format: 'exe' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  });

  describe('export audit trail', () => {
    it('records report.export with the actor, organization, and format', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'compliance_manager')
        .send({ type: 'events', format: 'csv' });

      expect(res.status).toBe(202);
      await flushAudit();

      expect(writeAuditLog).toHaveBeenCalledTimes(1);
      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: '00000000-0000-4000-8000-000000000002',
        actorId: '00000000-0000-4000-8000-000000000001',
        action: 'report.export',
        entityType: 'report',
        entityId: EXPORT_ID,
        metadata: expect.objectContaining({
          body: { type: 'events', format: 'csv' },
        }),
      }));
    });

    it('records report.download with the export ID', async () => {
      const res = await request(app)
        .get(`${REPORTS_BASE}/exports/${EXPORT_ID}/download`)
        .set('x-test-role', 'compliance_manager');

      expect(res.status).toBe(200);
      await flushAudit();

      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: '00000000-0000-4000-8000-000000000002',
        actorId: '00000000-0000-4000-8000-000000000001',
        action: 'report.download',
        entityType: 'report',
        entityId: EXPORT_ID,
      }));
    });

    it('does not audit a rejected export', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'operator')
        .send({ type: 'events', format: 'csv' });

      expect(res.status).toBe(403);
      await flushAudit();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });
  });
});
