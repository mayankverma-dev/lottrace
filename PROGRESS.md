# LotTrace — Build Progress

## Current Status
**Phase:** Phase 2 — Field-Ready
**Last Updated:** 2026-11-17
**Last Session:** 2026-11-17 — P1-36, P1-37, P1-38, P2-31, P2-32, and P2-33 fixed. Pending invitations now return `409 EMAIL_INVITED`; deactivation immediately denies existing access tokens; invitation resend writes are organization-scoped; database email uniqueness uses `lower(email)`; invite emails run after tenant commit; and local refresh-token encryption is configured. Focused DB, middleware, migration, and refresh tests pass.

---

## Phase Overview
| Phase | Name | Weeks | Status |
|-------|------|-------|--------|
| 0 | Foundation | 1–3 | ✅ Complete |
| 1 | Trace Core (MVP) | 4–9 | ✅ Complete |
| 2 | Field-Ready | 10–14 | ✅ Complete |
| 3 | Scale & Integrate | 15–20 | 🔲 Not Started |
| 4 | Depth | 21+ | 🔲 Not Started |

---

## ✅ Completed
- [x] Phase 0, All Steps
- [x] Phase 1, All Steps
- [x] Phase 2, All Steps

---

## 🔄 In Progress
_None_

---

## 📋 Phase 3 — Next Up (in order)
_Scale & Integrate (3.1 - 3.18)_

---

## 🚫 Blocked / Open Questions
- Pricing model not finalized (per-location vs per-event-volume vs flat tiers)
- Offline scanning scope (Phase 2 vs Phase 3 decision pending)

---

## 💡 Architecture Decisions Log

| Date | Decision | Reason |
|------|---------|--------|
| Setup | Knex over Prisma | Recursive CTEs for trace engine, JS-first (no TS type gen), tighter SQL control |
| Setup | PostgreSQL only (no MongoDB) | JSONB covers flexible KDE payloads; avoids dual-DB complexity; recursive CTEs for trace |
| Setup | JavaScript not TypeScript | Team preference; JSDoc used for critical type hints |
| Setup | pnpm workspaces | Monorepo with shared configs |
| Setup | BullMQ for jobs | Redis-native, used anyway for caching; handles import/export/hash jobs |
| 2026-11-09 | Greenfield development policy | Pre-production: no backward compatibility, legacy data, backfills, or data-preserving migrations. Reset the dev DB and delete obsolete schema/code instead. |

---

## 🔗 Key Files Modified Last Session

P0-15 — email verification returned 500 after account creation:
- `backend/src/modules/auth/auth.service.js` (return verification result)
- Tests: `backend/src/modules/auth/auth.verify-email.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-12 — user lifecycle with global email uniqueness:
- `backend/src/modules/users/users.service.js` (RLS email lookup, `EMAIL_DEACTIVATED`, invite-vs-reactivate)
- `backend/src/modules/users/users.controller.js` (reactivate message reflects invite)
- `frontend/src/api/users.api.js` (toast uses API message)
- Tests: `backend/src/modules/users/users.lifecycle.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `docs/API_STANDARDS.md`, `docs/DATABASE_SCHEMA.md`, `docs/PRD.md`, `docs/VALIDATION_RULES.md`, `PROGRESS.md`

P1-14 — proxy-aware rate limiting:
- `backend/src/config/trustProxy.js`, `backend/src/config/rateLimitRedis.js`
- `backend/src/config/env.js`, `backend/src/app.js`, `backend/src/server.js`
- `backend/src/middleware/rateLimiter.js`, `backend/src/middleware/authenticate.js`
- Tests: `backend/src/config/trustProxy.test.js`, `backend/src/config/env.test.js`, `backend/src/middleware/rateLimiter.test.js`, `backend/src/middleware/rateLimiter.proxy.test.js`, `backend/src/middleware/rateLimiter.fail-open.test.js`, `backend/src/middleware/authenticate.rate-limit.test.js`
- Docs: `backend/.env.example`, `docs/ENVIRONMENT_SETUP.md`, `docs/SECURITY.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-34, P1-35, P2-30 — audit ordering, fail-closed authentication, and Redis startup:
- `backend/src/middleware/auditLogger.js` (await audit insert before response)
- `backend/src/middleware/authenticate.js` (fail-fast blacklist lookup and `503 AUTH_UNAVAILABLE`)
- `backend/src/config/rateLimitRedis.js` (startup-only offline queue)
- Tests: `backend/src/middleware/auditLogger.test.js`, `backend/src/middleware/authenticate.rate-limit.test.js`, `backend/src/config/rateLimitRedis.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `docs/SECURITY.md`, `PROGRESS.md`

