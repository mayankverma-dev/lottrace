/**
 * P1-29 regression test — dashboard route role matrix.
 *
 * No database. Authentication, tenant scope, and the controller are mocked so
 * this suite asserts the route-level RBAC contract only. Per docs/RBAC.md every
 * authenticated organization role, including `operator`, may read dashboard
 * stats and activity.
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
  next();
});

jest.mock('../../middleware/tenantScope', () => (req, res, next) => {
  req.organizationId = req.user.organizationId;
  next();
});

jest.mock('./controller', () => {
  const respond = (req, res) => res.status(200).json({
    success: true,
    message: 'ok',
    data: {},
  });

  return {
    getStats: respond,
    getActivityFeed: respond,
  };
});

const dashboardRoutes = require('./routes');
const errorHandler = require('../../middleware/errorHandler');

const DASHBOARD_BASE = '/api/v1/dashboard';
const ROLES = ['org_admin', 'compliance_manager', 'operator', 'auditor', 'api_key', 'unknown'];

const ROUTES = [
  { name: 'GET /stats', method: 'get', path: '/stats' },
  { name: 'GET /activity', method: 'get', path: '/activity' },
];

const ALLOWED = ['org_admin', 'compliance_manager', 'operator', 'auditor'];

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(DASHBOARD_BASE, dashboardRoutes);
  app.use(errorHandler);
  return app;
};

describe('P1-29 dashboard route role matrix', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  describe.each(ROUTES)('$name', ({ method, path }) => {
    it.each(ALLOWED)('allows %s', async (role) => {
      const res = await request(app)[method](`${DASHBOARD_BASE}${path}`).set('x-test-role', role);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it.each(ROLES.filter((role) => !ALLOWED.includes(role)))('denies %s', async (role) => {
      const res = await request(app)[method](`${DASHBOARD_BASE}${path}`).set('x-test-role', role);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  });

  it('allows super_admin on every dashboard route', async () => {
    for (const route of ROUTES) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)[route.method](`${DASHBOARD_BASE}${route.path}`)
        .set('x-test-role', 'super_admin');

      expect(res.status).toBe(200);
    }
  });

  it('returns 401 when no authenticated role is present', async () => {
    const res = await request(app).get(`${DASHBOARD_BASE}/stats`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});
