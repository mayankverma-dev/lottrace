# LotTrace — API Standards

> **This document is LAW. Every endpoint must follow it without exception.**
> When adding any endpoint, read this file first.

---

## Base URL
```
/api/v1/[resource]
```
All routes versioned. Future breaking changes go to `/api/v2/...`

> **Pre-production policy:** Only `/api/v1` exists. Breaking changes are made in place — update the backend and every client in the same change. Do not add `/api/v2`, deprecation shims, or compatibility aliases until the project has real production consumers.

---

## Authentication

### User (JWT)
```
Authorization: Bearer <access_token>
```
- Access token: 15-minute expiry JWT
- Refresh token: 30-day, stored as httpOnly cookie (`refreshToken`)
- Token refresh: `POST /api/v1/auth/refresh` — sends cookie, gets new access token

### API Key (Integrations)
```
Authorization: ApiKey <api_key>
```
- API keys have scopes: `read`, `write`, `read:lots`, `write:events`, etc.
- Rate limited separately from user tokens

---

## Universal Response Envelope

**EVERY response — success or error — uses this exact shape.**

### Success Response
```json
{
  "success": true,
  "message": "Lots fetched successfully",
  "data": { ... }
}
```

### Success Response — Paginated List
```json
{
  "success": true,
  "message": "Lots fetched successfully",
  "data": [ ... ],
  "pagination": {
    "total": 247,
    "page": 1,
    "limit": 20,
    "totalPages": 13,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      { "field": "traceabilityLotCode", "message": "Lot code is required" },
      { "field": "quantity", "message": "Must be a positive number" }
    ]
  }
}
```

### Error Response — General (non-validation)
```json
{
  "success": false,
  "message": "Lot not found",
  "error": {
    "code": "NOT_FOUND"
  }
}
```

---

## HTTP Status Codes

| Scenario | Code |
|----------|------|
| GET success with data | 200 |
| POST success (created) | 201 |
| DELETE success (no body) | 204 |
| Validation error | 422 |
| Unauthorized (missing/invalid token) | 401 |
| Forbidden (valid token, wrong role) | 403 |
| Resource not found OR cross-tenant access | 404 |
| Conflict (duplicate, version mismatch) | 409 |
| Rate limited | 429 |
| Server error | 500 |

> **Cross-tenant access must return 404, not 403.** Do not confirm resource existence.

---

## Error Codes

Use these exact string constants everywhere:

```
AUTH_REQUIRED           — No token provided
AUTH_INVALID_TOKEN      — JWT invalid/malformed
AUTH_TOKEN_EXPIRED      — JWT expired (client should refresh)
AUTH_FORBIDDEN          — Valid token, insufficient role
AUTH_INVALID_REFRESH    — Refresh token invalid/expired
AUTH_SESSION_REVOKED    — Session family invalidated (theft detected)

VALIDATION_ERROR        — Zod schema violation (always 422)

NOT_FOUND               — Resource not found (or cross-tenant, always 404)
DUPLICATE_ENTRY         — Unique constraint violated
CONFLICT                — Optimistic lock / version conflict
IDEMPOTENCY_KEY_REUSED  — Key reused with a different request
IDEMPOTENCY_KEY_IN_PROGRESS — Matching request is still processing

LOT_VOIDED              — Operation not allowed on voided lot
LOT_RECALLED            — Operation not allowed on recalled lot
EVENT_IMMUTABLE         — Cannot edit a committed event (must supersede)

IMPORT_IN_PROGRESS      — Import job already running for this file
IMPORT_INVALID_FORMAT   — CSV format/encoding error

RATE_LIMITED            — Too many requests
PLAN_LIMIT_EXCEEDED     — Usage exceeds subscription plan limits

INTERNAL_ERROR          — Unexpected server error (never expose details in prod)
```

---

## Resource Naming

### URL Pattern Rules
- **Plural nouns**: `/lots`, `/events`, `/locations` (never `/lot`, `/event`)
- **kebab-case**: `/api-keys`, `/recall-simulations` (never `/apiKeys`)
- **Max 2 nesting levels**: `/lots/:lotId/events` (not deeper)
- **Actions as POST with verb**: `/lots/:lotId/void`, `/events/:eventId/amend`
- **Never use verbs in REST nouns**: `/lots` not `/getLots`

