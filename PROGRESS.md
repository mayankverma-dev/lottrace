# LotTrace — Build Progress

## Current Status
**Phase:** Phase 2 — Field-Ready
**Last Updated:** 2026-11-13
**Last Session:** 2026-11-13 — P0-06 fixed and verified, alongside P1-26, P1-27, P2-15, P2-16. Event creation now uses organization-scoped request fingerprints, atomic 24-hour response replay, expiring claims, client-generated keys, and hourly cleanup. Compliance-gap email now queues after commit, amendments cannot change event type or source, amendment reason is `amendReason` / `status_reason`, and `event.amend` audit rows point at the replacement event.

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

---

## 📌 Known Technical Debt
_Track items here as they're deferred_
