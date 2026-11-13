# LotTrace — Backend Architecture & Technical Reference

> **Audience:** New developers onboarding to the project, technical reviewers, and senior architects wanting a full-picture walkthrough.
>
> **Mode:** Read-only analysis. No source files were modified to produce this document.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Current Completion Status](#2-current-completion-status)
3. [Component & Service Breakdown](#3-component--service-breakdown)
4. [Step-by-Step System Workflow](#4-step-by-step-system-workflow)
5. [Real-World Use Case Examples](#5-real-world-use-case-examples)

---

## 1. Project Overview

### What This System Does

**LotTrace** is a multi-tenant SaaS platform built to help food manufacturers, processors, and co-packers comply with the U.S. **FDA Food Safety Modernization Act (FSMA) Section 204** — a regulation that requires businesses to maintain detailed, lot-level supply chain traceability records.

In plain terms: if there is ever a food safety recall or contamination event, regulators need to know **exactly** where a specific batch (lot) of food came from and where it went. Without a system like LotTrace, this investigation can take days or weeks. With LotTrace, it takes seconds.

**Core capabilities:**
- Record supply chain events (creation, receiving, transformation, shipping) against specific food lots
- Instantly trace any lot **forward** (where did it go?) or **backward** (where did it come from?) through the entire supply chain graph
- Detect and flag compliance gaps when required **Key Data Elements (KDEs)** are missing from an event record
- Simulate recall scenarios to measure the blast radius of a potential contamination event
- Bulk-import lot and event data from CSV files for legacy system migration
- Provide a full, tamper-evident audit trail of all system actions

---

### Technical Stack

| Layer | Technology | Version | Why It Was Chosen |
|---|---|---|---|
| **Runtime** | Node.js | LTS | Non-blocking I/O, large ecosystem |
| **API Framework** | Express.js | ^4.18.x | Mature, unopinionated REST framework |
| **Database** | PostgreSQL | 15+ | Relational integrity + JSONB + recursive CTEs for trace engine |
| **Query Builder** | Knex.js | ^3.x | Raw SQL control for recursive CTEs; no TypeScript type-gen dependency |
| **Cache & Queue Broker** | Redis | 7+ | Token blacklisting, trace result caching, BullMQ job broker |
| **Background Jobs** | BullMQ | ^5.x | Redis-native job queue for imports, exports, emails, webhooks |
| **Auth** | JWT (jsonwebtoken) | ^9.x | Stateless short-lived access tokens (30 min) + rolling refresh tokens (7 days) |
| **Password Hashing** | argon2 | ^0.31.x | More resistant to GPU brute-force than bcrypt |
| **Request Validation** | Zod | ^3.x | Schema-first validation with rich error messages |
| **Object Storage** | AWS S3 / Cloudflare R2 | SDK v3 | File uploads, import CSVs, generated export reports |
| **Email** | Resend + Nodemailer | ^3.x / ^6.x | Branded HTML transactional emails |
| **Logging** | Pino + pino-http | ^8.x | Structured JSON logs; very high throughput |
| **Error Tracking** | Sentry | ^7.x | Production error monitoring |
| **Rate Limiting** | express-rate-limit + rate-limit-redis | ^7.x | Distributed rate limiting backed by Redis |
| **Frontend** | React 18 + Vite | ^18.x / ^5.x | Modern SPA with fast HMR |
| **Frontend State** | Zustand (UI) + TanStack Query (server) | ^4.x / ^5.x | Clean separation of UI state and API data |
| **Frontend UI** | shadcn/ui + Tailwind CSS | latest / ^3.x | Accessible component library on Radix primitives |
| **Mobile PWA** | Vite PWA + @zxing/library | ^0.19.x | Browser-based barcode scanning without native app |
| **Package Manager** | pnpm workspaces | latest | Monorepo with shared configs and fast installs |
| **Containerization** | Docker Compose | — | Local postgres + redis in one command |

---

### Architectural Pattern

LotTrace follows a **layered modular monolith** pattern on the backend:

```
+-------------------------------------------------------------+
|                     Client Layer                            |
|        React Web App (:3001)    Scan PWA (:3002)            |
+---------------------------+---------------------------------+
                            |  HTTPS / REST
+---------------------------v---------------------------------+
|                  Express API (:3000)                        |
|  Global Middleware -> Module Routes -> Controller -> Service |
+------+--------------------------------------------+---------+
       | Knex (SQL)                                 | ioredis
+------v--------------+                    +--------v------------------+
|   PostgreSQL         |                   |        Redis              |
|  (primary DB)        |                   |  Cache | RateLimit |      |
|   Port :5432         |                   |  BullMQ job queues        |
+----------------------+                   +--------+------------------+
                                                    | BullMQ Workers
                                           +--------v------------------+
                                           |   Background Workers      |
                                           |  import-processor         |
                                           |  export-generator         |
                                           |  email-sender             |
                                           |  hash-verifier            |
                                           +--------+------------------+
                                                    | AWS SDK
                                           +--------v------------------+
                                           |   AWS S3 / R2 Storage     |
                                           |  Uploads | CSV | PDFs     |
                                           +---------------------------+
```

---

## 2. Current Completion Status

### Phase Summary

| Phase | Name | Status |
|---|---|---|
| **Phase 0** | Project Foundation | ✅ **Complete** |
| **Phase 1** | Trace Core (MVP) | ✅ **Complete** |
| **Phase 2** | Field-Ready | 🔄 **In Progress** (Steps 11–19 done; API keys/webhooks migrations next) |
| **Phase 3** | Scale & Integrate | 🔲 Not Started |
| **Phase 4** | Depth | 🔲 Not Started |

---

### What Is Built and Working Today

#### ✅ Authentication & Identity
- Full **register → email OTP verify → login** flow
- **Invite user** flow: admin invites → branded email sent → user sets password via tokenized link → auto sign-in
- JWT access token (30 min) + rolling refresh token (7 days) with **refresh token rotation** (used tokens are immediately invalidated)
- **Token blacklisting** on logout via Redis
- Forgot password / reset password with SHA-256 hashed reset tokens
- **Session theft detection**: if a used refresh token is replayed, the entire session family is invalidated

#### ✅ Organization & User Management
- Multi-tenant organizations table — each customer is an isolated tenant
- User roles: `org_admin`, `compliance_manager`, `operator`, `auditor`, `super_admin`
- User lifecycle: `invited` → `active` → `deactivated` (never hard-deleted)
- Full user CRUD with audit logging on every mutating action

#### ✅ Core Supply Chain Data (Locations, Products, Lots)
- **Locations CRUD** — physical places where events occur, with GS1 GLN support
- **Products CRUD** — with custom KDE schema builder (define per-product required fields)
- **Lots CRUD** — the central traced unit, with void and optimistic concurrency (`version` field)

#### ✅ Events (Critical Traceability Events — CTEs)

Four event types are fully implemented:

| Event Type | What It Records |
|---|---|
| `creation` | A new lot is produced at a facility |
| `receiving` | A lot arrives at a location from a supplier |
| `transformation` | N input lots → M output lots (e.g., blending, repackaging) |
| `shipping` | A lot leaves a location to a customer/distributor |

- **Hash chain**: every event stores `record_hash` (HMAC-SHA256 of its payload, keyed from env/KMS) and `prev_hash` (pointing to the prior event), forming a tamper-evident ledger. Mutable status/void/attachment facts are signed in the append-only `event_evidence` chain; a database trigger rejects updates and deletes on sealed rows.
- **Compliance gap detection**: on every event save, the system checks if all required KDE fields for the product are present
- **Idempotency key support**: clients can retry event creation without creating duplicates
- **Amend flow**: an event cannot be edited — instead, a new superseding event is created and the old is marked `amended`
- **Void flow**: marks an event inactive without deleting it

#### ✅ Trace Engine
- **Forward trace** (`GET /trace/:lotId/forward`): *"Where did this lot go?"* — recursive CTE follows input→output links through the event graph
- **Backward trace** (`GET /trace/:lotId/backward`): *"Where did this lot come from?"* — recursive CTE follows output→input links
- **Full trace** (`GET /trace/:lotId/full`): parallel forward + backward, deduplicated node/edge result
- **Redis caching**: trace results cached for 5 minutes; automatically invalidated when new events are created for any lot in the graph
- **Cycle protection**: `path` array in recursive CTE prevents infinite loops

#### ✅ Bulk Import
- CSV upload → S3 → BullMQ job → background streaming parse → event creation
- Import status tracked in DB (`pending` → `processing` → `complete` / `failed`)
- Error report generation for rows that fail validation

#### ✅ Recall Simulation
- Runs a full trace against a triggering lot and saves the result as a named simulation
- Compliance managers can replay past simulations and compare blast radii over time

#### ✅ Reports & Compliance
- `GET /reports/compliance-gaps` — list all events with missing required KDE fields
- `POST /reports/export` — queue a CSV/PDF export job; result stored in S3

#### ✅ Audit Log
- Every mutating action (user invites, lot void, event amend, etc.) is written to the `audit_log` table
- Includes: who, what, before/after state, IP address, timestamp
- Queryable via `GET /api/v1/audit` with pagination and filtering

#### ✅ Dashboard & Notifications
- `GET /dashboard/stats` — counts of active lots, events, locations, compliance gaps
- `GET /dashboard/recent-activity` — recent event feed
- In-app notification bell for compliance gaps, import completion, export ready

#### 🔄 In Progress (Phase 3, Step 1)
- Database migrations for `api_keys`, `webhooks`, and `subscriptions` — schema defined, migrations being applied

#### 🔲 Not Yet Built
- API key authentication for third-party integrations
- Outbound webhook dispatching (schema complete, dispatcher worker scaffolded)
- Stripe billing integration
- Offline scanning support in the PWA
- Super-admin impersonation and organization management

---

## 3. Component & Service Breakdown

### 3.1 Entry Points

#### `backend/src/server.js`
The process entry point. It binds the HTTP server to the configured port, initializes BullMQ background workers, and starts the Redis connection. Think of this as the "power switch" for the entire backend process.

#### `backend/src/app.js`
The Express application factory. It registers all **global middleware** in order (see §3.2) and **mounts all module routers** under their `/api/v1/` prefixes. The order of middleware registration here is critical — for example, CORS must come before authentication.

---

### 3.2 Global Middleware Pipeline

Every single HTTP request passes through this chain before reaching any route handler. The order is fixed and intentional:

```
Incoming Request
     |
     v
1. requestId.js      -> Attaches a unique UUID to req.id for log correlation
     |
     v
2. cors              -> Checks Origin header; allows frontend + scan-pwa origins only
     |
     v
3. helmet            -> Sets 15+ HTTP security headers (X-Frame-Options, CSP, HSTS, etc.)
     |
     v
4. compression       -> Gzip-compresses responses > 1KB
     |
     v
5. pino-http         -> Logs method, URL, status code, response time as structured JSON
     |
     v
6. express.json()    -> Parses JSON request bodies (max 10MB)
     |
     v
7. cookieParser      -> Makes req.cookies available (needed for refresh token cookie)
     |
     v
[Route-specific middleware -- applied per-router, not globally]
     |
     v
8. authenticate.js   -> Verifies JWT Bearer token; populates req.user
     |
     v
9. tenantScope.js    -> Copies req.user.organizationId -> req.organizationId;
                        Sets PostgreSQL session variable app.current_org_id for RLS
     |
     v
10. rbac.js          -> Checks req.user.role against allowed roles array for this route
     |
     v
11. validate.js      -> Runs Zod schema against req.body / req.query / req.params
     |
     v
[Controller -> Service -> Database]
     |
     v
12. errorHandler.js  -> Catches any thrown error; maps it to the standard error envelope
```

**Key design decisions in the middleware chain:**
- `authenticate.js` checks Redis for token blacklist entries before verifying the JWT signature — this enables instant logout even before the short-lived token expires.
- `tenantScope.js` sets a PostgreSQL session variable (`SET LOCAL app.current_org_id`). This activates **Row-Level Security (RLS)** policies on the database side — a second layer of tenant isolation beyond the `WHERE organization_id = ?` clauses in every query.
- `validate.js` always runs **before** the controller. If validation fails, the controller is never called and the error response uses the standard `VALIDATION_ERROR` envelope.

---

### 3.3 Feature Modules (`backend/src/modules/`)

Each module is a self-contained directory with exactly four files:

| File | Responsibility |
|---|---|
| `*.routes.js` | Declares Express routes; assembles the middleware chain per endpoint |
| `*.controller.js` | Reads from `req`, calls service, calls `apiResponse.*` helper. **Thin.** No business logic. |
| `*.service.js` | All business logic, DB queries, external calls. No `req`/`res` awareness. |
| `*.validation.js` | Zod schemas for this module's request bodies and params |

---

#### Module: `auth`
**Responsibility:** User identity — registration, login, token lifecycle, password resets, invite acceptance.

Key behaviors:
- **Registration** is a two-step process: `POST /auth/register` stores a pending payload (with OTP hash) in Redis for 30 minutes; `POST /auth/verify-email` checks the OTP, then atomically creates the `organization` + `user` rows in PostgreSQL and issues tokens.
- **Login** verifies the Argon2id password hash, updates `last_login_at`, creates a `refresh_tokens` row, and returns both an access token (in JSON body) and a refresh token.
- **Token refresh** implements the **refresh token rotation** pattern: the old token is marked `is_used = true`, a new token is issued. If a used token is ever replayed (token theft), the entire `session_family` group of tokens is deleted, forcing a full re-login.
- **Accept Invite** (`POST /auth/accept-invite`): validates an invite token hash against the `users` table, sets the password, flips status to `active`, and issues tokens — all in a single database transaction.

---

#### Module: `organizations`
**Responsibility:** Tenant configuration — reading and updating the organization's own settings (name, timezone, default UOM), and providing the onboarding checklist state.

---

#### Module: `users`
**Responsibility:** User management within a tenant — listing users with pagination, inviting new users (generates a token, sends a branded HTML email), deactivating/reactivating accounts, and resending invites.

- `POST /users/invite`: generates a 32-byte random invite token, stores its SHA-256 hash on the user row with an expiry, queues a branded email via BullMQ.
- All mutating routes (`invite`, `PATCH`, `deactivate`, `reactivate`, `resend-invite`) have the `auditLogger('user')` middleware applied, which writes a row to `audit_log` after every successful response.

---

#### Module: `locations`
**Responsibility:** CRUD for physical locations (farms, plants, warehouses, distributors, retailers). Supports soft-deactivation rather than deletion. Locations have an `is_external` flag to distinguish owned facilities from partner/counterparty sites.

---

#### Module: `products`
**Responsibility:** CRUD for products being traced. The most distinctive feature is the **custom KDE schema builder**: each product can define an array of custom required fields (e.g., `{ name: "supplier_po_number", type: "string", required: true }`). This schema is stored as JSONB and used at event-creation time to detect compliance gaps.

---

#### Module: `lots`
**Responsibility:** CRUD for traceability lots — the central entity being tracked. A lot has a `traceability_lot_code` (TLC), is scoped to a product, and has a `status` (`active` | `recalled` | `void`).

- **Void**: `POST /lots/:id/void` requires a `void_reason`. Voided lots cannot have new events recorded against them.
- **Optimistic concurrency**: the `version` integer field is incremented on update. If a client sends a stale version, a `409 CONFLICT` is returned.
- The `traceability_lot_code` is **unique per organization + product** combination (enforced by a partial unique index excluding voided lots).

---

#### Module: `events`
**Responsibility:** The core of the platform. Records supply chain events (CTEs) and maintains the hash chain.

The `createEvent` service function is the most complex in the codebase. It:

1. **Claims idempotency** — if an `Idempotency-Key` header was provided, the middleware atomically claims an organization-scoped PostgreSQL row using a request fingerprint. Completed 2xx responses replay for 24 hours; mismatched bodies return 409.
2. **Acquires a PostgreSQL advisory lock** (`pg_advisory_xact_lock`) scoped to the organization. This prevents two concurrent event-creation requests from generating hash chain conflicts.
3. **Fetches `prev_hash`** — looks up the most recent event for the organization. The first-ever event gets `'GENESIS'` as its `prev_hash`.
4. **Runs compliance gap detection** — joins the lot's product to its `custom_kde_schema` and checks which required fields are absent from `kde_payload`.
5. **Computes `record_hash`** using `hashChain.js` — a keyed HMAC-SHA256 of the persisted event payload chained with `prev_hash`, after the row and links are inserted (see `sealEventHash`).
6. **Inserts the event row** and all `event_lot_links` (input/output lot associations) in a single database transaction.
7. **Invalidates Redis trace cache** for all affected lots.
8. **Queues compliance gap alert emails** to all `compliance_manager` users in the organization if gaps were detected.

---

#### Module: `trace`
**Responsibility:** The supply chain graph traversal engine. Uses PostgreSQL **recursive CTEs** to walk the `events` → `event_lot_links` → `lots` relationship graph.

- **Forward trace**: starts from a given lot, finds events where it was an `input`, then finds the `output` lots of those events, and recurses from those output lots.
- **Backward trace**: mirror — starts from a lot, finds events where it was an `output`, then finds the `input` lots.
- **Full trace**: runs forward and backward in parallel (`Promise.all`), then deduplicates nodes and edges.
- **Cycle protection**: each recursive step checks `NOT (l.id = ANY(ft.path))` to prevent infinite loops in circular supply chains.
- **Result shape**: `{ nodes: [...lots], edges: [...event connections], hops: N, truncated: bool, startLot: {...} }`
- **Redis cache**: results are stored at key `trace:{orgId}:{lotId}:{direction}` with a 5-minute TTL. Cache is invalidated synchronously after every successful event creation.

---

#### Module: `imports`
**Responsibility:** Bulk CSV data ingestion. Accepts a multipart file upload, stores the raw CSV in S3, creates an `imports` DB record, and enqueues a BullMQ job. The HTTP response returns immediately — the actual processing happens asynchronously.

---

#### Module: `reports`
**Responsibility:** Two report types:
1. `GET /reports/compliance-gaps` — queries the `events` table for all rows where `has_compliance_gaps = true` (a PostgreSQL generated column), with filtering and pagination.
2. `POST /reports/export` — enqueues an `export-generator` BullMQ job that runs the query in the background and streams results to a CSV/PDF file in S3. The client polls `GET /reports/exports/:exportId` for completion.

---

#### Module: `recall`
**Responsibility:** Recall simulation. Stores named simulation runs that capture a full-trace result snapshot at a point in time, along with summary statistics (number of lots affected, locations affected). Compliance managers can run simulations without affecting live data.

---

#### Module: `audit`
**Responsibility:** Read-only access to the `audit_log` table. Supports filtering by actor, entity type, entity ID, and date range, with cursor-based pagination for large result sets.

---

#### Module: `dashboard`
**Responsibility:** Aggregated statistics for the dashboard home screen — total active lots, events this month, locations, compliance gap count, and a recent activity feed of the latest events.

---

#### Module: `notifications`
**Responsibility:** In-app notification delivery. The `GET /notifications` endpoint returns unread notifications for the authenticated user (or org-wide notifications). Notifications are created by backend services (e.g., after an import completes) and consumed by the frontend's notification bell UI.

---

### 3.4 Background Workers (`backend/src/jobs/workers/`)

Workers are BullMQ consumers that run asynchronously, decoupled from the HTTP request lifecycle.

| Worker | Queue | What It Does |
|---|---|---|
| `import-processor.js` | `import-queue` | Fetches a CSV from S3, streams it through `csv-parse`, validates each row, creates events, writes error report to S3, updates import status |
| `export-generator.js` | `export-queue` | Runs a DB query, serializes results to CSV or PDF (via PDFKit), uploads the file to S3, updates the export record |
| `hash-verifier.js` | `hash-verify-queue` | Re-computes the hash chain for an organization's events to detect any tampering or integrity violations |
| `email-sender.js` | `email-queue` | Sends transactional emails (welcome, OTP verification, invite, compliance gap alert, password reset) via Resend/Nodemailer |

---

### 3.5 Utility Layer (`backend/src/utils/`)

| File | Purpose |
|---|---|
| `apiResponse.js` | All HTTP responses go through these helpers — never `res.json()` directly. Enforces the universal `{ success, message, data }` envelope. |
| `AppError.js` | Custom operational error class with `statusCode`, `code`, `details`, and `isOperational = true`. Thrown by services; caught by `errorHandler.js`. |
| `hashChain.js` | HMAC-SHA256 event and evidence hash computation for the ledger. Sorts object keys before stringifying so results are deterministic, resolves the env/KMS keyring, and seals hashes from persisted rows. |
| `auditTrail.js` | Helper function `writeAuditLog({...})` called directly by services or by the `auditLogger` middleware. Inserts a row into `audit_log`. |
| `pagination.js` | Helper that computes `total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPrevPage` from a count query result. |
| `logger.js` | Singleton Pino logger instance, configured for structured JSON output in production and pretty-print in development. |
| `email.js` | Wrapper for sending branded HTML emails via the configured email provider. |

---

### 3.6 Database Layer (`backend/src/db/`)

- **`knex.js`**: The singleton Knex instance, connecting to PostgreSQL via `DATABASE_URL`. All modules `require` this single instance — no multiple pool creation.
- **`migrations/`**: 18 ordered migration files, one per table. Migrations run in numeric order and are tracked in Knex's internal `knex_migrations` table.
- **`seeds/`**: Development seeds that create default roles, a `super_admin` user, and sample data.

**Row-Level Security (RLS):** Every tenant-scoped table has RLS enabled. A policy on each table reads `current_setting('app.current_org_id', true)::uuid` — the value set by `tenantScope.js` at the start of each request. This means that even if a query accidentally omits `WHERE organization_id = ?`, the database itself will silently filter to only the current tenant's rows.

---

## 4. Step-by-Step System Workflow

This section traces the complete lifecycle of a standard authenticated API request — specifically: **recording a new shipping event**.

```
POST /api/v1/events
Authorization: Bearer <access_token>
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "eventType": "shipping",
  "locationId": "loc-uuid-123",
  "eventDatetime": "2026-07-11T08:00:00.000Z",
  "inputs": [{ "lotId": "lot-uuid-abc", "quantity": 500, "uom": "kg" }],
  "kdePayload": {
    "destination_name": "Whole Foods DC - Atlanta",
    "bill_of_lading": "BOL-2026-0711"
  },
  "source": "manual"
}
```

---

### Step 1 — Global Middleware Chain (app.js)

1. **`requestId`** generates a UUID and attaches it to `req.id`. This ID will appear in every log line for this request, making distributed tracing trivial.
2. **`cors`** inspects the `Origin` header. If it matches `http://localhost:3001` (or the configured `FRONTEND_URL`), the `Access-Control-Allow-Origin` response header is set.
3. **`helmet`** injects security headers (`X-Frame-Options: DENY`, `Strict-Transport-Security`, etc.).
4. **`compression`** will gzip the response body if the client sends `Accept-Encoding: gzip`.
5. **`pino-http`** begins timing the request and registers a listener to log the result when the response is sent.
6. **`express.json()`** parses the raw request body into `req.body`.
7. **`cookieParser`** parses `Cookie` headers (not used by this endpoint, but registered globally).

---

### Step 2 — Route Matching (app.js → events.routes.js)

Express matches the path `/api/v1/events` to the events module router (mounted via `app.use('/api/v1/events', require('./modules/events/events.routes'))`). Inside the router, the `POST /` route is matched.

---

### Step 3 — Route-Level Middleware (events.routes.js)

The events router applies three route-level middlewares before the controller:

**3a. `authenticate.js`**
- Extracts the Bearer token from the `Authorization` header.
- Queries Redis with key `bl_<token>`. If the key exists, the token was blacklisted on logout → `401 Unauthorized`.
- Calls `jwt.verify(token, ACCESS_JWT_SECRET)` to validate the signature and check expiry.
- Decodes the payload `{ sub: userId, orgId: organizationId, role }` and sets `req.user`.

**3b. `tenantScope.js`**
- Copies `req.user.organizationId` → `req.organizationId`.
- Runs `SET LOCAL app.current_org_id = '<uuid>'` in the current DB session, activating PostgreSQL RLS policies.

**3c. `rbac.js`** (e.g., `rbac(['org_admin', 'compliance_manager', 'operator'])`)
- Checks that `req.user.role` is in the allowed roles array.
- If not → `403 Forbidden`.

---

### Step 4 — Idempotency Middleware (idempotency.js)

If the request includes an `Idempotency-Key` header, the middleware:
- Validates the key length and computes SHA-256 over method, route, and canonical validated body.
- Claims `(organization_id, key)` atomically in `idempotency_keys`.
- If a live completed row matches → returns its stored 2xx response.
- If the fingerprint differs → returns `409 IDEMPOTENCY_KEY_REUSED`.
- If another request owns an unfinished claim → returns `409 IDEMPOTENCY_KEY_IN_PROGRESS`.
- Stores only 2xx responses for 24 hours. Non-2xx responses release the claim.
- An hourly maintenance worker deletes expired rows.

---

### Step 5 — Validation Middleware (validate.js)

The `validate({ body: createEventSchema })` middleware runs the Zod schema:
- If the body is valid → stores the parsed, type-coerced data in `req.validatedBody`. `next()` is called.
- If invalid → immediately returns `422 Unprocessable Entity` with a `VALIDATION_ERROR` envelope listing each failing field. The controller is never reached.

---

### Step 6 — Controller (events.controller.js)

The controller function is deliberately thin:

```javascript
const createEvent = async (req, res) => {
  const event = await eventsService.createEvent(
    req.validatedBody,
    req.organizationId,   // from tenantScope -- never from req.body
    req.user.id,
  );
  return apiResponse.created(res, event, 'Event created successfully');
};
```

Its only job is to extract parameters from the request context and call the service. It does not contain any business logic.

---

### Step 7 — Service (events.service.js) — The Core Logic

This is where all the work happens, inside a single **PostgreSQL transaction**:

**7a. Idempotency**
Handled before controller execution by `idempotency.js`; event service does not receive or persist HTTP idempotency keys.

**7b. Advisory lock**
```sql
SELECT pg_advisory_xact_lock(crc32(organizationId))
```
This serializes all concurrent event-creation requests for the same organization at the database level, preventing two requests from reading the same `prev_hash` simultaneously.

**7c. Fetch prev_hash**
```sql
SELECT record_hash FROM events
WHERE organization_id = ?
ORDER BY chain_seq DESC
LIMIT 1
```
If no events exist yet → `prevHash = 'GENESIS'` and `chain_seq = 1`.
Order by `chain_seq`, never `created_at`: `created_at` is the transaction start time
and can be tied or inverted under concurrency.

**7d. Compliance gap detection**
- Joins the lots in `inputs` and `outputs` to their products.
- Checks each product's `custom_kde_schema` array against `kde_payload`.
- Returns an array of `{ field, message }` objects for any required field that is absent or empty.

**7e. Compute record_hash**
`hashChain.js` produces:
```
HMAC-SHA256( secret, "lottrace:event:v3" + "|" + prevHash + "|" + stableJSON(eventPayload) )
```
The "stable JSON" sorts all object keys alphabetically before stringifying — this ensures the hash is deterministic regardless of key insertion order. The secret is never stored in the database; `hash_key_id` names the key.

**7f. Insert event row**
The event is inserted with all computed fields: `record_hash`, `prev_hash`, `compliance_gaps` (JSONB), and `has_compliance_gaps` (auto-computed by PostgreSQL generated column).

**7g. Insert event_lot_links rows**
Each entry in `inputs` and `outputs` becomes a row in `event_lot_links` with `direction = 'input'` or `'output'`.

**7h. Invalidate Redis trace cache**
For every lot ID in the event, deletes three Redis keys: `trace:{orgId}:{lotId}:forward`, `trace:{orgId}:{lotId}:backward`, and `trace:{orgId}:{lotId}:full`.

**7i. Queue compliance gap alert emails**
If gaps were detected, fetches all `compliance_manager` users in the organization and adds one `compliance_gap_alert` job per user to the BullMQ `email-queue`.

**7j. Transaction commit**
All inserts are committed atomically. If any step fails, the transaction rolls back — no partial data is ever written.

---

### Step 8 — Audit Logging (auditLogger middleware)

The `auditLogger('event')` middleware intercepted `res.json` before the controller ran. After the response body is sent to the client, it asynchronously calls `writeAuditLog(...)` with:
- `action: 'event.post'`
- `entityType: 'event'`
- `entityId: <new event UUID>`
- `actorId: req.user.id`
- `ipAddress: req.ip`

This write is non-blocking — the client receives their response first.

---

### Step 9 — Response

```json
HTTP/1.1 201 Created

{
  "success": true,
  "message": "Event created successfully",
  "data": {
    "id": "evt-uuid-xyz",
    "organization_id": "org-uuid",
    "event_type": "shipping",
    "event_datetime": "2026-07-11T08:00:00.000Z",
    "recorded_by": "user-uuid",
    "recorded_at": "2026-07-11T02:45:30.123Z",
    "record_hash": "a3f9b2c1...",
    "prev_hash": "d4e7f1a2...",
    "has_compliance_gaps": false,
    "status": "active"
  }
}
```

---

### Step 10 — Background Processing

In parallel with the HTTP response, two things happen asynchronously:

1. The `audit_log` row is written to PostgreSQL via `setImmediate`.
2. If compliance gaps were found, the `email-sender` BullMQ worker picks up the job, renders the HTML email template, and delivers it via Resend to all compliance managers.

---

## 5. Real-World Use Case Examples

### Use Case 1 — Recording a Receiving Event for an Incoming Shipment

**Scenario:** A food processor receives 2,000 kg of strawberries from a farm supplier. A compliance manager logs into LotTrace to record the receiving event.

**Step 1 — Login**
```
POST /api/v1/auth/login

{
  "email": "compliance@acmefood.com",
  "password": "SecureP@ss123"
}
```
Response includes `accessToken` and a `refreshToken` httpOnly cookie.

**Step 2 — Create a Lot for the Incoming Strawberries**
```
POST /api/v1/lots
Authorization: Bearer <accessToken>

{
  "productId": "prod-uuid-strawberry",
  "traceabilityLotCode": "FARM-A-2026-07-11-001",
  "quantity": 2000,
  "uom": "kg"
}
```
The API returns a new lot UUID (e.g., `lot-uuid-strawberry-incoming`).

**Step 3 — Record the Receiving CTE Event**
```
POST /api/v1/events
Authorization: Bearer <accessToken>
Idempotency-Key: <client-generated-uuid>

{
  "eventType": "receiving",
  "locationId": "loc-uuid-processing-plant",
  "eventDatetime": "2026-07-11T06:00:00.000Z",
  "outputs": [
    { "lotId": "lot-uuid-strawberry-incoming", "quantity": 2000, "uom": "kg" }
  ],
  "kdePayload": {
    "supplier_name": "Sunrise Farms LLC",
    "origin_country": "US",
    "supplier_lot_code": "SUNRISE-0711-A"
  },
  "source": "manual"
}
```

**What Happens Internally:**
- JWT is verified; tenant scope is set; role `compliance_manager` passes the RBAC check.
- Compliance gap detection finds `supplier_name` is present (a required KDE for this product) — no gaps.
- Hash chain records `record_hash = SHA256(prevHash | stableJSON(payload))`.
- The event is committed and the lot is now officially "in" the processing plant's inventory.

**Step 4 — Audit trail written.** The audit log records `event.post` with the actor's ID, IP address, and the new event's ID.

---

### Use Case 2 — Running a Forward Trace After an FDA Recall Alert

**Scenario:** The FDA notifies Acme Food that strawberries from lot code `FARM-A-2026-07-11-001` may be contaminated. The manager needs to know which finished goods lots were produced using those strawberries.

**Step 1 — Look Up the Lot**
```
GET /api/v1/lots?search=FARM-A-2026-07-11-001
Authorization: Bearer <accessToken>
```
Returns the lot UUID.

**Step 2 — Forward Trace (Where Did This Lot Go?)**
```
GET /api/v1/trace/lot-uuid-strawberry-incoming/forward
Authorization: Bearer <accessToken>
```

**Internal Processing:**
- `traceService.forwardTrace()` first checks Redis for `trace:orgId:lot-uuid:forward` — cache miss (first time).
- Executes the recursive CTE to walk the event graph forward from the starting lot.
- The query finds: 3 finished jam lots were produced from the strawberry lot (via a `transformation` event), and 2 of those 3 were shipped to distributors (via `shipping` events).
- Result cached in Redis for 5 minutes.

**Response:**
```json
{
  "success": true,
  "data": {
    "nodes": [
      { "id": "lot-uuid-strawberry-incoming", "traceabilityLotCode": "FARM-A-2026-07-11-001", "hop": 0, "isStart": true },
      { "id": "lot-uuid-jam-001", "traceabilityLotCode": "JAM-2026-07-11-001", "hop": 1 },
      { "id": "lot-uuid-jam-002", "traceabilityLotCode": "JAM-2026-07-11-002", "hop": 1 },
      { "id": "lot-uuid-jam-dist-001", "traceabilityLotCode": "JAM-DIST-001", "hop": 2 }
    ],
    "edges": [
      { "from": "lot-uuid-strawberry-incoming", "to": "lot-uuid-jam-001", "eventType": "transformation" },
      { "from": "lot-uuid-jam-001", "to": "lot-uuid-jam-dist-001", "eventType": "shipping" }
    ],
    "hops": 2,
    "truncated": false
  }
}
```

**Step 3 — Save a Recall Simulation**
```
POST /api/v1/recall/simulations
Authorization: Bearer <accessToken>

{
  "name": "FDA Recall Drill - July 11 Strawberry Batch",
  "triggeringLotId": "lot-uuid-strawberry-incoming"
}
```
The simulation runs the full trace and saves the result JSON to S3, along with a result summary (`{ lotsAffected: 4, locationsAffected: 3 }`). The compliance manager can retrieve or share this report with the FDA.

---

### Use Case 3 — A New Warehouse Operator Is Invited and Onboarded

**Scenario:** An org admin invites a new warehouse operator to LotTrace. The operator must set their own password via an emailed link.

**Step 1 — Admin Invites the User**
```
POST /api/v1/users/invite
Authorization: Bearer <adminAccessToken>

{
  "email": "john.doe@acmefood.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "operator"
}
```

**Internal Processing:**
- `usersService.inviteUser()` generates a 32-byte cryptographically random invite token.
- Stores `SHA-256(token)` as `invite_token_hash` on the user row, with a 72-hour expiry.
- Queues a branded HTML email to `john.doe@acmefood.com` via BullMQ → `email-sender` worker.
- `auditLogger('user')` writes `user.invite` to `audit_log`.

**Step 2 — John Receives the Invite Email**
The email contains a deep-link:
```
https://app.lottrace.com/accept-invite?token=<raw-token>&email=john.doe@acmefood.com
```

**Step 3 — John Sets His Password**
```
POST /api/v1/auth/accept-invite

{
  "email": "john.doe@acmefood.com",
  "token": "<raw-token-from-email>",
  "password": "SecureP@ss123"
}
```

**Internal Processing:**
- `authService.acceptInvite()` SHA-256-hashes the token and queries for a matching user with `status = 'invited'`.
- Checks the token hasn't expired (`invite_expires_at > NOW()`).
- Inside a transaction: hashes the new password with Argon2id, updates `status = 'active'`, clears invite token fields, creates a new `refresh_tokens` row.
- Returns `accessToken` + `refreshToken` — John is immediately signed in.

**Step 4 — John Lands on the Dashboard**
The frontend's `AcceptInvitePage` receives the tokens, stores them via Zustand, and redirects to `/dashboard`. John is now a fully active `operator` within Acme Food's LotTrace tenant.

---

*Document generated: 2026-07-11 | Analysis scope: full read-only review of `backend/src/`, `docs/`, and `PROGRESS.md`*
