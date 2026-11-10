# LotTrace — Build Progress

## Current Status
**Phase:** Phase 2 — Field-Ready
**Last Updated:** 2026-11-10
**Last Session:** 2026-11-10 — P0-01 (canonical event hash) implemented: `backend/src/utils/hashChain.js` builds one canonical payload from persisted rows/links (`numeric(15,4)` text, links sorted by `lot_id`, ISO-8601 UTC). Writers insert `record_hash = 'PENDING'` then `sealEventHash()` in the same transaction; the verifier calls the same serializer. `events.hash_version` added. 7 unit + 9 DB tests pass; live check: clean event verifies, tampered link quantity detected. Previous: P2-12 stable event list pagination (2 tests).

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

P0-01 — canonical event hash (verification passes for events with lot links):
- `backend/src/utils/hashChain.js` (`HASH_VERSION`, `GENESIS_HASH`, `PENDING_RECORD_HASH`, `buildEventHashPayload`, `loadEventHashPayload`, `sealEventHash`; one serializer for write/import/verify)
- `backend/src/modules/events/events.service.js` (`createEvent` inserts `record_hash = 'PENDING'` + `hash_version`, seals after links)
- `backend/src/jobs/workers/import-processor.js` (same seal path; payload no longer built from CSV rows)
- `backend/src/jobs/workers/hash-verifier.js` (`loadEventHashPayload`; `hash.verify_failed` reasons `chain_link_mismatch` / `unsupported_hash_version` / `payload_mismatch`)
- `backend/src/db/migrations/20240101000007_create_events.js` (`events.hash_version smallint NOT NULL DEFAULT 2`)
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
- Tests: `backend/src/modules/trace/trace.amended-events.test.js` (new, 6 passing against a disposable local Postgres)
- Docs: `docs/ARCHITECTURE.md`, `docs/AUDIT_REPORT.md`, `PROGRESS.md`

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