P1-36 — pending invitation blocks independent signup:
- `backend/src/modules/auth/auth.service.js` returns `EMAIL_INVITED`
- Tests: `backend/src/modules/auth/auth.verify-email.test.js`
- Docs: `docs/API_STANDARDS.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-37 — deactivated access tokens remain valid:
- `backend/src/modules/users/users.service.js` manages `du_<userId>` deny keys
- `backend/src/middleware/authenticate.js` rejects deactivated sessions
- Tests: `backend/src/modules/users/users.lifecycle.test.js`, `backend/src/middleware/authenticate.rate-limit.test.js`
- Docs: `docs/API_STANDARDS.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-38 — invitation resend lacked organization scope:
- `backend/src/modules/users/users.service.js` scopes resend update by organization and status
- Tests: `backend/src/modules/users/users.lifecycle.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P2-31 — database email uniqueness was case-sensitive:
- `backend/src/db/migrations/20260702172631_enforce_global_unique_email.js` uses `lower(email)` expression index
- Tests: `backend/src/modules/users/users.lifecycle.test.js`
- Docs: `docs/DATABASE_SCHEMA.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P2-32 — invite emails sent before tenant commit:
- `backend/src/db/tenantContext.js`, `backend/src/db/tenantTransaction.js`, `backend/src/middleware/tenantScope.js`
- `backend/src/modules/users/users.service.js` queues invite emails post-commit
- Tests: `backend/src/middleware/tenantScope.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P2-33 — local refresh-token encryption key missing:
- Added ignored local key to `backend/.env`; no repository commit
- Verified `backend/src/modules/auth/auth.refresh.test.js` without inline key
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-04 — audit log export:
- `backend/src/db/migrations/20240101000020_create_report_exports.js` (`type = events | audit`, `filters jsonb`)
- `backend/src/modules/audit/audit.validation.js`, `audit.service.js` (shared filters + `buildAuditLogQuery`)
- `backend/src/modules/reports/reports.validation.js`, `reports.service.js`, `reports.notifications.js` (type-aware export)
- `backend/src/jobs/workers/export-format.js`, `export-processor.js` (audit columns, JSON/CSV, exact-microsecond keyset)
- `frontend/src/lib/auditExport.js`, `frontend/src/pages/audit/AuditLogPage.jsx`, `frontend/src/pages/events/EventsListPage.jsx`, `frontend/src/pages/reports/ExportDetailPage.jsx`
- Tests: `backend/src/modules/reports/reports.export-pipeline.test.js` (DB), `reports.export-format.test.js`, `reports.rbac.test.js`, `backend/src/modules/audit/audit.service.test.js` (DB), `frontend/src/lib/auditExport.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `docs/API_STANDARDS.md`, `docs/DATABASE_SCHEMA.md`, `docs/JOBS.md`, `docs/VALIDATION_RULES.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND_ARCHITECTURE.md`, `PROGRESS.md`

