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
    message: 'Export job started',
    data: { jobId: 'job-1' },
  }),
}));

const reportsRoutes = require('./reports.routes');
const errorHandler = require('../../middleware/errorHandler');
const { writeAuditLog } = require('../../utils/auditTrail');

const REPORTS_BASE = '/api/v1/reports';
const ROLES = ['org_admin', 'compliance_manager', 'operator', 'auditor', 'api_key', 'unknown'];

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
    body: { format: 'csv' },
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
      ['unsupported format', { format: 'exe' }],
      ['unknown format', { format: 'json' }],
      ['unknown field', { format: 'csv', scope: 'org' }],
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
        .send({});

      expect(res.status).toBe(202);
    });

    it('returns 403 before validation when the role cannot export', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'operator')
        .send({ format: 'exe' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  });

  describe('export audit trail', () => {
    it('records report.export with the actor, organization, and format', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'compliance_manager')
        .send({ format: 'csv' });

      expect(res.status).toBe(202);
      await flushAudit();

      expect(writeAuditLog).toHaveBeenCalledTimes(1);
      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: '00000000-0000-4000-8000-000000000002',
        actorId: '00000000-0000-4000-8000-000000000001',
        action: 'report.export',
        entityType: 'report',
        metadata: expect.objectContaining({
          body: { format: 'csv' },
        }),
      }));
    });

    it('does not audit a rejected export', async () => {
      const res = await request(app)
        .post(`${REPORTS_BASE}/export`)
        .set('x-test-role', 'operator')
        .send({ format: 'csv' });

      expect(res.status).toBe(403);
      await flushAudit();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });
  });
});
