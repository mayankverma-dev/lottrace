# LotTrace — Architecture Document

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│                                                                   │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │   React Web App       │    │    React Scan PWA             │   │
│  │   (Vite, Port 3001)   │    │    (Vite PWA, Port 3002)     │   │
│  │   Dashboard, Reports  │    │    Camera scan, floor ops     │   │
│  └──────────┬───────────┘    └──────────────┬───────────────┘   │
└─────────────┼──────────────────────────────-┼────────────────────┘
              │  HTTPS / REST                  │ HTTPS / REST
              │  Authorization: Bearer JWT     │
┌─────────────▼──────────────────────────────-▼────────────────────┐
│                         API LAYER                                  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Express REST API (Port 3000)                    │ │
│  │                                                               │ │
│  │  Middleware chain:                                            │ │
│  │  requestId → cors → helmet → rateLimit → parseBody           │ │
│  │  → authenticate → tenantScope → rbac → [handler]             │ │
│  │  → errorHandler                                               │ │
│  │                                                               │ │
│  │  Modules: auth, organizations, users, locations, products,   │ │
│  │  lots, events, trace, imports, reports, audit, api-keys,     │ │
│  │  webhooks, recall, super-admin                               │ │
│  └─────────────┬───────────────────────────┬────────────────────┘ │
│                │                           │                       │
│  ┌─────────────▼──────────┐  ┌────────────▼──────────────────┐  │
│  │   PostgreSQL (5432)     │  │   Redis (6379)                 │  │
│  │                         │  │                                │  │
│  │   Primary data store    │  │   • Rate limiting (per IP,     │  │
│  │   • All app tables      │  │     per API key)               │  │
│  │   • JSONB for KDE       │  │   • JWT refresh token store    │  │
│  │     payloads            │  │   • BullMQ job queues          │  │
│  │   • Recursive CTEs for  │  │   • Response cache (trace)     │  │
│  │     trace engine        │  │   • Session data               │  │
│  │   • RLS policies        │  │                                │  │
│  └─────────────────────────┘  └───────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              BullMQ Workers (same Node process or separate)  │ │
│  │                                                               │ │
│  │   • import-processor  — parse CSV, validate rows, insert     │ │
│  │   • export-generator  — build CSV/PDF, upload to S3, notify  │ │
│  │   • hash-verifier     — walk event chain, verify integrity   │ │
│  │   • email-sender      — compliance gap digests, invites      │ │
│  │   • webhook-dispatcher— fan-out outbound webhook calls       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │   S3-Compatible Object Storage (AWS S3 / Cloudflare R2)      │ │
│  │   • Uploaded files (BOL, COA, photos)                        │ │
│  │   • Generated exports (CSV, PDF)                              │ │
│  │   • Bulk import CSVs (retained for audit)                     │ │
│  │   Access: Signed URLs only, never direct API stream          │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Tenancy Design

### Strategy: Shared Schema, Row-Level Isolation

Every tenant-scoped table has an `organization_id` column. Two enforcement layers:

**Layer 1: Application (Middleware)**
```
authenticate middleware → verifies JWT → sets req.user
tenantScope middleware → sets req.organizationId = req.user.organizationId
```
Every service function receives `organizationId` as a parameter — never reads it from request body.

**Layer 2: PostgreSQL RLS (Defense-in-depth)**
```sql
-- Example RLS policy on lots table
ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lots
  USING (organization_id = current_setting('app.current_org_id')::uuid);
```
The API sets `app.current_org_id` at the start of each DB connection. Even if application code has a bug, RLS prevents cross-tenant data leaks.

### Cross-Tenant Access Response
- **Always return 404** (not 403) when a valid token accesses another org's resource
- Reason: 403 confirms the resource exists — 404 leaks nothing
- Log every cross-tenant attempt to the audit log

---

## 3. Authentication & Session Flow

```
[Login Request]
     │
     ▼
Verify email + password (argon2.verify)
     │
     ▼
Check user status (active/inactive)
     │
     ▼
Generate:
  • Access Token (JWT, 15min, signed with ACCESS_JWT_SECRET)
    payload: { sub: userId, orgId, role, sessionFamily }
  • Refresh Token (opaque UUID, stored hash in DB, 30 days)
     │
     ▼
Set refresh token as httpOnly, Secure, SameSite=Strict cookie
Return access token in response body
     │
     ▼
[API Request with Bearer token]
     │
     ▼
authenticate middleware:
  1. Decode JWT (verify signature + expiry)
  2. Check user.status = 'active' (per-request, catches deactivated mid-session)
  3. Set req.user = { id, organizationId, role, sessionFamily }
     │
     ▼
[Refresh Token Rotation]
  1. Verify refresh token exists in DB + not expired
  2. Mark old refresh token as used
  3. Generate new refresh token (rotation)
  4. If old token already used → theft detected → invalidate entire sessionFamily
```