P1-02 — persistent export pipeline:
- `backend/src/db/migrations/20240101000020_create_report_exports.js`
- `backend/src/modules/reports/reports.service.js`, `reports.controller.js`, `reports.routes.js`, `reports.validation.js`
- `backend/src/jobs/workers/export-generator.js`, `export-processor.js`, `export-format.js`
- `backend/src/jobs/workers/maintenance.js` (replaces `idempotency-cleanup.js`), `backend/src/jobs/index.js`
- `backend/src/modules/reports/reports.retention.js`
- `backend/src/lib/storage.js` (`uploadFile`, `deleteObject`, download response headers)
- `backend/src/middleware/auditLogger.js` (`report.download`, exact export-path matching)
- `frontend/src/api/reports.api.js`, `frontend/src/lib/exportStatus.js`, `frontend/src/pages/reports/ExportDetailPage.jsx`, `frontend/src/App.jsx`, `frontend/src/pages/events/EventsListPage.jsx`, `frontend/src/components/notifications/NotificationBell.jsx`
- Tests: `backend/src/modules/reports/reports.export-format.test.js` (6), `reports.export-pipeline.test.js` (7 DB), `reports.retention.test.js` (3 DB), `reports.rbac.test.js` (updated), `frontend/src/lib/exportStatus.test.js` (4)
- Docs: `docs/API_STANDARDS.md`, `docs/DATABASE_SCHEMA.md`, `docs/JOBS.md`, `docs/VALIDATION_RULES.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND_ARCHITECTURE.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-33 — receiving events take input lots only:
- `backend/src/modules/events/events.validation.js` (receiving requires at least one input, rejects any output lot)
- `frontend/src/pages/events/recordEventPayload.js`, `frontend/src/pages/events/RecordEventPage.jsx` (`SHOWS_OUTPUTS` = `creation`, `transformation`; receiving form hides Output Lots)
- Tests: `backend/src/modules/events/events.receiving-links.test.js` (5 schema), `frontend/src/pages/events/recordEventPayload.test.js` (receiving input-only case)
- Docs: `docs/AUDIT_REPORT.md`, `docs/VALIDATION_RULES.md`, `PROGRESS.md`

P2-21 — import queue limit surfaced:
- `frontend/src/pages/imports/ImportPage.jsx` (note while any import is `pending` or `processing`: files process at up to 5 per minute and start automatically)
- `docs/ARCHITECTURE.md` (import job flow documents the 5-per-minute worker limiter)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P0-10 — import shipping direction:
- `backend/src/jobs/workers/import-direction.js` (new: fixed CTE direction mapping; `shipping` → `input`)
- `backend/src/jobs/workers/import-event.js` (new: import group processor extracted for testable DB coverage)
- `backend/src/jobs/workers/import-processor.js` (uses the shared direction mapping; obsolete inline branch deleted)
- `backend/src/modules/events/events.validation.js` (shipping rejects any output lot)
- Tests: `backend/src/jobs/workers/import-direction.test.js` (6 unit), `backend/src/modules/events/events.shipping-links.test.js` (4 schema), `backend/src/jobs/workers/import-event.test.js` (3 DB), `frontend/src/pages/events/recordEventPayload.test.js` (shipping input-only case)
- Docs: `docs/AUDIT_REPORT.md`, `docs/VALIDATION_RULES.md`, `docs/DATABASE_SCHEMA.md`, `PROGRESS.md`

P0-12, P1-03, P1-29, P1-30 — operator access and report/export RBAC:
- `backend/src/modules/events/events.routes.js` (`GET /events` and `GET /events/:eventId` include `operator`)
- `backend/src/modules/reports/reports.routes.js`, `reports.validation.js`, `reports.controller.js` (route RBAC, strict Zod query/body validation, export rate limit, audit logging, validated inputs)
- `backend/src/middleware/rateLimiter.js` (per-organization `exportLimiter`, 10 requests / 15 minutes)
- `backend/src/middleware/auditLogger.js` (`report.export` action)
- `backend/src/modules/dashboard/routes.js` (operator may read dashboard stats and activity)
- `frontend/src/hooks/usePermissions.js` (operator gains `reports.read`)
- `frontend/src/pages/events/EventsListPage.jsx`, `EventDetailPage.jsx`, `frontend/src/pages/audit/AuditLogPage.jsx` (Amend gated on `events.amend`, Void on `events.void`, exports on `reports.export`)
- Tests: `backend/src/modules/events/events.rbac.test.js` (44 route/role cases), `backend/src/modules/events/events.operator-read.test.js` (5 DB tests), `backend/src/modules/reports/reports.rbac.test.js` (26 RBAC/validation/audit tests), `backend/src/modules/dashboard/dashboard.rbac.test.js` (14 route/role cases)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P2-17 to P2-20 — report links, lint, timezone tests, dead code:
- `frontend/src/pages/reports/ComplianceGapsPage.jsx` (event type cell links to `/events/:id`)
- `package.json`, `pnpm-lock.yaml`, `.eslintrc.js`, `scan-pwa/src/components/ui/field.jsx` (root `eslint` devDependency; Node env for build configs and tests; `eqeqeq` null exception; strict `===`)
- `frontend/src/utils/dateTimeLocal.test.js` (pinned `Asia/Kathmandu`, real `America/New_York` DST case)
- `backend/src/modules/events/events.service.js` (removed unused `isFtl` and `products.is_ftl` select)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P0-08 — safe JSONB parsing on event detail:
- `frontend/src/lib/json.js` (`parseMaybeJson`, `parseJsonArray`, `parseJsonObject`)
- `frontend/src/pages/events/EventDetailPage.jsx` (`compliance_gaps` and `kde_payload` decoded safely; explicit empty state)
- `frontend/src/pages/events/RecordEventPage.jsx`, `frontend/src/pages/products/ProductDetailPage.jsx`, `frontend/src/pages/products/ProductsListPage.jsx`, `frontend/src/pages/reports/ComplianceGapsPage.jsx` (shared decoders replace ad-hoc string/array checks)
- Tests: `frontend/src/lib/json.test.js` (13 tests)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-26, P1-27, P2-15, P2-16 — amendment follow-ups:
- `backend/src/modules/events/events.service.js` (compliance-gap alert returned from `insertEvent` and queued after commit; amendment rejects a different `eventType` and pins `source`; `status_reason` / `amendReason`)
- `backend/src/modules/events/events.validation.js` (`amendReason` for amendments, `voidReason` stays for voids)
- `backend/src/middleware/auditLogger.js` (amend audit `entityId` = replacement, `metadata.supersededEventId` = original)
- `backend/src/jobs/workers/hash-verifier.js`, `backend/src/utils/hashChain.js` (verifier reads `status_reason`)
- `backend/src/db/migrations/20240101000007_create_events.js` (`status_reason` column)
- Frontend: `frontend/src/pages/events/EventDetailPage.jsx` (`status_reason`)
- Tests: `events.compliance-alert.test.js`, `events.validation.test.js`, `auditLogger.test.js`; `events.amend-atomic.test.js` extended
- Docs: `docs/AUDIT_REPORT.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `docs/PRD.md`