### Resource Endpoints Pattern
```
GET    /api/v1/[resource]           — list (paginated)
POST   /api/v1/[resource]           — create
GET    /api/v1/[resource]/:id       — get one
PATCH  /api/v1/[resource]/:id       — update (partial)
DELETE /api/v1/[resource]/:id       — delete/deactivate

POST   /api/v1/[resource]/:id/void  — action: void
POST   /api/v1/[resource]/:id/amend — action: amend
```

---

## Pagination

All list endpoints that could grow unbounded support pagination.

### Query Parameters
```
?page=1&limit=20     — offset-based (default for most lists)
?cursor=<value>      — cursor-based (required for audit log, large event lists)
?sort=createdAt      — sort field
?order=desc          — asc | desc (default: desc)
```

### Defaults
- Default page: 1
- Default limit: 20
- Max limit: 100 (reject with 422 if exceeded)

### Cursor Pagination (audit log, events)
```json
{
  "success": true,
  "message": "Events fetched",
  "data": [ ... ],
  "pagination": {
    "nextCursor": "eyJpZCI6IjEyMyIsImNyZWF0ZWRBdCI6IjIwMjQifQ==",
    "prevCursor": null,
    "hasMore": true,
    "limit": 50
  }
}
```

---

## Request Conventions

### IDs
- All entity IDs are UUIDs (v4)
- IDs in URL params: `:lotId`, `:eventId`, `:locationId`
- IDs in body: `lotId`, `eventId` (camelCase)