---

## 4. Trace Engine Design

The trace engine is the technical core of LotTrace.

### Data Model for Tracing
```
lots ─────────────────────────────────────────────────┐
  │                                                    │
  └→ event_lot_links (direction: input/output)        │
         │                                            │
         └→ events (event_type: transformation)       │
                │                                     │
                └→ event_lot_links (output lots) ─────┘
```

A Transformation event links N input lots to M output lots.
`event_lot_links.direction` = `'input'` or `'output'`

### Forward Trace (Where did this lot go?)
```sql
WITH RECURSIVE forward_trace AS (
  -- Base: the starting lot
  SELECT l.id, l.traceability_lot_code, l.product_id, 0 AS hop
  FROM lots l
  WHERE l.id = $1 AND l.organization_id = $2

  UNION ALL

  -- Recursive: find output lots from events where this lot was an input
  SELECT l.id, l.traceability_lot_code, l.product_id, ft.hop + 1
  FROM forward_trace ft
  JOIN event_lot_links ell_in ON ell_in.lot_id = ft.id
    AND ell_in.direction = 'input'
  JOIN events e ON e.id = ell_in.event_id
    AND e.status = 'active'
    AND e.organization_id = $2
  JOIN event_lot_links ell_out ON ell_out.event_id = e.id
    AND ell_out.direction = 'output'
  JOIN lots l ON l.id = ell_out.lot_id
  WHERE ft.hop < 50  -- cycle protection
)
SELECT DISTINCT * FROM forward_trace ORDER BY hop;
```

### Backward Trace (Where did this come from?)
Mirror of forward: swap `input`/`output` directions.

Both directions traverse only events with `status = 'active'`. Amended events (superseded
by a replacement) and void events remain available through `GET /events/:id`, the event
list, and the audit log, but never appear in the live trace graph. Lot rows with
`status = 'void'` are still returned as nodes with their status flag so the path stays
continuous; only event status filters the graph.

### Performance Strategy
- Index: `event_lot_links(lot_id, direction)`, `event_lot_links(event_id)`
- Cache trace results in Redis (TTL 5min, `trace:v2:` key namespace, invalidated on new events for that lot)
- Max depth: 50 hops (cycle protection), never silently truncate — show "truncated at 50 hops" warning

---

## 5. Audit Log & Hash Chain

### Two Separate Concepts
| | `events` table | `audit_log` table |
|--|----------------|-------------------|
| What | Supply chain facts (CTEs) | System actions (who did what) |
| Who sees it | All roles | Org Admin, Compliance Mgr, Auditor |
| Immutable? | Yes (append-only, amendments create new row) | Yes |
| Hash chain? | Yes | No |

### Hash Chain Design (events table)
Each event stores:
- `record_hash`: HMAC-SHA256 of the canonical payload of this event, chained with `prev_hash`
- `prev_hash`: `record_hash` of the previous event in this org's chain (or `'GENESIS'` for first)
- `chain_seq`: monotonic per-org position; the chain is ordered by it, never by `created_at`
- `hash_version`: canonical payload version (currently `3`)
- `hash_key_id`: key ID used for the HMAC, resolved from the `HASH_CHAIN_KEY_ID` /
  `HASH_CHAIN_SECRET` keyring (`HASH_CHAIN_OLD_KEYS` keeps rotated keys verifiable)

**Canonical serialization** — built from the persisted row and its `event_lot_links` rows, so the
write path and the verifier hash identical values (`backend/src/utils/hashChain.js`):
```js
const payload = {
  eventId: event.id,
  organizationId: event.organization_id,
  chainSeq: Number(event.chain_seq),
  eventType: event.event_type,
  locationId: event.location_id ?? null,
  counterpartyInfo: asJson(event.counterparty_info),
  eventDatetime: toIso(event.event_datetime),
  recordedBy: event.recorded_by,
  recordedAt: toIso(event.recorded_at),
  source: event.source,
  kdePayload: asJson(event.kde_payload) ?? {},
  complianceGaps: asJson(event.compliance_gaps),
  notes: event.notes ?? null,
  idempotencyKey: event.idempotency_key ?? null,
  supersedesEventId: event.supersedes_event_id ?? null,
  createdAt: toIso(event.created_at),
  inputs: sortedByLotId(inputLinks),   // quantity stays PostgreSQL numeric(15,4) text
  outputs: sortedByLotId(outputLinks),
};
const hash = hmacSha256(secret, `lottrace:event:v3|${prevHash}|${stableStringify(payload)}`);
```