P0-06 — effective event-creation idempotency:
- `backend/src/middleware/idempotency.js`, `backend/src/utils/idempotency.js` (organization-scoped request fingerprints, atomic claims, 2xx-only replay, expiry, mismatch/in-progress errors)
- `backend/src/db/migrations/20240101000007_create_events.js`, `backend/src/db/migrations/20240101000017_create_idempotency_keys.js` (organization-scoped import key uniqueness, request fingerprint, in-flight response state, constraints)
- `backend/src/jobs/queues.js`, `backend/src/jobs/index.js`, `backend/src/jobs/workers/idempotency-cleanup.js` (hourly expired-row cleanup)
- Frontend and Scan PWA event API/hooks (UUID keys reused for same logical retry)
- Tests: `backend/src/utils/idempotency.test.js`, `backend/src/middleware/idempotency.test.js` (19 passing P0-06 tests)
- Docs: `docs/API_STANDARDS.md`, `docs/DATABASE_SCHEMA.md`, `docs/BACKEND_ARCHITECTURE.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-28 — event mutation idempotency:
- `backend/src/modules/events/events.routes.js`, `backend/src/modules/events/events.validation.js` (idempotency coverage and attachment body validation for void, amend, presigned URL, and attachment registration)
- `frontend/src/api/events.api.js`, `frontend/src/pages/events/EventDetailPage.jsx`, `frontend/src/pages/events/RecordEventPage.jsx`; Scan PWA API hooks (mutation keys reused for unchanged retries)
- Tests: `backend/src/modules/events/events.mutation-idempotency.test.js`
- Docs: `docs/API_STANDARDS.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P0-04 — atomic event amendment:
- `backend/src/modules/events/events.service.js` (private `insertEvent(qb, ...)` helper; `createEvent` and `amendEvent` each use one transaction with the org advisory lock; old-row claim asserts `status = 'active'` and one affected row; post-commit trace-cache invalidation for superseded and replacement lots; deleted the nested transaction and the `overrideStatus` / `supersedesEventId` parameters)
- `backend/src/db/migrations/20240101000007_create_events.js` (`idx_events_supersedes_once` unique partial index)
- Tests: `backend/src/modules/events/events.amend-atomic.test.js` (new, 6 DB tests)
- Docs: `docs/AUDIT_REPORT.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `PROGRESS.md`

P1-18 — keyed HMAC hash chain with full coverage:
- `backend/src/utils/hashChain.js` (version 3 HMAC-SHA256, env/KMS keyring, full immutable payload, `event_evidence` append/seal helpers)
- `backend/src/config/env.js` (validates `HASH_CHAIN_KEY_ID`, `HASH_CHAIN_SECRET`, `HASH_CHAIN_OLD_KEYS`)
- `backend/src/db/migrations/20240101000007_create_events.js` (`hash_version` default 3, `hash_key_id`)
- `backend/src/db/migrations/20240101000019_create_event_evidence.js` (append-only signed evidence chain)
- `backend/src/modules/events/events.service.js` (row locks, void/amend/attachment evidence)
- `backend/src/modules/events/events.controller.js` (passes actor to void evidence)
- `backend/src/jobs/workers/import-processor.js` (`hash_key_id` on import writes)
- `backend/src/jobs/workers/hash-verifier.js` (HMAC + evidence verification, notification, Sentry, completion metric)
- `backend/src/lib/sentry.js` (lazy init, capture never throws), `backend/src/server.js`
- Tests: `hashChain.canonical-payload.test.js`, `events.hash-canonical.test.js`, `events.hash-evidence.test.js`, `hash-verifier.alert.test.js`, `lib/sentry.test.js`, updated chain/list/status/void/attachment suites
- Docs: `docs/AUDIT_REPORT.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `docs/JOBS.md`, `backend/AGENTS.md`, `PROGRESS.md`

