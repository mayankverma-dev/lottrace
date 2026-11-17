/**
 * P0-12 regression test — event route role matrix.
 *
 * No database. Authentication, validation, idempotency, audit logging, and the
 * controller are mocked so this suite asserts the route-level RBAC contract
 * only. `GET /events` and `GET /events/:eventId` must include `operator`.
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

jest.mock('../../middleware/validate', () => () => (req, res, next) => next());
jest.mock('../../middleware/idempotency', () => (req, res, next) => next());
jest.mock('../../middleware/auditLogger', () => () => (req, res, next) => next());

jest.mock('./events.controller', () => {
  const respond = (statusCode) => (req, res) => res.status(statusCode).json({
    success: true,
    message: 'ok',
    data: {},
  });

  return {
    createEvent: respond(201),
    getEvents: respond(200),
    getEvent: respond(200),
    voidEvent: respond(200),
    amendEvent: respond(201),
    generateAttachmentUploadUrl: respond(200),
    addAttachment: respond(201),
    listAttachments: respond(200),
    downloadAttachment: respond(200),
    deleteAttachment: respond(200),
  };
});

const eventsRoutes = require('./events.routes');
const errorHandler = require('../../middleware/errorHandler');

const EVENT_ID = '00000000-0000-4000-8000-000000000010';
const EVENTS_BASE = '/api/v1/events';
const eventUrl = (path) => `${EVENTS_BASE}${path === '/' ? '' : path}`;

const ROLES = ['org_admin', 'compliance_manager', 'operator', 'auditor', 'api_key', 'unknown'];

const ROUTES = [
  {
    name: 'GET /',
    method: 'get',
    path: '/',
    allowed: ['org_admin', 'compliance_manager', 'operator', 'auditor'],
    successStatus: 200,
  },
  {
    name: 'GET /:eventId',
    method: 'get',
    path: `/${EVENT_ID}`,
    allowed: ['org_admin', 'compliance_manager', 'operator', 'auditor'],
    successStatus: 200,
  },
  {
    name: 'GET /:eventId/attachments',
    method: 'get',
    path: `/${EVENT_ID}/attachments`,
    allowed: ['org_admin', 'compliance_manager', 'operator', 'auditor'],
    successStatus: 200,
  },
  {
    name: 'POST /',
    method: 'post',
    path: '/',
    allowed: ['org_admin', 'compliance_manager', 'operator'],
    successStatus: 201,
  },
  {
    name: 'POST /:eventId/void',
    method: 'post',
    path: `/${EVENT_ID}/void`,
    allowed: ['org_admin', 'compliance_manager'],
    successStatus: 200,
  },
  {
    name: 'POST /:eventId/amend',
    method: 'post',
    path: `/${EVENT_ID}/amend`,
    allowed: ['org_admin', 'compliance_manager'],
    successStatus: 201,
  },
  {
    name: 'POST /:eventId/attachments/presigned-url',
    method: 'post',
    path: `/${EVENT_ID}/attachments/presigned-url`,
    allowed: ['org_admin', 'compliance_manager', 'operator'],
    successStatus: 200,
  },
  {
    name: 'POST /:eventId/attachments',
    method: 'post',
    path: `/${EVENT_ID}/attachments`,
    allowed: ['org_admin', 'compliance_manager', 'operator'],
    successStatus: 201,
  },
];

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/events', eventsRoutes);
  app.use(errorHandler);
  return app;
};

describe('P0-12 event route role matrix', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  describe.each(ROUTES)('$name', ({ method, path, allowed, successStatus }) => {
    it.each(allowed)('allows %s', async (role) => {
      const res = await request(app)[method](eventUrl(path)).set('x-test-role', role);

      expect(res.status).toBe(successStatus);
      expect(res.body.success).toBe(true);
    });

    it.each(ROLES.filter((role) => !allowed.includes(role)))('denies %s', async (role) => {
      const res = await request(app)[method](eventUrl(path)).set('x-test-role', role);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  });

  it('allows super_admin on every event route', async () => {
    for (const route of ROUTES) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)[route.method](eventUrl(route.path)).set('x-test-role', 'super_admin');

      expect(res.status).toBe(route.successStatus);
    }
  });

  it('returns 401 when no authenticated role is present', async () => {
    const res = await request(app).get('/api/v1/events');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});