### Dates
- All dates sent/received in **ISO 8601** format: `"2024-01-15T14:30:00.000Z"`
- `event_datetime`: when the CTE event physically occurred (client's local time, converted to UTC)
- `recorded_at`: server timestamp, never client-supplied
- Display conversion to local time is a frontend concern

### Filtering (List Endpoints)
```
?status=active
?productId=uuid
?locationId=uuid
?dateFrom=2024-01-01T00:00:00.000Z
?dateTo=2024-01-31T23:59:59.999Z
?search=lot-code-prefix
```

### Idempotency (Event Mutations)
Event mutation endpoints accept an optional idempotency key:
```
Idempotency-Key: <client-generated UUID>
```
The following endpoints support idempotency:

```text
POST /api/v1/events
POST /api/v1/events/:eventId/void
POST /api/v1/events/:eventId/amend
POST /api/v1/events/:eventId/attachments/presigned-url
POST /api/v1/events/:eventId/attachments
```

If same key sent twice within 24h with same request body, return original result (not duplicate).
Store completed idempotency records in PostgreSQL with 24h TTL. Only 2xx responses are replayable.
Expired keys execute as new requests. Same key with a different request body returns `409` with
`IDEMPOTENCY_KEY_REUSED`. A duplicate request still in flight returns `409` with
`IDEMPOTENCY_KEY_IN_PROGRESS`.
Keys are 1–255 characters. The key is scoped to the authenticated organization.

---

## Response Helpers (Backend Utility)

All controllers must use these helpers — never `res.json()` directly:

```javascript
// backend/src/utils/apiResponse.js

const apiResponse = {
  success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, message, data });
  },

  created(res, data, message = 'Created successfully') {
    return res.status(201).json({ success: true, message, data });
  },

  paginated(res, data, pagination, message = 'Fetched successfully') {
    return res.status(200).json({ success: true, message, data, pagination });
  },

  noContent(res) {
    return res.status(204).send();
  },

  error(res, message, code, statusCode = 500, details = null) {
    const body = { success: false, message, error: { code } };
    if (details) body.error.details = details;
    return res.status(statusCode).json(body);
  },

  notFound(res, message = 'Resource not found') {
    return res.status(404).json({ success: false, message, error: { code: 'NOT_FOUND' } });
  },

  validationError(res, details) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      error: { code: 'VALIDATION_ERROR', details },
    });
  },

  unauthorized(res, code = 'AUTH_REQUIRED', message = 'Authentication required') {
    return res.status(401).json({ success: false, message, error: { code } });
  },

  forbidden(res, message = 'Insufficient permissions') {
    return res.status(403).json({ success: false, message, error: { code: 'AUTH_FORBIDDEN' } });
  },
};

module.exports = apiResponse;
```

---

## Error Handler Middleware

All errors bubble to the global error handler. **Never write try/catch in controllers.**
Use `express-async-errors` package which patches Express to handle async errors.

```javascript
// backend/src/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  // Log the error
  req.log.error({ err }, 'Request error');

  // Knex constraint errors
  if (err.code === '23505') { // unique_violation
    return res.status(409).json({ success: false, message: 'Resource already exists',
      error: { code: 'DUPLICATE_ENTRY' } });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token',
      error: { code: 'AUTH_INVALID_TOKEN' } });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired',
      error: { code: 'AUTH_TOKEN_EXPIRED' } });
  }

  // Operational errors (thrown by app code intentionally)
  if (err.isOperational) {
    return res.status(err.statusCode).json({ success: false, message: err.message,
      error: { code: err.code, ...(err.details && { details: err.details }) } });
  }

  // Unknown errors — don't leak internals in production
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  return res.status(500).json({ success: false, message, error: { code: 'INTERNAL_ERROR' } });
};
```

---

## Module Structure (Each Backend Module)

```
backend/src/modules/lots/
├── lots.routes.js        — Express Router, middleware chain per route
├── lots.controller.js    — req/res handling only, calls service
├── lots.service.js       — all business logic, DB queries
└── lots.validation.js    — Zod schemas for this module
```

### Controller Pattern — Always Follow This
```javascript
// lots.controller.js
const apiResponse = require('../../utils/apiResponse');
const lotsService = require('./lots.service');
const { createLotSchema } = require('./lots.validation');

// Controllers are thin: validate → call service → respond
const createLot = async (req, res) => {
  const data = createLotSchema.parse(req.body); // throws ZodError if invalid (caught by errorHandler)
  const lot = await lotsService.createLot(data, req.organizationId, req.user.id);
  return apiResponse.created(res, lot, 'Lot created successfully');
};

module.exports = { createLot };
```

### Service Pattern — Always Follow This
```javascript
// lots.service.js
const db = require('../../db/knex');

const createLot = async (data, organizationId, userId) => {
  // organizationId always comes from the JWT (via req.organizationId)
  // NEVER accept organizationId from data/body
  const [lot] = await db('lots')
    .insert({
      id: uuid(),
      organization_id: organizationId,
      ...data,
      created_by: userId,
    })
    .returning('*');

  return lot;
};
```

---

## API Routes Reference

```
Auth:
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId

Organizations:
GET    /api/v1/organizations/me
PATCH  /api/v1/organizations/me
GET    /api/v1/organizations/me/onboarding

Users:
GET    /api/v1/users
POST   /api/v1/users/invite
GET    /api/v1/users/:userId
PATCH  /api/v1/users/:userId
POST   /api/v1/users/:userId/deactivate
POST   /api/v1/users/:userId/reactivate

Locations:
GET    /api/v1/locations
POST   /api/v1/locations
GET    /api/v1/locations/:locationId
PATCH  /api/v1/locations/:locationId
POST   /api/v1/locations/:locationId/deactivate

Products:
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:productId
PATCH  /api/v1/products/:productId

Lots:
GET    /api/v1/lots
POST   /api/v1/lots
GET    /api/v1/lots/:lotId
PATCH  /api/v1/lots/:lotId
GET    /api/v1/lots/:lotId/events
POST   /api/v1/lots/:lotId/void

Events:
GET    /api/v1/events
POST   /api/v1/events
GET    /api/v1/events/:eventId
POST   /api/v1/events/:eventId/amend
POST   /api/v1/events/:eventId/void
POST   /api/v1/events/:eventId/attachments

Trace:
GET    /api/v1/trace/:lotId/forward
GET    /api/v1/trace/:lotId/backward
GET    /api/v1/trace/:lotId/full

Imports:
GET    /api/v1/imports
POST   /api/v1/imports
GET    /api/v1/imports/:importId
GET    /api/v1/imports/:importId/errors
GET    /api/v1/imports/template/:cteType

Reports:
GET    /api/v1/reports/compliance-gaps
POST   /api/v1/reports/export
GET    /api/v1/reports/exports/:exportId

Recall:
GET    /api/v1/recall/simulations
POST   /api/v1/recall/simulations
GET    /api/v1/recall/simulations/:simulationId

Audit:
GET    /api/v1/audit

API Keys:
GET    /api/v1/api-keys
POST   /api/v1/api-keys
DELETE /api/v1/api-keys/:keyId

Webhooks:
GET    /api/v1/webhooks
POST   /api/v1/webhooks
PATCH  /api/v1/webhooks/:webhookId
DELETE /api/v1/webhooks/:webhookId

Dashboard:
GET    /api/v1/dashboard/stats
GET    /api/v1/dashboard/recent-activity

Super Admin (platform team only):
GET    /api/v1/admin/organizations
GET    /api/v1/admin/organizations/:orgId
POST   /api/v1/admin/organizations/:orgId/suspend
POST   /api/v1/admin/impersonate/:userId
```
