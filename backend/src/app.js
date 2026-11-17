require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');
const cookieParser = require('cookie-parser');

const logger = require('./utils/logger');
const env = require('./config/env');
const apiResponse = require('./utils/apiResponse');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const authenticate = require('./middleware/authenticate');
const tenantScope = require('./middleware/tenantScope');
const rbac = require('./middleware/rbac');
const validate = require('./middleware/validate');
const { attachmentIdParamsSchema } = require('./modules/events/events.validation');
const eventsController = require('./modules/events/events.controller');

const app = express();

// Resolve the real client IP through the exact configured proxy chain.
// Never trust every hop: that permits X-Forwarded-For spoofing.
app.set('trust proxy', env.TRUST_PROXY);

// ─── Global Middleware ─────────────────────────────────────
// Order matters: requestId → cors → helmet → compression → logging → body parsing → rate limiting

// 1. Request ID (tracing)
app.use(requestId);

// 2. CORS
app.use(
  cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:3001', process.env.SCAN_PWA_URL || 'http://localhost:3002'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'ngrok-skip-browser-warning'],
  }),
);

// 3. Security headers
app.use(helmet());

// 4. Gzip compression
app.use(compression());

// 5. Rate limiting (global)
app.use('/api', apiLimiter);

// 5. HTTP request logging
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
    },
  }),
);

// 6. Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Health Check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  return apiResponse.success(res, { status: 'healthy', uptime: process.uptime() }, 'Service is healthy');
});

// ─── API Routes ────────────────────────────────────────────
// Module routes will be mounted here as they are built:
app.use('/api/v1/auth', require('./modules/auth/auth.routes'));
app.use('/api/v1/organizations', require('./modules/organizations/organizations.routes'));
app.use('/api/v1/users', require('./modules/users/users.routes'));
app.use('/api/v1/locations', require('./modules/locations/locations.routes'));
app.use('/api/v1/products', require('./modules/products/products.routes'));
app.use('/api/v1/lots', require('./modules/lots/lots.routes'));
app.use('/api/v1/events', require('./modules/events/events.routes'));
app.get(
  '/api/v1/attachments/:attachmentId/download',
  authenticate,
  tenantScope,
  rbac(['org_admin', 'compliance_manager', 'operator', 'auditor']),
  validate({ params: attachmentIdParamsSchema }),
  eventsController.downloadAttachment,
);
app.delete(
  '/api/v1/attachments/:attachmentId',
  authenticate,
  tenantScope,
  rbac(['org_admin', 'compliance_manager']),
  validate({ params: attachmentIdParamsSchema }),
  eventsController.deleteAttachment,
);
app.use('/api/v1/trace', require('./modules/trace/trace.routes'));
app.use('/api/v1/audit', require('./modules/audit/audit.routes'));
app.use('/api/v1/reports', require('./modules/reports/reports.routes'));
app.use('/api/v1/imports', require('./modules/imports/routes'));
app.use('/api/v1/recall', require('./modules/recall/routes'));
app.use('/api/v1/dashboard', require('./modules/dashboard/routes'));
app.use('/api/v1/notifications', require('./modules/notifications/notifications.routes'));

// ─── 404 Catch-All ─────────────────────────────────────────
app.use((_req, res) => {
  return apiResponse.notFound(res, 'Route not found');
});

// ─── Error Handler (must be last) ──────────────────────────
app.use(errorHandler);

module.exports = app;