Writers insert with `record_hash = 'PENDING'` and `hash_key_id = 'PENDING'`, insert the links,
then seal the hash in the same transaction. Mutable lifecycle fields (`status`, `void_reason`) and
later attachment metadata are covered by the append-only `event_evidence` chain rooted at the
event's `record_hash`, not by re-sealing the event. A database trigger rejects updates and deletes
on sealed evidence rows.

Hash verification re-walks the chain nightly, ordered by `chain_seq`. On the first mismatch it
writes `audit_log` with `action = 'hash.verify_failed'`, creates an org-wide
`hash_verification_failed` notification, emits a Sentry event when `SENTRY_DSN` is configured, and
records a `hash.verify_completed` metric row plus a structured pino metric log.

---

## 6. Background Jobs (BullMQ)

### Queues
| Queue | Worker File | Trigger |
|-------|------------|---------|
| `import` | `jobs/import-processor.js` | CSV upload → POST /imports |
| `export` | `jobs/export-generator.js` | GET /reports/export (large) |
| `hash-verify` | `jobs/workers/hash-verifier.js` | Nightly cron |
| `email` | `jobs/email-sender.js` | Compliance gaps, invites, export ready |
| `webhook` | `jobs/webhook-dispatcher.js` | Any event.created, gap.detected |

### Import Job Flow
```
Upload CSV → store in S3 → create imports record (status: pending)
→ enqueue import job → return { importId }
→ Worker: stream parse rows → validate each → commit valid rows
→ Update import record (status: complete, error_report_url)
→ Enqueue email job → notify user
```

---

## 7. File Storage

- All uploads go to S3-compatible storage (not served by API process)
- Access via pre-signed URLs (15-minute TTL for downloads)
- Upload flow: client requests presigned upload URL → uploads directly to S3 → sends key to API → API stores key
- File types: CSV (imports), PDF (exports), images (attachments), documents (BOL, COA)
- Max file size: 50MB per attachment, 100MB for import CSV

---

## 8. Rate Limiting Strategy

| Target | Limit | Window | Store |
|--------|-------|--------|-------|
| Auth endpoints (login, register) | 10 req | 15 min | Redis |
| Password reset | 5 req | 1 hour | Redis |
| Standard API (per user) | 300 req | 1 min | Redis |
| API Key | 1000 req | 1 min | Redis |
| Export endpoints | 10 req | 1 hour | Redis |
| Bulk import | 5 uploads | 1 hour | Redis |

---

## 9. Environment Configuration

```
backend/.env
├── DATABASE_URL          postgresql://user:pass@localhost:5432/lottrace
├── REDIS_URL             redis://localhost:6379
├── ACCESS_JWT_SECRET     (min 64 chars random)
├── REFRESH_JWT_SECRET    (min 64 chars random, different from access)
├── ARGON2_SECRET         (pepper for password hashing)
├── S3_BUCKET             lottrace-uploads
├── S3_REGION             us-east-1
├── S3_ACCESS_KEY_ID      ...
├── S3_SECRET_ACCESS_KEY  ...
├── S3_ENDPOINT           (for R2/Backblaze: custom endpoint)
├── EMAIL_PROVIDER        resend
├── EMAIL_API_KEY         ...
├── EMAIL_FROM            noreply@lottrace.com
├── STRIPE_SECRET_KEY     sk_live_...
├── STRIPE_WEBHOOK_SECRET whsec_...
├── SENTRY_DSN            https://...@sentry.io/...
├── NODE_ENV              development|staging|production
└── PORT                  3000

frontend/.env
├── VITE_API_BASE_URL     http://localhost:3000
└── VITE_SENTRY_DSN       ...

scan-pwa/.env
└── VITE_API_BASE_URL     http://localhost:3000
```

---

## 10. Deployment (Target)

```
Production:
  API:      Railway / Render / Fly.io (Node.js service)
  Frontend: Vercel / Netlify (static)
  Scan PWA: Vercel / Netlify (static, HTTPS required for camera)
  DB:       Supabase / Neon / Railway (managed Postgres)
  Redis:    Upstash (managed Redis)
  Storage:  Cloudflare R2 (S3-compatible, cheaper egress)
  Email:    Resend
  CI/CD:    GitHub Actions → test → build → deploy

Local Dev:
  docker-compose up  (postgres, redis)
  pnpm run dev       (starts all 3 services concurrently)
```