P1-24 — event status filter:
- `backend/src/modules/events/events.service.js` (`getEvents` filters on `events.status` so the later `users` join cannot make `status` ambiguous)
- Tests: `backend/src/modules/events/events.status-filter.test.js` (4 DB tests: active, amended, void, filtered pagination)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-23 — event void cache invalidation:
- `backend/src/modules/events/events.service.js` (`voidEvent` returns linked lot ids from the transaction, invalidates trace cache after commit)
- Tests: `backend/src/modules/events/events.void-cache.test.js` (2 DB tests with in-memory Redis: warm trace before/after void, rejected void keeps cache)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-22 — lot audit trail:
- `backend/src/utils/auditTrail.js` (`writeAuditLog(params, qb)` can join the caller transaction)
- `backend/src/modules/lots/lots.service.js` (create/update/void run in a transaction and write `lot.create` / `lot.update` / `lot.void` with actor, IP, before/after state, void reason)
- `backend/src/modules/lots/lots.controller.js` (passes `req.user.id` + `req.ip`)
- Tests: `backend/src/modules/lots/lots.audit.test.js` (4 DB tests: create, update, void, rejected update)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P0-01 — canonical event hash (verification passes for events with lot links):
- `backend/src/utils/hashChain.js` (`HASH_VERSION`, `GENESIS_HASH`, `PENDING_RECORD_HASH`, `buildEventHashPayload`, `loadEventHashPayload`, `sealEventHash`; one serializer for write/import/verify)
- `backend/src/modules/events/events.service.js` (`createEvent` inserts `record_hash = 'PENDING'` + `hash_version`, seals after links)
- `backend/src/jobs/workers/import-processor.js` (same seal path; payload no longer built from CSV rows)
- `backend/src/jobs/workers/hash-verifier.js` (`loadEventHashPayload`; `hash.verify_failed` reasons `chain_link_mismatch` / `unsupported_hash_version` / `payload_mismatch`)
- `backend/src/db/migrations/20240101000007_create_events.js` (`events.hash_version` now `smallint NOT NULL DEFAULT 3`, plus `hash_key_id`, from P1-18)
- Tests: `backend/src/utils/hashChain.canonical-payload.test.js` (7 unit), `backend/src/modules/events/events.hash-canonical.test.js` (9 against a disposable local Postgres)
- Docs: `docs/AUDIT_REPORT.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `docs/JOBS.md`, `backend/AGENTS.md`, `PROGRESS.md`

P1-16 — seed safety and idempotence:
- `backend/src/db/seeds/01_seed_super_admin.js` (thin Knex seed wrapper; no truncate)
- `backend/src/db/seed-super-admin.js` (production/remote guard, idempotent org + super-admin upsert, generated password)
- `backend/.env.example` (seed safety variables)
- Tests: `backend/src/db/seed-super-admin.test.js` (36 passing: 32 guard/unit, 4 against a disposable local Postgres)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P0-11 — trace excludes superseded events:
- `backend/src/modules/trace/trace.service.js` (both CTEs filter `e.status = 'active'`; cache namespace `trace:v2:`)
- Tests: `backend/src/modules/trace/trace.amended-events.test.js` (new, 4 DB tests against a disposable local Postgres), `backend/src/modules/events/events.void-cache.test.js` (cache-key assertions updated to `trace:v2:`)
- Docs: `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P1-15 — boolean env parsing:
- `backend/src/config/env.js` (`booleanEnv` explicit allowlist; `EMAIL_DRY_RUN` no longer uses `z.coerce.boolean()`; `NODE_ENV=test` accepted for Jest)
- `backend/src/server.js` (logs resolved `emailDryRun` at startup; production dry-run warning)
- `backend/.env.example` (documents accepted values)
- Tests: `backend/src/config/env.test.js`, `backend/src/utils/email.test.js`
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P0-02 — deterministic hash chain ordering:
- `backend/src/db/migrations/20240101000007_create_events.js` (adds `chain_seq`, check constraint, unique per-org index)
- `backend/src/utils/hashChain.js` (`getChainTip`, `nextChainSeq`)
- `backend/src/modules/events/events.service.js` (sets `chain_seq`; `checkComplianceGaps` now runs on the caller's transaction)
- `backend/src/jobs/workers/import-processor.js` (sets `chain_seq`)
- `backend/src/jobs/workers/hash-verifier.js` (orders by `chain_seq`)
- Tests: `backend/src/modules/events/events.chain-seq.test.js`, `backend/src/utils/hashChain.chain-seq.test.js`, `backend/src/test/dbGuard.js`
- Docs: `docs/AUDIT_REPORT.md`, `docs/BACKEND_ARCHITECTURE.md`

P2-12 — stable event list pagination:
- `backend/src/modules/events/events.service.js` (`GET /events` orders by `created_at DESC`, then `chain_seq DESC`)
- Tests: `backend/src/modules/events/events.list-order.test.js` (2 passing against a disposable local Postgres)
- Docs: `docs/AUDIT_REPORT.md`, `PROGRESS.md`

P2-02 — consistent API pagination envelope:
- `backend/src/utils/pagination.js` (shared six-field `buildPagination` contract)
- Reports, events, and import-error services use shared pagination metadata; obsolete reports `meta` removed
- Tests: `backend/src/utils/pagination.test.js`, `backend/src/modules/reports/reports.pagination.test.js`, `backend/src/modules/reports/reports.gaps-pagination.test.js`
- Docs: `docs/API_STANDARDS.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

---

## 📌 Known Technical Debt
_Track items here as they're deferred_
