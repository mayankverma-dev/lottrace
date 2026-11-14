# LotTrace — Full Audit Report

**Audit date:** 2026-11-02
**Scope:** `backend/`, `frontend/`, `scan-pwa/`, `docs/`, `PROGRESS.md`, deployment/config
**Method:** Full static read of every backend module, migration, middleware, worker, and every frontend/PWA page and API hook; syntax checks; production builds.
**No code, schema, or configuration was changed. No migrations or seeds were run. The configured Neon database was not contacted or modified.** This report is the only new file from the audit.

> Line numbers refer to the working tree at audit time. Re-read the file before editing — earlier fixes will shift them.

---

## How to use this document

This file is the single backlog for the audit. Every issue has a stable ID (`P0-01`, `P1-07`, …), severity, area, exact evidence, real-world impact, fix direction, verification steps, and implementation notes.

## Development policy — greenfield (overrides every compatibility note)

LotTrace is under active development. There are no production users and no data that must survive a fix. Treat the database, API payloads, internal formats, and existing rows as disposable.

- **No backward compatibility.** Do not add legacy code paths, dual formats, feature flags, or compatibility shims.
- **No data preservation.** Do not write backfills, data-repair migrations, or "keep old rows working" logic.
- **Rewrite freely.** Do not preserve an old implementation just because it exists; replace it with the simplest correct design.
- **Change the schema directly.** Edit the original migration or add a clean new one. Drop/recreate the development database and reseed whenever that is simpler.
- **Delete obsolete things.** Remove old columns, tables, endpoints, hash versions, and dead code instead of keeping them for compatibility.
- **Tests build their own data.** Never depend on pre-existing rows, fixtures, or database state.
- **Keep the final invariants.** Tenant isolation, append-only audit trail, hash verification, and RBAC must still be correct in the finished system; only their old implementations are disposable.
- **One safety rule.** Never run destructive commands against a shared staging or production database. The development database is disposable.

Issues marked **Fixed** are done. Do not re-implement or re-audit them unless a regression is proven.

**Fix protocol for every issue (mandatory):**

1. Read `AGENTS.md`, `PROGRESS.md`, `docs/API_STANDARDS.md`, `docs/CONVENTIONS.md`, `docs/DATABASE_SCHEMA.md`, `docs/VALIDATION_RULES.md`, and this file.
2. Produce a plan first: files to change, exact behavior change, schema/migration changes (greenfield: no backfill or compatibility work), and test plan. **Wait for approval** (root `AGENTS.md` rule 11).
3. Implement only the requested issue ID. Do not opportunistically refactor unrelated code.
4. Add or update automated tests for the issue. Tests build their own data; never depend on pre-existing rows.
5. Run the relevant checks: `node --check` on changed backend files, backend boot/env check, frontend build, scan-PWA build, and the issue-specific tests.
6. Update the issue's **Status** line here (`Open` → `Fixed`, with commit/PR and date).
7. Give the user a short manual verification checklist.

**Never during fixes:**

- add backward-compatibility code, legacy branches, dual-write paths, or compatibility shims;
- write backfills, data-repair migrations, or preserve old hashes/rows/API shapes;
- keep dead columns, tables, endpoints, or formats "just in case";
- change API response shapes outside `docs/API_STANDARDS.md`;
- mix two issue IDs in one change unless the document says they are coupled;
- "fix" an issue by deleting the feature or silently changing product behavior.

**Status values:** `Open` · `In progress` · `Fixed` · `Won't fix (reason)` · `Blocked (reason)`

---

## Severity legend

| Level | Meaning |
|-------|---------|
| **P0** | Data integrity, security, or a core flow that is broken in production. Fix before any pilot. |
| **P1** | Serious correctness, compliance, or operational defect. Workaround exists but is unacceptable long-term. |
| **P2** | Robustness, performance, DX, or documentation gap. Fix before GA or when touching the area. |

## Executive summary

The codebase is structurally clean and both frontend apps build, but **`PROGRESS.md` and `docs/FEATURE_MAP.md` overstate readiness**. Phase 2 is not complete: the audit found **12 P0**, **21 P1**, and **11 P2** issues.

The three most dangerous themes:

1. **The tamper-evident hash chain does not verify.** Every event with lot links hashes a JS number but verifies a PostgreSQL decimal string, so the verifier reports a false tamper. Chain ordering can also invert under concurrency. This destroys the product's core compliance claim.
2. **Tenant isolation is not actually enforced at the database layer.** RLS policies exist but the app never sets `app.current_org_id`, and the app connects as the table owner, which bypasses RLS. Only application-level `WHERE organization_id` filters protect tenants — and at least one path (event lot links) skips them.
3. **Amend, trace, and event display are wrong in normal use.** Amend always fails from the UI; amended events still appear in trace results; the event detail page crashes when compliance gaps exist; and recorded timestamps shift by the browser's UTC offset.

Do not onboard a customer until all P0 items are fixed and the smoke matrix at the end of this document passes.

## Issue index

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| P0-01 | P0 | Hash verification fails for every event with lot links (number vs decimal string) | Fixed (2026-11-10, 5271aea) |
| P0-02 | P0 | Hash chain ordering is non-deterministic under concurrency | Fixed (2026-11-10, 6118815) |
| P0-03 | P0 | Event creation accepts lots from other organizations | Fixed (2026-11-11, 63ce814) |
| P0-13 | P0 | Event creation accepts cross-tenant locationId | Fixed (2026-11-11, 104a774) |
| P0-14 | P0 | Lot creation accepts cross-tenant productId | Fixed (2026-11-11, ef77049) |
| P0-04 | P0 | Amendment is not atomic and can leave inconsistent history | Fixed (2026-11-13, a0d9a8f) |
| P0-05 | P0 | Row Level Security is inert at runtime | Open |
| P0-06 | P0 | Event creation lacks effective idempotency; replay keys never expire | Fixed (2026-11-13, 2c31091) |
| P0-07 | P0 | "Amend event" always fails in the web UI | Fixed (2026-11-13, 0a9f87d) |
| P0-08 | P0 | Event detail page crashes when compliance gaps exist | Fixed (commit pending) |
| P0-09 | P0 | Event timestamps shift by the browser UTC offset | Fixed (2026-11-13, 7ac1afb) |
| P0-10 | P0 | Import maps shipping rows to the wrong trace direction | Open |
| P0-11 | P0 | Trace includes superseded (amended) events | Fixed (2026-11-11, 298465f) |
| P0-12 | P0 | Operators can create events but cannot read them | Open |
| P1-01 | P1 | Imports never compute compliance gaps | Open |
| P1-02 | P1 | Export pipeline produces an unreachable file and ignores format | Open |
| P1-03 | P1 | Reports endpoints have no RBAC or input validation | Open |
| P1-04 | P1 | Audit log export exports events, not audit records | Open |
| P1-05 | P1 | Compliance gaps page reads the wrong pagination field | Open |
| P1-06 | P1 | Recall simulations page breaks pagination | Open |
| P1-07 | P1 | Permission map hides pages from roles that can use them | Open |
| P1-08 | P1 | Scan PWA cannot create lots or record manual events | Open |
| P1-09 | P1 | PWA caches authenticated lot responses across users | Open |
| P1-10 | P1 | Attachment keys are client-trusted; no download or list | Open |
| P1-11 | P1 | Refresh-token rotation races log users out | Open |
| P1-12 | P1 | User lifecycle breaks on global email uniqueness | Open |
| P1-13 | P1 | Notification 404 builds an invalid AppError | Fixed (2026-11-09, 18744eb) |
| P1-14 | P1 | Rate limiting collapses all users behind a proxy | Open |
| P1-15 | P1 | `EMAIL_DRY_RUN=false` enables dry-run | Fixed (2026-11-09, a964d91) |
| P1-16 | P1 | Seed script truncates any database it is pointed at | Fixed (2026-11-09, 93bfed5) |
| P1-17 | P1 | Database TLS disables certificate verification | Open |
| P1-18 | P1 | Hash coverage and keying are insufficient for tamper evidence | Fixed (2026-11-11, 64ea1b3) |
| P1-19 | P1 | Trace cache invalidation misses upstream lots | Open |
| P1-20 | P1 | No tests, CI, Dockerfiles, or frontend SPA rewrite | Open |
| P1-21 | P1 | Fresh database migration fails on unique-constraint index | Fixed (2026-11-09, 85b091e) |
| P1-22 | P1 | Lot create/update/void actions are not written to `audit_log` | Fixed (2026-11-11, 1f2150e) |
| P1-23 | P1 | Voiding an event does not invalidate warm trace cache | Fixed (2026-11-11, 192ee02) |
| P1-24 | P1 | Event status filters return 500 (`status` is ambiguous) | Fixed (2026-11-11, 7f50307) |
| P1-25 | P1 | Trace drops replacement edge when event versions share lot pairs | Fixed (2026-11-11, 998f338) |
| P1-26 | P1 | Compliance-gap email is enqueued inside the event transaction | Fixed (2026-11-13, aa97ef2) |
| P1-27 | P1 | Amendment can change event type and source | Fixed (2026-11-13, 0bffd49) |
| P1-28 | P1 | Event mutations lack idempotency | Fixed (2026-11-13, 08c5818) |
| P2-01 | P2 | Pagination inputs are unvalidated (`NaN`, huge limits) | Open |
| P2-02 | P2 | API response pagination shape is inconsistent | Open |
| P2-03 | P2 | Cache invalidation runs before transaction commit | Open |
| P2-04 | P2 | Trace product lookup is not organization-scoped | Open |
| P2-05 | P2 | Event list search and filters are not indexed for scale | Open |
| P2-06 | P2 | Local infrastructure uses default credentials and exposed consoles | Open |
| P2-07 | P2 | Frontend bundle is one large chunk; no error boundaries | Open |
| P2-08 | P2 | Documentation claims completion that the code does not deliver | Open |
| P2-09 | P2 | Attachment upload flow leaves orphaned objects | Open |
| P2-10 | P2 | Minor API/UX inconsistencies (status codes, empty states) | Open |
| P2-11 | P2 | Expected 4xx errors are logged at ERROR level | Fixed (2026-11-09, 315e54b) |
| P2-12 | P2 | Event list pagination is unstable when `created_at` values tie | Fixed (2026-11-10, ca4985e) |
| P2-13 | P2 | `event_evidence` lacks database-level immutability enforcement | Fixed (2026-11-11, c9473b8) |
| P2-14 | P2 | Audit report and progress docs overstate test counts and coverage | Fixed (2026-11-11, 642d2e1) |
| P2-15 | P2 | Amendment reason is stored and required as `voidReason` | Fixed (2026-11-13, 71bfa91) |
| P2-16 | P2 | `event.amend` audit row points at the superseded event | Fixed (2026-11-13, c034077) |

---

# P0 — Fix before any pilot

## P0-01 — Hash verification fails for every event with lot links

- **Severity:** P0 · **Area:** backend / data integrity · **Status:** Fixed (2026-11-10, 5271aea)
- **Evidence:** `backend/src/modules/events/events.service.js:62-84` (hash built from request objects), `:108-121` (links inserted), `backend/src/jobs/workers/hash-verifier.js:33-41` (hash rebuilt from DB rows), migration `event_lot_links.quantity` is `decimal`.
- **What happens:** The create path hashes `input.quantity` as a JavaScript number (`1`). `event_lot_links.quantity` is `numeric(15,4)`, so PostgreSQL returns a string with four fractional digits (`"1.0000"`), and the verifier hashes `"1.0000"`. Three independent mismatches exist:
  1. **Quantity type/scale:** `1` vs `"1.0000"`. This alone affects every event that has any input or output.
  2. **Link order:** create hashes links in request order; verifier sorts by `lot_id ASC` only (ties are also non-deterministic). Any request whose link order is not already sorted by UUID fails.
  3. **Datetime precision:** create hashes the raw request string, which may be `2026-01-01T10:00:00Z`; the verifier hashes `new Date(...).toISOString()`, which is `2026-01-01T10:00:00.000Z`. The web UI sends milliseconds, but API clients and imports are not guaranteed to.
  > Note: KDE payload and counterparty defaults are **not** a mismatch — validation defaults `kdePayload` to `{}` and `stableStringify(undefined)` and `null` both serialize to `null`. Do not "fix" those.
- **Real-world impact:** The hash-verifier worker reports a false tamper for essentially every real event (any event with at least one input or output). A compliance officer running verification sees failures on clean data. The product's central "tamper-evident" claim is false, and real tampering is indistinguishable from the noise.
- **Fix direction:** Create one canonical serializer used by **both** paths. It must take a persisted event row plus its links and produce: ISO-8601 UTC datetime, quantities normalized to a fixed decimal string (or numbers with explicit scale), links sorted deterministically (direction, lot_id), `kdePayload` defaulted to `{}`, `counterpartyInfo` defaulted to `null`, and every optional field explicitly included. Hash only this canonical object. Add `hash_version` so future canonicalization changes do not silently invalidate history. The verifier must call the same function, not re-implement it.
- **Greenfield note:** No legacy verifier and no re-seal migration. Do not add legacy hash support; if the code already has it, treat it as disposable and remove it when touching this area. `hash_version` exists to version future format changes, not to keep old rows verifiable.
- **Verification:** Create an event with two inputs, two outputs, no KDE payload, and a datetime without milliseconds; reverse the link order in a second request; run the verifier and confirm zero failures. Create ten events in a loop and verify the whole chain. Tamper with a hashed field (e.g. `event_datetime`) in a test DB copy and confirm detection. `notes` and the remaining immutable fields were added later by P1-18.
- **Fix:** `backend/src/utils/hashChain.js` now owns one canonical serializer. Writers insert with `record_hash = 'PENDING'`, insert links, then `sealEventHash()` hashes the persisted row + links (quantity as `numeric(15,4)` text, links sorted by `lot_id`, ISO-8601 UTC datetime) inside the same transaction. `events.hash_version` (`smallint NOT NULL DEFAULT 3`) and `hash_key_id` were added to the original migration; the verifier calls `loadEventHashPayload()` and fails with `reason = 'unsupported_hash_version'` on any other value. Manual create, import worker, and verifier share the same code; no legacy hash support, no backfill.
- **Verified:** `backend/src/utils/hashChain.canonical-payload.test.js` (unit payload/HMAC coverage) and `backend/src/modules/events/events.hash-canonical.test.js` (10 tests against a disposable local Postgres: link order, decimal text, 10-event chain, import-style seal, link/datetime tamper, unsupported version/key, schema).

## P0-02 — Hash chain ordering is non-deterministic under concurrency

- **Severity:** P0 · **Area:** backend / data integrity · **Status:** Fixed (2026-11-10, 6118815)
- **Evidence:** `backend/src/modules/events/events.service.js:48-57` (transaction starts, then advisory lock, then `orderBy('created_at','desc')`), migration `events.created_at` defaults to `knex.fn.now()`; `backend/src/jobs/workers/hash-verifier.js:13-16` orders by `created_at ASC`.
- **What happens:** PostgreSQL `now()` is the **transaction start** timestamp, not the statement time. Two transactions can begin in the same millisecond, then serialize on the advisory lock; both rows get the same `created_at`. `ORDER BY created_at` alone is then ambiguous, so the second transaction may pick the wrong `prev_hash`, and the verifier may read the rows in the opposite order. Under any real concurrency (import worker + manual entry, two operators), the chain can fork.
- **Real-world impact:** Hash verification fails intermittently and non-reproducibly — the worst possible failure mode for an audit tool. Restoring a database can change physical order and surface failures that did not exist before.
- **Fix direction:** Add a monotonic per-organization `chain_seq BIGINT NOT NULL` (unique on `(organization_id, chain_seq)`), assigned inside the same transaction **after** acquiring the advisory lock: `SELECT COALESCE(MAX(chain_seq),0)+1`. Order chain reads by `chain_seq`, never by `created_at`. Add an index on `(organization_id, chain_seq)`. Under the greenfield policy, no backfill is required: reset the development database and build the chain from scratch.
- **Greenfield note:** No old hash needs to stay valid. Include `chain_seq` in the hash payload only if it makes the canonical payload cleaner; if the payload changes, bump `hash_version` and reset the development data. There is no compatibility constraint.
- **Verification:** Fire 50 concurrent event creations for one org with `Promise.all`; verify `chain_seq` values are unique and strictly increasing in the order the verifier reads them, and that the verifier reports zero failures. Repeat with two orgs to confirm per-org sequencing. (Rollbacks may leave gaps; gaps are harmless, duplicates and inversions are not.)

## P0-03 — Event creation accepts lots from other organizations

- **Severity:** P0 · **Area:** backend / tenant isolation · **Status:** Fixed (2026-11-11, 63ce814)
- **Evidence:** `backend/src/modules/events/events.service.js:106-121` inserts `event_lot_links` directly from `data.inputs` / `data.outputs`; `backend/src/modules/events/events.validation.js` validates UUID shape only; `event_lot_links` FK references `lots(id)` with no organization constraint.
- **What happens:** A caller can supply the UUID of a lot belonging to another tenant. The link is inserted successfully. Trace queries then join that foreign lot, and `backend/src/modules/trace/trace.service.js:249` fetches products with `whereIn('id', productIds)` and **no organization filter**, leaking the foreign product name/SKU. Even without the product leak, the attacker can pollute another tenant's lineage or discover whether a guessed lot UUID exists.
- **Real-world impact:** Cross-tenant data disclosure and integrity corruption. This is the exact class of bug RLS was supposed to prevent, but RLS is inert (P0-05).
- **Fix direction:** Inside the create transaction, select all referenced lot IDs with `whereIn('id', ids).where({ organization_id })`; if the count does not match, throw `404 NOT_FOUND` (never 403 — do not confirm existence). Apply the same check in the import processor and amend path. Add a defense-in-depth composite FK: unique `(id, organization_id)` on `lots`, then `event_lot_links (lot_id, organization_id)` FK. Consider the same for `location_id` and `product_id`.
- **Verification:** As org A, attempt to create an event linking org B's lot; expect 404 and **zero** rows inserted. Confirm the transaction rolled back the event itself. Then trace an org-A lot and confirm no org-B product data appears.
- **Fix:** `assertLotsBelongToOrganization()` now validates every referenced lot inside the event transaction before event insertion. Manual and import links persist `organization_id`; composite parent keys and foreign keys enforce the same tenant boundary at the database layer. Unknown and foreign lots both return `404 NOT_FOUND`.
- **Verified:** `events.cross-tenant-lots.test.js` covers foreign, mixed valid/foreign, and unknown lot requests, including rollback assertions.

## P0-13 — Event creation accepts cross-tenant locationId

- **Severity:** P0 · **Area:** backend / tenant isolation · **Status:** Fixed (2026-11-11, 104a774)
- **Evidence:** `backend/src/modules/events/events.service.js` writes `data.locationId` directly to `events.location_id`; the only validation is UUID shape in `events.validation.js`.
- **What happens:** An org A caller can submit an org B location UUID. The event is created with a foreign location reference, and the compliance alert lookup can read that location without an organization predicate.
- **Real-world impact:** Cross-tenant location data can enter event history and compliance notifications, corrupting lineage context and exposing another organization's location metadata.
- **Fix direction:** Validate the location inside the event transaction with `id` and `organization_id`; return `404 NOT_FOUND` for unknown or foreign locations. Scope the compliance lookup. Add composite `(id, organization_id)` and `(location_id, organization_id)` database keys. Edit original migrations and reset the disposable development database; no backfill or compatibility path.
- **Verification:** As org A, submit org B's location to event creation; expect 404 and no event row. Submit an unknown location; expect the same 404. Submit an org-A location; expect successful creation and a passing hash verification.
- **Fix:** `createEvent()` now validates supplied locations against the event organization inside the transaction. Compliance location lookup is organization-scoped. Original migrations add composite location keys and a tenant-safe event/location foreign key.
- **Verified:** `events.cross-tenant-location.test.js` covers foreign, unknown, and valid locations. Fresh migration and canonical hash regression pass.

## P0-14 — Lot creation accepts cross-tenant productId

- **Severity:** P0 · **Area:** backend / tenant isolation · **Status:** Fixed (2026-11-11, ef77049)
- **Evidence:** `backend/src/modules/lots/lots.service.js` inserts `data.productId` directly into `lots.product_id`; `lots.validation.js` validates UUID shape only.
- **What happens:** An org A caller can create a lot referencing an org B product. The lot then carries foreign product identity into list/detail responses and downstream trace data.
- **Real-world impact:** Cross-tenant product metadata can enter org A lot history and contaminate traceability records.
- **Fix direction:** Validate the product inside the lot creation transaction with `id` and `organization_id`; return `404 NOT_FOUND` for unknown or foreign products. Add composite `(id, organization_id)` and `(product_id, organization_id)` database keys. Edit original migrations and reset the disposable development database; no backfill or compatibility path. Keep P2-04 separate.
- **Verification:** As org A, create a lot with org B's product; expect 404 and no lot or audit row. Submit an unknown product; expect the same 404. Submit an org-A product; expect successful lot creation and audit logging.

## P0-04 — Amendment is not atomic and can leave inconsistent history

- **Severity:** P0 · **Area:** backend / event lifecycle · **Status:** Fixed (2026-11-13, a0d9a8f)
- **Evidence:** `backend/src/modules/events/events.service.js:244-262` (`amendEvent` opens `db.transaction`, then calls `createEvent`), `:48` (`createEvent` opens its **own** `db.transaction`), `:230-240` (void path).
- **What happens:** `createEvent` runs on a different connection and commits independently. If marking the old event `amended` fails (constraint, deadlock, process crash), the new event is already committed as `active` and the old event remains `active` — two active versions. The reverse ordering is also unsafe. Concurrent amendments both read `status = 'active'` without `FOR UPDATE`, so two replacements can be created and both updates can succeed. The advisory lock is taken inside the inner transaction, not around the whole amendment.
- **Real-world impact:** Duplicate active events, ambiguous "current" record, trace and compliance reports that cannot be reconciled. A crash during amend silently corrupts history.
- **Fix direction:** Refactor `createEvent(data, organizationId, userId, overrideStatus, supersedesEventId, trx)` to accept an optional transaction/connection. `amendEvent` must: acquire the advisory lock once, `SELECT ... FOR UPDATE` the old event, verify `status = 'active'`, create the replacement **in the same transaction**, update the old row with `where({ id, status: 'active' })` and assert `rowCount === 1`, then commit. Invalidate caches only after commit. Add a unique partial index so an event can be superseded at most once.
- **Implementation note:** Cache invalidation currently happens inside `createEvent` before commit (P2-03); when refactoring, move it out or pass a post-commit callback.
- **Verification:** Force the old-event update to fail (test hook or invalid constraint) and confirm **no** new event exists. Run two concurrent amend requests; exactly one succeeds, the other gets 409. Check `supersedes_event_id` and statuses form a single chain.
- **Fix:** `backend/src/modules/events/events.service.js` now has a private `insertEvent(qb, ...)` helper that writes one event, its links, its hash seal, and its compliance-gap alert on the caller's transaction. `createEvent` opens one transaction, takes `pg_advisory_xact_lock`, and calls the helper; `amendEvent` opens one transaction, takes the same lock, `forNoKeyUpdate()`s the old row, verifies `status = 'active'`, calls the helper for the replacement, claims the old row with `.where({ status: 'active' })` asserting one affected row, appends the signed evidence, and commits. The nested `createEvent` transaction and the `overrideStatus` / `supersedesEventId` parameters are deleted. Trace-cache invalidation moved out of the transaction and now runs after commit for both the superseded and replacement lot sets; a rejected amendment no longer evicts a valid cache entry. `backend/src/db/migrations/20240101000007_create_events.js` adds `idx_events_supersedes_once`, a unique partial index on `supersedes_event_id`, so an event can be superseded at most once at the database layer.
- **Verified:** `backend/src/modules/events/events.amend-atomic.test.js` (6 DB tests: forced status-transition failure leaves no replacement, database rejects a second supersede, concurrent amendments settle on one winner, single chain position plus verifiable evidence, unknown-lot payload rolls back, post-commit cache invalidation for both lot sets). Full event and trace suites pass against a disposable local Postgres (`11 suites / 55 tests`), plus `src/jobs/workers/hash-verifier.alert.test.js` (2 tests). The stale part of the original evidence is now recorded for context: `forNoKeyUpdate()` already serialized concurrent amendments before this fix; the live defect was the second, independently committed transaction.

## P0-05 — Row Level Security is inert at runtime

- **Severity:** P0 · **Area:** backend / database security · **Status:** Open
- **Evidence:** `backend/src/middleware/tenantScope.js` (only sets `req.organizationId`; never touches the DB session), migrations `20240101000018_add_rls_policies.js:23` and `20260629000000_add_phase2_rls_policies.js:17` (`current_setting('app.current_org_id', true)::uuid`), `backend/src/db/knex.js` (single pool using the migration/owner role).
- **What happens:** RLS policies exist, but no code ever runs `SET LOCAL app.current_org_id`. Worse, PostgreSQL table **owners bypass RLS** unless `FORCE ROW LEVEL SECURITY` is set, and the app connects with the same role that runs migrations. So RLS is effectively decorative. Every tenant boundary depends entirely on developers remembering `.where({ organization_id })` — and P0-03 proves that is already failing.
- **Real-world impact:** A single missing filter (or a future one) is a full cross-tenant breach. `docs/SECURITY.md` and `ARCHITECTURE.md` currently imply defense-in-depth that does not exist.
- **Fix direction:** Choose one, with user approval:
  - **Proper RLS:** create a non-owner `lottrace_app` role; grant table DML; `ALTER TABLE ... FORCE ROW LEVEL SECURITY`; open a transaction per request (or per service call) and `SELECT set_config('app.current_org_id', ?, true)`; run migrations as a separate owner role. Set `app.current_org_id` to `''`/NULL for unauthenticated/system jobs and use explicit policies for workers.
  - **Honest fallback:** remove RLS from the security claims, document that isolation is application-level only, and add automated cross-tenant tests for every endpoint.
  Do not leave the current "best of both, working as neither" state.
- **Security note:** `SET LOCAL` only lasts for the transaction; a pooled connection must never leak the previous tenant's setting. Integration tests must assert the setting is reset.
- **Verification:** Connect as the app role without setting the GUC → `SELECT * FROM lots` returns 0 rows. Set org A → only A's rows. Attempt an insert with org B → rejected by `WITH CHECK`. Confirm workers still function under the chosen policy.

## P0-06 — Event creation lacks effective idempotency; replay keys never expire

- **Severity:** P0 · **Area:** backend / API correctness · **Status:** Open
- **Evidence:** `backend/src/middleware/idempotency.js:5-41`; `backend/src/modules/events/events.routes.js:18-24`; no `Idempotency-Key` header anywhere in `frontend/src` or `scan-pwa/src` (verified by grep); `backend/src/db/migrations/20240101000007_create_events.js:19` (`idempotency_key` **globally** unique); `backend/src/db/migrations/20240101000017_create_idempotency_keys.js:15` (unique `(organization_id, key)`).
- **What happens:** Six defects:
  1. **No client sends a key.** The web app and scan PWA never set `Idempotency-Key`, so a double-tap, a slow-network retry, or an axios retry creates a duplicate event and duplicate trace edges. The middleware only protects hypothetical API clients.
  2. **Expiry ignored:** the lookup never checks `expires_at`, so a key replays forever.
  3. **Failures cached:** every status `< 500`, including 400 validation errors and 403s, is stored. A client that fixes its payload and retries with the same key gets the old error forever.
  4. **Race:** check-then-insert without `onConflict`. The `(organization_id, key)` unique index exists, but the insert error is swallowed (`.catch(console.error)`), so two concurrent requests both execute and only one cache row survives.
  5. **No fingerprint:** the same key with a different body replays the old response instead of returning 409.
  6. **Cross-tenant key collision:** `events.idempotency_key` is globally unique, but the service lookup is scoped by organization. If org B reuses a key already stored by org A, the lookup misses and the insert throws a 500.
  > Note: `response_body: JSON.stringify(body)` into `jsonb` was tested against the local Postgres 16 + pg driver and stores a normal object, not a double-encoded string. **Do not "fix" this** or add a decode migration.
- **Real-world impact:** Field users on flaky mobile networks create duplicate receiving/production events, inflating quantities and corrupting trace graphs. API integrations can be permanently stuck on an old validation error or a 500 caused by another tenant's key.
- **Fix direction:** Generate an idempotency key client-side per submit attempt (UUID v4) and send it on every mutating request; reuse the same key only for retries of the same logical operation. Check `expires_at > now()` on lookup. Cache only 2xx (optionally 409). Add `request_hash` (SHA-256 of route + canonical body) and return 409 `IDEMPOTENCY_KEY_REUSED` on mismatch. Insert with `onConflict().ignore()` and re-read the winner so the race returns one consistent response. Add a TTL cleanup job. Bound the key to ≤ 255 chars. Make `events.idempotency_key` unique per `(organization_id, idempotency_key)` (or drop the column and rely solely on the middleware table) so cross-tenant collisions are impossible.
- **Greenfield note:** Drop and recreate the table or reset the development database. Do not scan for duplicate rows, write a dedupe migration, or preserve existing idempotency keys. Make the final schema correct from scratch.
- **Verification:** Double-submit the same form with the same key → one event, identical response. Same key + different body → 409. Expired key → executes anew. 400 response is not cached. Two concurrent requests → exactly one event. Org A and org B can use the same key without a 500.
- **Fix:** `idempotency.js` now validates and atomically claims organization-scoped keys, fingerprints canonical validated requests, ignores expired rows, stores only 2xx responses, rejects changed bodies, releases failed claims, and replays completed responses for 24 hours. Event routes validate before idempotency. Web and Scan PWA event creation generate and send one UUID key per logical submit, reusing it for retries. The HTTP key is removed from manual event rows; the import dedupe key remains organization-unique. An hourly BullMQ maintenance worker removes expired rows.
- **Verified:** `backend/src/utils/idempotency.test.js` (7 unit tests) and `backend/src/middleware/idempotency.test.js` (12 disposable-local-Postgres tests) pass. Covered replay, mismatch, concurrency, expiry, stale claims, non-cached 4xx, tenant reuse, key length, cleanup, import-key uniqueness, and no-key behavior.

## P0-07 — "Amend event" always fails in the web UI

- **Severity:** P0 · **Area:** frontend / event lifecycle · **Status:** Fixed (2026-11-13, 0a9f87d)
- **Evidence:** `frontend/src/pages/events/RecordEventPage.jsx:163-186`; backend `events.validation.js` `amendEventSchema` requires `amendReason`.
- **What happens:** The `payload` object is built at `:163-175` and never contains `amendReason`. The amend branch then checks `if (!payload.voidReason)` at `:177`, which is **always** true, shows "Void reason is required", and returns before calling the API. Even if that check were removed, the backend schema would reject the request. The form's reason input is bound to `formData` but is never copied into the payload.
- **Real-world impact:** The amend feature is 100% unusable. Operators who recorded a wrong event have no correction path, so they either leave bad data or record a compensating event that duplicates quantities — both unacceptable for an FDA audit trail.
- **Fix direction:** Build the payload with `amendReason: formData.amendReason` when amending, and omit it entirely when creating. Delete the impossible check or replace it with a real client-side validation message tied to the field. Keep the backend schema as the source of truth. Consider disabling the submit button until a reason is entered.
- **Verification:** Open an active event → Amend → change a quantity → enter a reason → submit. Confirm the API returns 201/200, the old event becomes `amended`, the new one is `active` with `supersedes_event_id`, and the trace shows only the new version (after P0-11). Confirm create still works without a `voidReason` field.

## P0-08 — Event detail page crashes when compliance gaps exist

- **Severity:** P0 · **Area:** frontend / event display · **Status:** Fixed (commit pending)
- **Evidence:** `frontend/src/pages/events/EventDetailPage.jsx:121` (`JSON.parse(event.compliance_gaps)`); `events.compliance_gaps` is `jsonb`.
- **What happens:** The API returns `compliance_gaps` as an array/object (node-postgres parses jsonb). `JSON.parse(array)` stringifies the array (`"[object Object]"` for objects) and throws `SyntaxError`, crashing the route. Any event with missing KDE fields — the exact events a compliance manager needs to inspect — becomes unviewable. A related risk exists if an older row contains a JSON string, so a blind type check must handle both.
- **Real-world impact:** The compliance-gap workflow is broken end-to-end: the report lists the event, clicking it crashes. Users lose trust in the system and cannot remediate gaps.
- **Fix direction:** Add a shared `parseMaybeJson(value, fallback)` utility in `frontend/src/lib/` that returns the value unchanged when it is already an object/array, parses only strings, and returns the fallback on failure. Use it for `compliance_gaps`, `counterparty_info`, `kde_payload`, and `custom_kde_schema` everywhere. Render a proper empty state when the array is empty.
- **Verification:** Open an event with two compliance gaps; page renders both without a console error. Open an event with `null` gaps; renders the empty state. Add a unit test for `parseMaybeJson` covering object, array, JSON string, null, and malformed string.
- **Fix:** `frontend/src/lib/json.js` adds `parseMaybeJson`, `parseJsonArray`, and `parseJsonObject`. `EventDetailPage` no longer calls `JSON.parse` on `compliance_gaps`; it renders the gap list or a `No compliance gaps detected.` empty state and parses `kde_payload` through the same helper. `RecordEventPage`, `ProductDetailPage`, `ProductsListPage`, and `ComplianceGapsPage` replace their ad-hoc string/array checks with the shared helpers. No API or schema change.
- **Verified:** `frontend/src/lib/json.test.js` (13 tests: object, array, JSON string, null, malformed string, exact jsonb gap-array regression) passes. Existing frontend tests pass with `TZ=Asia/Kathmandu`; `pnpm --filter frontend build` and `pnpm --filter scan-pwa build` succeed.

## P0-09 — Event timestamps shift by the browser UTC offset

- **Severity:** P0 · **Area:** frontend / data correctness · **Status:** Fixed (2026-11-13, 7ac1afb)
- **Evidence:** `frontend/src/pages/events/RecordEventPage.jsx:54` (`new Date().toISOString().slice(0, 16)`), `:80` (same pattern when loading for amend), `:167` (`new Date(formData.eventDatetime).toISOString()`); input is `type="datetime-local"`.
- **What happens:** `toISOString()` returns UTC. Slicing it and putting it in a `datetime-local` input shows UTC wall-clock time as if it were local. On submit, `new Date("YYYY-MM-DDTHH:mm")` is parsed as **local** time, so the value is shifted by the browser offset a second time. In UTC+5:45, "now" is displayed 5:45 in the past, then recorded another 5:45 earlier. Amend round-trips the same way, so simply opening and saving an event moves its timestamp.
- **Real-world impact:** Every manually recorded event outside UTC has a wrong time — up to roughly 14 hours in extreme offsets, and DST transitions add ambiguity. FSMA records require accurate event times; wrong timestamps also reorder the hash chain inputs and make recall windows incorrect.
- **Fix direction:** Add `toDateTimeLocal(date)` that formats using local getters (`getFullYear`, `getMonth`, …) with zero padding, and `fromDateTimeLocal(value)` that constructs `new Date(y, m-1, d, h, min)` so the browser interprets it as local. Store UTC ISO via `toISOString()` on submit. Use the same helpers in every datetime input in the app, including filters. Add unit tests with a fixed TZ (e.g. `TZ=Asia/Kathmandu`) covering a DST-observing zone too.
- **Verification:** In a non-UTC timezone, the input shows the current local time; saving stores an ISO timestamp equal to the actual instant. Reload and amend without changes; the stored timestamp is unchanged. Backend receives a `Z`-suffixed ISO string.

## P0-10 — Import maps shipping rows to the wrong trace direction

- **Severity:** P0 · **Area:** backend / import + trace · **Status:** Open
- **Evidence:** `backend/src/jobs/workers/import-processor.js:167-172` (`else if (cteType === 'shipping') direction = 'output'`); manual event UI treats shipping as an input event (`frontend/src/pages/events/RecordEventPage.jsx` `SHOWS_INPUTS`); trace CTEs rely on `direction`.
- **What happens:** A shipping event is the terminal event for a lot: the lot is consumed by the shipment and has no produced output lot. The manual path records that as an `input` link, but the importer records it as an `output`. The same real-world shipment therefore produces opposite graphs depending on how it was entered. Forward trace from the lot either stops at the event (correct) or invents an output edge that does not exist (imported), and backward trace from a customer lot cannot find the shipment.
- **Real-world impact:** A recall investigation gives different answers for manual vs imported data. Since imports are the normal onboarding path, most historical shipments will be wrong. This is a direct patient-safety/compliance failure.
- **Fix direction:** Map `shipping` to `input`, matching the manual path and the CTE semantic (the event consumes the lot). Reject output links on shipping in validation. Add a regression test that imports one shipping row and asserts the link direction is `input` and that forward trace returns the shipping event without a phantom downstream lot. Review `creation`/`receiving`/`transformation` mappings in the same test.
- **Greenfield note:** Delete existing imported data and re-import after the fix. Do not write a data-repair migration, do not flip old links in place, and do not coordinate hash re-seals. There is no historical data to preserve.
- **Verification:** Import a file containing creation, receiving, transformation, and shipping rows. Inspect `event_lot_links`; shipping must be `input` only. Run forward and backward trace on the shipped lot and confirm the graph matches the manual-entry equivalent.

## P0-11 — Trace includes superseded (amended) events

- **Severity:** P0 · **Area:** backend / trace · **Status:** Fixed (2026-11-11, 298465f)
- **Evidence:** `backend/src/modules/trace/trace.service.js:110` and `:176` (`AND e.status != 'void'`).
- **What happens:** Amendment sets the old event to `status = 'amended'` and creates a replacement with `supersedes_event_id`. The trace CTEs exclude only `void`, so **both** the superseded and the replacement event are traversed. Any corrected quantity, location, or input/output set appears twice with conflicting values; cycles are only prevented by lot ID, not event ID.
- **Real-world impact:** Trace results double-count hops and contain known-wrong data. A recall could include or exclude the wrong lots based on a corrected record. Auditors see two versions of the same event presented as equally valid.
- **Fix direction:** Filter `e.status = 'active'` in both CTEs. Keep amended/void events available in the audit log and event detail, but never in the live trace graph. Decide and document whether lot-level `status = 'void'` should also be excluded from trace results (currently it is returned with a status flag). Add a test: create event A, amend it to B, trace the lot; only B appears.
- **Verification:** Trace before and after an amendment; node/edge counts must not double. Confirm the superseded event is still visible via `GET /events/:id` and the audit log.
- **Fix:** `backend/src/modules/trace/trace.service.js` now filters `e.status = 'active'` in both recursive CTEs and uses `trace:v2:` cache keys so pre-fix cached graphs are ignored. Lot-level `status = 'void'` remains in trace results as a flagged node; only event status filters the graph.
- **Verified:** `backend/src/modules/trace/trace.amended-events.test.js` (4 DB tests) and the updated `backend/src/modules/events/events.void-cache.test.js` (2 DB tests) pass against a disposable local Postgres. Live API verification on a fresh disposable DB confirmed: same-link amend keeps exactly one edge to the replacement; changed-link amend shows only the new input/output path in forward, backward, and full traces; cold and warm cache returns the replacement; amended events remain available through event detail and the event list; tenant isolation returns 404 both directions; lot/event void audit rows are present; and the hash verifier passes with zero failures.

## P0-12 — Operators can create events but cannot read them

- **Severity:** P0 · **Area:** backend + frontend / RBAC · **Status:** Open
- **Evidence:** `backend/src/modules/events/events.routes.js:18` (POST allows `operator`), `:26` and `:32` (GET list/detail exclude `operator`); `frontend/src/hooks/usePermissions.js:7` grants `operator` `events.read`; `frontend/src/pages/events/RecordEventPage.jsx` navigates to `/events` after success.
- **What happens:** An operator records an event, the UI navigates to `/events`, and the API returns 403. The sidebar shows "Events" because the frontend permission map says `events.read`, so the user sees a broken page rather than a hidden link. The same mismatch will affect any operator trying to confirm what they just scanned.
- **Real-world impact:** The primary shop-floor workflow ends in an error. Operators cannot verify their own submissions, which leads to duplicate scans and distrust. Support tickets will look like "the app is broken" rather than an authorization bug.
- **Fix direction:** Pick one product behavior and make backend, frontend permissions, and navigation agree:
  - **Recommended:** allow `operator` on `GET /events` and `GET /events/:id`, scoped to their organization (optionally to events they recorded). Operators need read-back to do their job.
  - Alternative: keep the API restriction, remove `events.read` from the operator map, and redirect operators to a confirmation screen or the scan PWA instead of `/events`.
  Also audit every route's role list against `ROLE_PERMISSIONS` and add a table-driven test so drift is caught.
- **Verification:** Log in as an operator, record an event, and confirm the list and detail pages load with only that organization's data. Confirm an operator still cannot void/amend/export. Add a test asserting the route-role matrix.

---

# P1 — Fix before GA / before onboarding a paying customer

## P1-01 — Imports never compute compliance gaps

- **Severity:** P1 · **Area:** backend / compliance · **Status:** Open
- **Evidence:** `backend/src/jobs/workers/import-processor.js:118-128` (payload always `kdePayload: {}`), `:195-210` (direct insert, no `compliance_gaps`), `backend/src/modules/events/events.service.js:10-38` (`checkComplianceGaps` is private to the manual path).
- **What happens:** Imported events are inserted directly, bypassing `checkComplianceGaps`. `compliance_gaps` stays `NULL`, so the generated `has_compliance_gaps` column is `false` and the compliance-gap report, dashboard counter, and email alert all ignore imported data. A CSV full of FTL products with missing required KDEs imports "clean."
- **Real-world impact:** The main onboarding path produces records that look compliant but are not. An FDA inspection would find missing KDEs that the product reported as complete.
- **Fix direction:** Extract `checkComplianceGaps` into a shared service/module (e.g. `backend/src/modules/events/compliance.js`) and call it from both `createEvent` and the import worker. Decide how imports supply KDEs: either accept optional KDE columns in the template, or flag every FTL event as a gap until a user enriches it. Pass the resulting array to Knex and let the driver serialize it into `jsonb` (do not pre-stringify; it happens to work today via PostgreSQL's implicit cast, but it is fragile). Add a regression test importing an FTL product with no KDE payload and asserting one gap row.
- **Verification:** Import the sample file with an FTL product; the compliance-gaps page lists the event and the dashboard counter increments. Import a complete row and confirm no gap.

## P1-02 — Export pipeline produces an unreachable file and ignores format

- **Severity:** P1 · **Area:** backend / reports · **Status:** Open
- **Evidence:** `backend/src/jobs/workers/export-generator.js:16-36`; `backend/src/modules/reports/reports.controller.js:17-26`.
- **What happens:** The worker exports only five columns (`id, event_type, event_datetime, status, has_compliance_gaps`), always writes CSV regardless of the requested `format`, persists no database record, sends no notification (the comment says "here we would normally…"), and exposes no download endpoint. The API returns only a BullMQ `jobId`, which no client can use to retrieve the file. An empty result returns `{status:'empty'}` with no feedback. Large exports load every event into memory and stringify synchronously.
- **Real-world impact:** "Export" is a dead button. A compliance manager cannot produce the event history an auditor requests, and the UI's "you will be notified" promise is false.
- **Fix direction:** Add a `reports` table (`id`, `organization_id`, `type`, `format`, `status`, `storage_key`, `requested_by`, `created_at`, `completed_at`, `error`, `row_count`). Worker updates status, respects `format` (start with `csv` and `json`; reject anything else at validation), streams in batches, and creates a notification on success/failure. Add `GET /reports/:id` and `GET /reports/:id/download` (org-scoped, presigned GET, expiry). Frontend polls or uses the existing notification channel, then downloads. Add retention cleanup for old exports.
- **Security note:** Do not return a raw S3 key to the client. The download endpoint must verify `organization_id` before signing.
- **Verification:** Request an export, see status move `queued → processing → completed`, receive a notification, download a CSV with all expected columns, and confirm another org gets 404 for the same report ID.

## P1-03 — Reports endpoints have no RBAC or input validation

- **Severity:** P1 · **Area:** backend / authorization · **Status:** Open
- **Evidence:** `backend/src/modules/reports/reports.routes.js` (only `authenticate` + `tenantScope`); `reports.controller.js:17-26` reads `req.body.format` with no schema.
- **What happens:** Every authenticated role — including `operator` and `auditor` — can trigger a full-organization export. `format` is unvalidated and passed to the worker (currently ignored, but a future implementation may write it into a filename/content type). `page`/`limit` are parsed with `parseInt` and no bounds, so `limit=1000000` is accepted. Export requests are not rate-limited or audited.
- **Real-world impact:** Data exfiltration by the lowest-privileged role, plus a cheap way to exhaust worker/S3 resources. Compliance exports should be attributable to a person.
- **Fix direction:** Add `rbac([...])` to both routes. Recommended: `compliance-gaps` readable by `org_admin`, `compliance_manager`, `auditor`; `export` allowed by `org_admin`, `compliance_manager` (decide whether auditor may export). Add Zod schemas for query/body (`format` enum, limit max 200, date range). Add `auditLogger('report')` and a per-org export rate limit. Add route-matrix tests.
- **Verification:** Operator and auditor get 403 on export; compliance manager succeeds. `format=exe` returns 422. `limit=999999` is rejected or clamped. Audit log records the export with user and filters.

## P1-04 — Audit log export exports events, not audit records

- **Severity:** P1 · **Area:** frontend / audit · **Status:** Open
- **Evidence:** `frontend/src/pages/audit/AuditLogPage.jsx:27-38` (`useRequestExport` → `POST /reports/export`); `backend/src/jobs/workers/export-generator.js:12-30` (queries `events`).
- **What happens:** The Audit Log page's Export button queues the generic events export. The downloaded file contains events, not the audit entries currently on screen (and it ignores the page's action/user/date filters). A user requesting audit evidence receives the wrong dataset with no warning.
- **Real-world impact:** An auditor investigating who changed a record gets an event list. During an inspection this looks like obstruction or incompetence, and the real audit trail is not exported at all.
- **Fix direction:** Either implement an audit export type (`reports.type = 'audit'` with the same filters as the list endpoint and CSV columns matching the table), or remove/disable the button until it exists. Do not silently reuse the events export. If implemented, include actor, action, entity type/ID, IP, user agent, and timestamp, and note that audit records are immutable.
- **Verification:** Export from the Audit Log page with an action filter; the file contains only matching audit rows and column headers match the UI.

## P1-05 — Compliance gaps page reads the wrong pagination field

- **Severity:** P1 · **Area:** frontend / pagination · **Status:** Open
- **Evidence:** `frontend/src/pages/reports/ComplianceGapsPage.jsx:72` (`const pagination = data?.meta`), `:86-91` (expects TanStack `pageIndex`/`pageSize`); backend returns `pagination` at the top level (`backend/src/utils/apiResponse.js:19-21`); `frontend/src/components/common/DataTable.jsx:85-105` emits `{...pagination, page}` (1-based).
- **What happens:** `data.meta` is always `undefined`, so the table renders no pager at all (or crashes if it assumes an object). If the field were fixed, the handler still reads `newPagination.pageIndex`/`pageSize`, which do not exist; it should read `page`/`limit`. The page is effectively stuck on the first 50 rows with no way to see more.
- **Real-world impact:** Organizations with more than 50 gap events cannot reach the rest, hiding compliance failures.
- **Fix direction:** Use `data?.pagination`. Change the handler to `setParams(prev => ({...prev, page: newPagination.page}))` (keep `limit` if the pager supports page size). Audit every `DataTable` consumer for the same contract mismatch. Consider making `DataTable` accept a single `onPageChange(page)` callback to remove ambiguity.
- **Verification:** Seed 60+ gaps (test DB), confirm page 2 loads and the "Showing page X of Y" text is correct. Change page size and confirm the query updates.

## P1-06 — Recall simulations page breaks pagination

- **Severity:** P1 · **Area:** frontend / pagination · **Status:** Open
- **Evidence:** `frontend/src/pages/recall/RecallSimulationsPage.jsx:31,36,178-183` (`onPaginationChange={setPage}`); `DataTable.jsx:94,102` passes an object.
- **What happens:** `setPage` receives `{page, totalPages, ...}` and stores the object in state. The hook then sends `page=[object Object]` to the API. The request either 422s (once validation exists) or silently returns page 1; the pager may also render "page [object Object]".
- **Real-world impact:** Recall simulation history cannot be browsed beyond the first page. Given recall drills are an audit requirement, this blocks evidence collection.
- **Fix direction:** `onPaginationChange={(p) => setPage(p.page)}`. Add a shared `useTablePagination` hook or standardize on the `DataTable` contract across all pages. Add a test that clicking Next issues `?page=2`.
- **Verification:** With more than one page of simulations, click Next; network request contains `page=2`, rows change, and the pager label is correct.

## P1-07 — Permission map hides pages from roles that can use them

- **Severity:** P1 · **Area:** frontend / RBAC · **Status:** Open
- **Evidence:** `frontend/src/hooks/usePermissions.js:3-9` (only four roles, no `locations.*`, `products.*`, `settings.*`, `users.*`); `frontend/src/components/layout/Sidebar.jsx:13-24`; `frontend/src/pages/settings/UsersPage.jsx:228,250`; `backend/src/middleware/rbac.js` and route role lists.
- **What happens:** `compliance_manager` has `lots.*`, `events.*`, `trace.*`, `reports.*`, `recall.*`, `audit.read`, `imports.*` — but no `locations.read`, `products.read`, or `settings.read`. The sidebar therefore hides Locations, Products, and Settings for a role that is expected to manage them; the API would allow at least some of these. Operator sees Events because `events.read` is present, but the API denies it (P0-12). The frontend map is a hand-maintained duplicate of backend RBAC and has already drifted.
- **Real-world impact:** Compliance managers cannot reach master data through the UI, so they either use an admin account (violating least privilege) or cannot do their job. Permission drift will keep producing "hidden page" and "403 after click" bugs.
- **Fix direction:** Make the backend the source of truth: return effective permissions from `/auth/me` (or a dedicated `/auth/permissions`) and have `usePermissions` consume them. If that is too large, expand the static map to exactly match `docs/RBAC.md` and every route's role list, and add a test that compares the map against a shared permission constant. Include `locations.read/create/update`, `products.read/create/update`, `settings.read`, `users.manage`, `imports.read/create`.
- **Verification:** Log in as each role; every visible sidebar item loads without 403, and every API-allowed page is reachable. Add a matrix test for the four roles.

## P1-08 — Scan PWA cannot create lots or record manual events

- **Severity:** P1 · **Area:** scan-pwa / core workflow · **Status:** Open
- **Evidence:** `scan-pwa/src/pages/ScanPage.jsx:59-95` (lookup only; "not found" dead end), `:114-121` (`quantity: 1` hardcoded), `scan-pwa/src/App.jsx:110-124` (`/history` and `/manual` are "coming soon").
- **What happens:** If a lot does not exist, the PWA tells the user so and offers no creation flow, even though creating lots is the first step of the workflow. Every scanned item is submitted with quantity `1` and the lot's UOM; there is no quantity keypad or edit. History and manual entry are placeholders. There is no offline queue, so a dropped connection loses the scan.
- **Real-world impact:** The "scan PWA" cannot be used for real receiving or production counts. Quantities are wrong by default, which corrupts inventory and trace quantities. Workers fall back to paper, defeating the product.
- **Fix direction:** Decide the PWA's phase scope explicitly. Minimum viable: lot creation from the not-found state (product/location picker, code, quantity/UOM), editable quantity per scanned item, a real history list from `GET /events?source=scan`, and manual event entry reusing the same form. Then add offline support: IndexedDB outbox keyed by user/org, background sync, idempotency keys per queued item (depends on P0-06), and a visible sync status. Do not ship a "coming soon" tab in a production PWA.
- **Verification:** On a phone-sized viewport: scan an unknown code → create the lot → record a receiving event with quantity 12.5 → see it in history. Turn off the network, record an event, restore the network, confirm exactly one event syncs.

## P1-09 — PWA caches authenticated lot responses across users

- **Severity:** P1 · **Area:** scan-pwa / security · **Status:** Open
- **Evidence:** `scan-pwa/vite.config.js:35-45` (`urlPattern: /api/v1/lots`, `NetworkFirst`, `cacheName: 'api-cache'`); `scan-pwa/src/App.jsx:50-60` (logout clears Zustand and React Query only).
- **What happens:** Workbox caches `/api/v1/lots` responses in Cache Storage keyed by URL, ignoring the `Authorization` header. Logout does not delete the cache. On a shared shop-floor device, the next user can go offline (or hit a network failure) and see the previous user's/org's lot codes, product names, and quantities. The cache also serves stale lot data after edits.
- **Real-world impact:** Cross-tenant/cross-user data exposure on the most shared device in the facility, plus stale data causing wrong scans. This is a privacy and confidentiality incident waiting to happen.
- **Fix direction:** Do not runtime-cache authenticated API responses. If offline lookup is a requirement, store data in IndexedDB keyed by `organizationId`/`userId`, purge on logout and on org switch, and encrypt at rest where feasible. At minimum, add `caches.delete('api-cache')` (and any Workbox precache API caches) to logout and set `Cache-Control: no-store` on API responses. Add a test that logs out and asserts Cache Storage is empty.
- **Verification:** Login as org A, load a lot, logout, login as org B, go offline, search for A's lot code → no result. Confirm the network panel shows no `(from service worker cache)` for `/api/v1/lots` while authenticated.

## P1-10 — Attachment keys are client-trusted; no download or list

- **Severity:** P1 · **Area:** backend + frontend / files · **Status:** Open
- **Evidence:** `backend/src/modules/events/events.service.js:279-300` (`addAttachment` inserts `data.key` after only checking the event), `:270-277` (presigned URL key generated safely), `frontend/src/pages/events/RecordEventPage.jsx:193-205` (upload `fetch` ignores `response.ok`; client sends the key back).
- **What happens:** The presigned-URL endpoint generates a safe key, but `POST /events/:id/attachments` trusts whatever `key` the client sends. A user can attach any object in the bucket — another org's export, another event's attachment, or an arbitrary key they learned — to their own event. The server also trusts client-supplied `sizeBytes`/`contentType`. There is no endpoint to list or download attachments, so uploaded files are write-only. The frontend does not check whether the S3 PUT succeeded, so a failed upload still creates an attachment row pointing at a missing object.
- **Real-world impact:** Broken access control on evidence files, orphaned records, and an inability to retrieve the documents an auditor asks for. A user can also claim a file is 1 KB when it is 5 GB.
- **Fix direction:** Derive the key server-side or validate it strictly against `attachments/org_${orgId}/events/${eventId}/` and reject traversal. Call `HeadObject` before insert; take size/content type from S3, not the body. Whitelist MIME types and enforce a max size. Add `GET /events/:id/attachments` (list, org-scoped) and `GET /attachments/:id/download` (presigned GET, org-scoped). In the frontend, check `response.ok` and abort the attachment creation on failure; show per-file progress/errors.
- **Greenfield note:** Delete existing attachment rows and objects instead of auditing or quarantining them. Enforce the server-derived key prefix for every new upload; no legacy rows need to survive.
- **Verification:** Attempt to attach a key from another org → 404/400 and no row. Upload a file, list it, download it, and confirm bytes match. Simulate a failed PUT and confirm no attachment row is created.

## P1-11 — Refresh-token rotation races log users out

- **Severity:** P1 · **Area:** backend / auth · **Status:** Open
- **Evidence:** `backend/src/modules/auth/auth.service.js:234-262` (`is_used` checked **before** the transaction; update has no `FOR UPDATE` or conditional `where`).
- **What happens:** Two tabs (or an axios retry plus a tab) send the same refresh token. Both read `is_used = false` before either commits, both enter the transaction, both mark it used, and both insert a new token — or the second request sees `is_used = true` and deletes the entire `session_family`, logging the user out everywhere. There is no grace window for the legitimate "I just rotated this token" case.
- **Real-world impact:** Random logouts, especially on mobile/PWA with flaky networks, and a support burden that looks like session instability. The family-deletion behavior turns a benign race into a forced re-login on every device.
- **Fix direction:** Move the lookup and check inside the transaction with `SELECT ... FOR UPDATE`. Update with `where({ id, is_used: false })` and assert one row; if zero, re-read and apply a short reuse grace window (e.g. 10 seconds) that returns the already-issued replacement token instead of nuking the family. Store `replaced_by_token_id` and `rotated_at`. On the client, keep the existing in-tab refresh queue (`frontend/src/lib/api.js:26-76`) and add cross-tab coordination (e.g. a `BroadcastChannel` or a short localStorage lock) so two tabs do not refresh the same token simultaneously. Only delete the family on reuse **outside** the grace window.
- **Implementation note:** Cross-tab single-flight is required for correctness, not optional. The existing in-tab queue does not help when two tabs hold the same cookie.
- **Verification:** Fire 10 parallel refresh calls with the same cookie; all either receive the same new token or one succeeds and the rest get a consistent 401, and the session family is not deleted. Reuse the old token after the grace window → family revoked.

## P1-12 — User lifecycle breaks on global email uniqueness

- **Severity:** P1 · **Area:** backend / users + auth · **Status:** Open
- **Evidence:** `backend/src/modules/users/users.service.js:78-91` (duplicate lookup **excludes** `deactivated`), `:99-108` (insert), `:238-248` (reactivate sets `active` unconditionally), `:282-295` (resend only accepts `status='invited'`), `backend/src/db/migrations/20260702172631_enforce_global_unique_email.js` (`UNIQUE(email)` exists).
- **What happens:** Three related defects:
  1. **Deactivated email invite → 500:** the duplicate check deliberately ignores deactivated rows, but the database now enforces global `UNIQUE(email)`. Inviting a previously deactivated user (same org or another org) passes the check and then throws a unique violation, which the error handler maps to a generic 409/500. There is no path to rehire or move a user.
  2. **Reactivating a never-accepted invite locks the user out:** deactivating an `invited` user (password NULL) and later reactivating sets `status='active'` but leaves `password_hash` NULL. Login can never succeed, and "resend invite" refuses because the status is no longer `invited`.
  3. **Email is permanently reserved:** because of global uniqueness plus the exclusion above, a deactivated user's email can never be used again unless the old row is reactivated — even if the person has left the company. Multi-org membership is impossible by design, and that design is undocumented.
- **Real-world impact:** Contractors and employees who change organizations get stuck in a 500/409 loop or a permanent login failure. Admins work around it with direct DB edits, which breaks the audit trail.
- **Fix direction:** Handle the deactivated case explicitly: look up **any** existing user by email; if deactivated, return `409 EMAIL_DEACTIVATED` with a supported recovery action (reactivate, or an admin-approved transfer). On reactivate, if `password_hash IS NULL`, set status to `invited`, generate a fresh token, and send the invite. Document that email is globally unique and one user belongs to one org; if cross-org membership is a product requirement, add a `memberships` table instead of duplicating users. Add tests for deactivate → invite elsewhere, deactivate → re-invite same org, and invited → deactivate → reactivate.
- **Greenfield note:** Design the final identity model now. Do not preserve old user rows or historical attribution across organization moves; reset the development data. If cross-org membership is a product requirement, add a `memberships` table from the start instead of mutating `users.organization_id`.
- **Verification:** Invite `a@x.com`, deactivate, invite again → clear 409 with a recovery option, not a 500. Reactivate a never-accepted invite → the user receives a working invite and can set a password. Login resolves exactly one user.

## P1-13 — Notification 404 builds an invalid AppError

- **Severity:** P1 · **Area:** backend / errors · **Status:** Fixed (2026-11-09, 18744eb)
- **Evidence:** `backend/src/modules/notifications/notifications.controller.js:22` (`new AppError('Notification not found', 404)`); `backend/src/utils/AppError.js:14-18` (signature is `message, code, statusCode`); `backend/src/middleware/errorHandler.js` defaults `statusCode` to 500. Same bug at `backend/src/modules/events/events.service.js:267,277` (attachment paths).
- **What happens:** `404` is passed as the **code** and `statusCode` is `undefined`, so the error handler returns **500** with `code: 404`. Clients treat a missing/foreign notification or event as a server outage, and monitoring pages on false 5xx alerts. Cross-tenant attachment access also returns 500 instead of 404.
- **Real-world impact:** Wrong status codes break client error handling, pollute error tracking, and make a normal "not found" look like an incident. The API standards require 404 for cross-tenant access.
- **Fix direction:** Fix all three call sites to `new AppError('...', 'NOT_FOUND', 404)`. Grep for the pattern `AppError(..., <number>)` and add a lint rule or unit test. Harden `AppError` to accept either signature? Prefer fixing call sites; silent coercion hides bugs. Add error-handler tests for 400/401/403/404/409/422/500.
- **Verification:** `POST /notifications/:random/mark-read` returns 404 with `error.code = 'NOT_FOUND'`. Access another org's attachment → 404, not 500. Error monitoring shows no 5xx.

## P1-14 — Rate limiting collapses all users behind a proxy

- **Severity:** P1 · **Area:** backend / deployment · **Status:** Open
- **Evidence:** `backend/src/app.js` (no `app.set('trust proxy', ...)`), `backend/src/middleware/rateLimiter.js:6-40` (default IP key; auth limit 50/15 min).
- **What happens:** In production the API sits behind Vercel/Cloudflare/nginx/ngrok, so `req.ip` is the proxy's IP for every user. All users share one 1000-request bucket and one 50-request auth bucket. One busy user (or a scanner loop) locks out every tenant; 50 login attempts across the whole platform trigger a global 429. If `trust proxy` is later enabled blindly, clients can spoof `X-Forwarded-For` and bypass limits entirely.
- **Real-world impact:** Platform-wide denial of service from normal usage, and unreliable brute-force protection on login.
- **Fix direction:** Set `trust proxy` to the exact number of hops or trusted CIDR ranges via env (never `true` in production). Key the general limiter by `req.user?.id || req.ip` after authentication (mount it after `authenticate` where possible, or use a key generator that falls back to IP). Key the auth limiter by normalized email + IP, not IP alone. Add `passOnStoreError: true` or explicit handling so a Redis outage does not take down all requests, and add a separate limiter for exports/imports. Add a test with `X-Forwarded-For` to prove the configured trust level is correct.
- **Verification:** Two users behind the same proxy get independent buckets. Spoofed `X-Forwarded-For` from an untrusted hop does not change the key. Redis down → requests still succeed (fail-open) with a warning.

## P1-15 — `EMAIL_DRY_RUN=false` enables dry-run

- **Severity:** P1 · **Area:** backend / config · **Status:** Fixed (2026-11-09, a964d91)
- **Evidence:** `backend/src/config/env.js:26` (`z.coerce.boolean()`).
- **What happens:** `z.coerce.boolean()` uses JavaScript truthiness. The string `"false"` is truthy, so `EMAIL_DRY_RUN=false` parses to `true`. Any deployment that explicitly disables dry-run to send real invite/reset/compliance emails instead logs them and sends nothing. The inverse (`"true"`) works by accident.
- **Real-world impact:** Silent email outage. Invited users never receive invites, password resets never arrive, and compliance-gap alerts are never delivered — while logs claim the email was "sent" in dry-run mode.
- **Fix direction:** Replace with an explicit parser that accepts `true/false/1/0` case-insensitively (e.g. `z.string().optional().default('false').transform(v => ['true','1'].includes(v.toLowerCase()))`, or `z.stringbool()` if the Zod version supports it). Apply the same pattern to every boolean env var. Log the resolved value at boot (not secrets) so operators can confirm. Add a config test for `"true"`, `"false"`, `"1"`, `"0"`, and unset.
- **Verification:** Boot with `EMAIL_DRY_RUN=false`; send an invite and confirm the Resend API is called (or a real email arrives in staging). Boot with `true`; confirm it logs and does not call the API.

## P1-16 — Seed script truncates any database it is pointed at

- **Severity:** P1 · **Area:** backend / ops · **Status:** Fixed (2026-11-09, 93bfed5)
- **Evidence:** `backend/src/db/seeds/01_seed_super_admin.js:9` (`TRUNCATE TABLE organizations, users CASCADE`); `backend/knexfile.js` reads `DATABASE_URL` from `.env` (currently Neon); `package.json` seed script.
- **What happens:** `npm run seed` deletes every organization, user, and (via `CASCADE`) all tenant data, then inserts a demo org and a super admin with password `admin123`. There is no `NODE_ENV` guard, no confirmation, and no host check. Because `backend/.env` points at Neon, a developer running the documented seed command destroys the shared database.
- **Real-world impact:** One command wipes production/staging data. This is the highest-impact operational landmine in the repo, even though it is "only" a script.
- **Fix direction:** Refuse to run when `NODE_ENV === 'production'`. Require an explicit `ALLOW_DESTRUCTIVE_SEED=true` and a host allowlist (`localhost`, `127.0.0.1`, `postgres`). Print the target host and require interactive confirmation for non-local hosts. Prefer replacing `TRUNCATE` with an idempotent upsert so the seed can run safely. Never hardcode a default password outside local dev; force a password change or generate one.
- **Verification:** With `NODE_ENV=production`, the seed exits non-zero before touching the DB. With a remote host, it refuses unless both opt-in flags are set. Running it twice on local does not duplicate or destroy unrelated rows.

## P1-17 — Database TLS disables certificate verification

- **Severity:** P1 · **Area:** backend / security · **Status:** Open
- **Evidence:** `backend/knexfile.js:10` and `:46` (`ssl: { rejectUnauthorized: false }`); production connection override at `:38-44`.
- **What happens:** All TLS connections accept any certificate, including an attacker's. Production **always** uses this object, even for non-Neon hosts. This makes the encrypted connection vulnerable to man-in-the-middle attacks on database credentials and all tenant data. `isNeon` detection by substring is also brittle (staging URLs, pooled hosts).
- **Real-world impact:** A network attacker on the same VPC/host can intercept or alter supply-chain records. This undermines every other security control.
- **Fix direction:** Default `rejectUnauthorized: true`. Load the provider CA (Neon's CA bundle or the system trust store) via `sslrootcert`/`ca`. Allow `rejectUnauthorized: false` only behind an explicit `DB_TLS_INSECURE=true` dev flag, logged loudly at boot. Detect SSL from the URL (`sslmode=require`) rather than a hostname substring, and test the production connection path.
- **Verification:** Production boot fails if the certificate cannot be verified (test against a self-signed proxy). `sslmode=require` URLs connect successfully with the CA configured. No `rejectUnauthorized:false` remains outside the dev flag.

## P1-18 — Hash coverage and keying are insufficient for tamper evidence

- **Severity:** P1 · **Area:** backend / integrity · **Status:** Fixed (2026-11-11, 64ea1b3)
- **Evidence:** `backend/src/modules/events/events.service.js:62-72` (payload fields), `backend/src/utils/hashChain.js` (plain SHA-256), `backend/src/jobs/workers/hash-verifier.js`.
- **What happens:** The hash covered only `eventType`, `locationId`, `eventDatetime`, `source`, `kdePayload`, `counterpartyInfo`, and lot links. It excluded `notes`, `status`, `recorded_by`, `supersedes_event_id`, `void_reason`, and attachment metadata — all fields an auditor relies on. It was also **unkeyed**: anyone who could write to the database could recompute a valid chain from `GENESIS` after editing data. Verification failures were only logged; there was no alert or notification.
- **Real-world impact:** The "tamper-evident" claim was weak: notes and statuses could be changed undetected, and a motivated insider with DB access could forge the entire chain. Failures could go unnoticed for months.
- **Fix:** Hash version `3` uses HMAC-SHA256 over a domain prefix (`lottrace:event:v3`), `prev_hash`, and the full immutable persisted field set: `id`, `organization_id`, `chain_seq`, `event_type`, `location_id`, `counterparty_info`, `event_datetime`, `recorded_by`, `recorded_at`, `source`, `kde_payload`, `compliance_gaps`, `notes`, `idempotency_key`, `supersedes_event_id`, `created_at`, and sorted input/output links. The secret lives in `HASH_CHAIN_SECRET` (env/KMS, never the DB); `hash_key_id` names it, and `HASH_CHAIN_OLD_KEYS` keeps rotated keys verifiable. Mutable `status` / `void_reason` and attachment metadata are covered by the append-only `event_evidence` chain rooted at `events.record_hash`; void, amend, and attachment writes append signed evidence in the same transaction. The verifier rejects unknown versions and keys, verifies both chains, writes `hash.verify_failed`, creates an org-wide `hash_verification_failed` notification, calls Sentry when `SENTRY_DSN` is set, and always records a `hash.verify_completed` audit row plus a structured pino metric. Only version 3 exists; no v1/v2 verifier, dual-write, or backfill.
- **Verified:** Complete local DB-backed Jest run: 20 suites pass, 157 tests pass, and 4 tests skip because seed-super-admin tests require a separate opt-in setup. New coverage: `events.hash-evidence.test.js` (void/amend/attachment evidence, database immutability, payload/sequence/prev-hash/state tamper), `hash-verifier.alert.test.js` (audit + notification + Sentry + completion metric), `hashChain.canonical-payload.test.js` (full field coverage, HMAC vs SHA-256, keyring rotation, evidence domain separation), `lib/sentry.test.js` (inert without DSN, capture, reporting failure swallowed), plus updated hash/ordering/list/status/void/attachment/amended-trace suites.

## P1-19 — Trace cache invalidation misses upstream lots

- **Severity:** P1 · **Area:** backend / cache · **Status:** Open
- **Evidence:** `backend/src/modules/events/events.service.js:124-128` (invalidates only lots directly linked to the new event); `backend/src/modules/trace/trace.service.js:16-18,282-290` (cache key is per starting lot).
- **What happens:** A forward trace from lot A caches the graph A → B. Later, an event consumes B and produces C. The code invalidates B and C, but not A. Tracing A again returns the cached graph without C, so the recall result is stale until TTL expiry (if any). Backward traces from downstream lots have the mirror problem. Invalidation also happens before the transaction commits (P2-03).
- **Real-world impact:** After new production or shipping activity, tracing an upstream lot silently omits downstream lots — exactly the direction a recall investigation needs. The UI gives no indication that the result is stale.
- **Fix direction:** Use an organization-level trace version: `trace:{orgId}:v{version}:{lotId}:{direction}`. Increment `version` (Redis `INCR` or a DB column) after any event/lot/link change commits. This invalidates every cached graph in O(1) and is safe under concurrency. Alternatively, walk ancestors and invalidate them, but that is more code and easier to get wrong. Move invalidation after commit. Add tests: cache A→B, add B→C, trace A and assert C appears.
- **Verification:** Repeat the scenario above with and without cache warm-up; results are identical. Concurrent event creation does not leave stale graphs.

## P1-20 — No tests, CI, Dockerfiles, or frontend SPA rewrite

- **Severity:** P1 · **Area:** engineering / delivery · **Status:** Open
- **Evidence:** No `*.test.js`/`*.spec.js` or test directories; no `.github/workflows`; no `backend/Dockerfile`/`frontend/Dockerfile` (compose only runs infrastructure); no `frontend/vercel.json` (only `scan-pwa/vercel.json` exists); `PROGRESS.md` claims Phase 2 completion.
- **What happens:** There is no automated regression safety net for the fixes in this document. Both apps build, but nothing proves behavior. The frontend is a client-side router; without a Vercel rewrite, refreshing `/events/123` returns 404. There is no repeatable deployment path for the API beyond "run node," and no migration runbook.
- **Real-world impact:** Every fix risks breaking another flow, and every deploy is manual and unverifiable. Deep links (including email links to events) break in production.
- **Fix direction:** Add a minimal but real test stack: Vitest + Supertest for the backend against a disposable Postgres (docker compose service), React Testing Library for critical frontend flows, and at least the P0 regression tests. Add CI that runs `node --check`, tests, both builds, and a migration-from-scratch check. Add Dockerfiles for API/web/PWA and a compose profile for the full stack. Add `frontend/vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}` (verify it does not swallow `/api`). Write a migration/rollback runbook.
- **Verification:** CI is green on a fresh clone. A deep link refresh works on the deployed frontend. `docker compose up` brings up the full stack and a smoke script passes.

## P1-21 — Fresh database migration fails on unique-constraint index

- **Severity:** P1 · **Area:** backend / database migrations · **Status:** Fixed (2026-11-09, 85b091e)
- **Evidence:** `backend/src/db/migrations/20240101000002_create_users.js:21` creates `idx_users_email_org` with `table.unique(...)`; `backend/src/db/migrations/20260702172631_enforce_global_unique_email.js:7` used `table.dropIndex([], 'idx_users_email_org')`.
- **What happens:** `knex migrate:latest` fails on a fresh database: `drop index "idx_users_email_org" - cannot drop index idx_users_email_org because constraint idx_users_email_org on table users requires it`. The batch rolls back, so a new environment, CI database, or greenfield reset never reaches the final schema.
- **Real-world impact:** No fresh deployment or disposable test database can be provisioned. Every migration-from-scratch verification is blocked, including the reset required by this report.
- **Fix direction:** Drop the object PostgreSQL created: `table.dropUnique([], 'idx_users_email_org')`. Keep `dropIndex` for `idx_users_email`, which is a plain index. No compatibility migration or data repair is needed; the corrected migration runs from scratch.
- **Verification:** Drop and recreate a local disposable database; `knex migrate:latest` completes all 20 migrations. `knex migrate:rollback --all` then `knex migrate:latest` also succeeds.

## P1-22 — Lot create/update/void actions are not written to `audit_log`

- **Severity:** P1 · **Area:** backend / audit · **Status:** Fixed (2026-11-11, 1f2150e)
- **Evidence:** `backend/src/modules/lots/lots.routes.js:20-40` had no `auditLogger('lot')`; `backend/src/modules/lots/lots.service.js:185-212` updated the lot row without inserting an audit record. Smoke matrix row 4 voided a lot successfully, but `SELECT count(*) FROM audit_log WHERE action = 'lot.void'` returned `0`.
- **What happens:** Creating, updating, and voiding a lot changed the `lots` table with no audit trail. There was no record of who changed the lot, what the previous state was, why it was voided, or which IP made the request.
- **Real-world impact:** Lot lifecycle evidence was missing from the audit trail. A recall investigator or FDA auditor could not attribute lot changes or prove why a lot was voided, even though the smoke matrix requires lot void to remain in the audit log.
- **Fix direction:** Write `lot.create`, `lot.update`, and `lot.void` audit rows inside the same transaction as the mutation, with `organization_id`, actor, IP, `before_state`, `after_state`, and the void reason. If a caller lacks actor/IP context, the service must still require the actor id and leave IP null rather than silently dropping the audit row.
- **Verification:** Create, update, and void a lot through the API; confirm exactly one `lot.create`, `lot.update`, and `lot.void` row, each with the correct actor, `entity_type = 'lot'`, `entity_id`, IP, and before/after state. Void metadata must contain the reason. Confirm a rejected update writes no audit row.
- **Fix:** `backend/src/utils/auditTrail.js` accepts an optional Knex transaction. `backend/src/modules/lots/lots.service.js` now runs create/update/void in a transaction and writes the audit row before commit; `lots.controller.js` passes `req.user.id` and `req.ip`. No audit middleware/dual-write path.
- **Verified:** `backend/src/modules/lots/lots.audit.test.js` (4 DB tests: create, update, void, rejected update). Live API run created lot `167212ce-ff2f-4ab0-8073-c90111102449` and produced `lot.create`, `lot.update`, `lot.void` rows with actor `b0e9ee06-e1a5-42df-b121-4d569fc23406`, IP `127.0.0.1/32`, correct before/after states, and `metadata.reason = 'P1-22 live review'`.

## P1-23 — Voiding an event does not invalidate warm trace cache

- **Severity:** P1 · **Area:** backend / cache · **Status:** Fixed (2026-11-11, 192ee02)
- **Evidence:** `backend/src/modules/events/events.service.js:237-249` updated the event to `void` without touching Redis; `backend/src/modules/trace/trace.service.js:16-17,309-319` caches each lot/direction for 300 seconds. A warm full trace from lot `a35ea781-8722-4027-8a9d-19e527be3065` included event `ed62621e-9bea-42a6-a20c-f21ddf791059`; after voiding that event, the same trace returned `cached: true` and still included it.
- **What happens:** Trace queries cache forward, backward, and full graphs per starting lot. Voiding an event changes the graph (trace CTEs exclude `status = 'void'`), but the cached result is untouched. Repeating the trace within the TTL returns the old graph containing the voided event and its downstream lot.
- **Real-world impact:** A recall investigator re-running a trace after correcting or voiding a bad event sees stale results. A voided receipt or transformation still appears to move product downstream, which can widen or misdirect a recall until the cache expires.
- **Fix direction:** Invalidate forward, backward, and full cache entries for every lot linked to the voided event. Collect the linked lot ids in the void transaction and invalidate only after commit so a rolled-back void cannot evict a valid cache. Upstream starting lots remain P1-19.
- **Verification:** Warm a full trace from an input lot, void the linking event, then trace the same lot immediately without waiting for TTL. The trace must not be served from cache, must not contain the voided event's edge, and must not contain its downstream lot. Redis must have no `trace:{orgId}:{lotId}:*` keys for either linked lot. A rejected second void must leave the cache intact.
- **Fix:** `backend/src/modules/events/events.service.js` `voidEvent` now reads `event_lot_links` inside the transaction, returns unique linked lot ids, and calls `invalidateTraceCache(organizationId, lotId)` for each after the transaction commits.
- **Verified:** `backend/src/modules/events/events.void-cache.test.js` (2 DB tests with an in-memory Redis: warm trace recomputes without the voided event and clears all keys; rejected void keeps the warm cache). Live API run created input lot `1c4fdf26-a263-4a51-a930-5ea4845be823`, output lot `b084ee7d-34a6-4dd4-b1ba-ecfc67cbd15c`, and event `0af71da9-9922-4ea4-bbce-dc695b4a5db8`. Warm full trace had both lots and 1 edge; after void both `trace:{orgId}:{lotId}:*` key sets were empty, and the immediate re-trace had only the input lot and 0 edges.

## P1-24 — Event status filters return 500 (`status` is ambiguous)

- **Severity:** P1 · **Area:** backend / events · **Status:** Fixed (2026-11-11, 7f50307)
- **Evidence:** `backend/src/modules/events/events.service.js:178` applied `.where({ status })`; the event data query later left-joins `users` (`:188`), and both `events` and `users` have a `status` column. `GET /api/v1/events?status=active` returned 500 with `column reference "status" is ambiguous`.
- **What happens:** Any request that filters the event list by lifecycle status (`active`, `amended`, or `void`) fails after the filter is applied. The count query has no join and succeeds, but the data query joins `users` for the recorder name, so PostgreSQL cannot resolve the unqualified `status` reference. The validated status enum makes every allowed filter value reachable, so the entire status-filter feature is broken.
- **Real-world impact:** Org admins, compliance managers, and auditors cannot isolate active, amended, or void events from the event log. During a recall investigation, that prevents narrowing the list to the current version of events or reviewing voided history without exporting and filtering elsewhere.
- **Fix direction:** Qualify the predicate as `events.status`. Leave the other filters unchanged because their column names exist only on `events`. Add a regression test that exercises all three status values through `getEvents`, including filtered pagination totals.
- **Verification:** Seed events with `active`, `amended`, and `void` statuses plus a user whose own status is `active`; call `getEvents` with each status and confirm only matching rows are returned and `pagination.total` counts only that status. Confirm filtered pagination partitions the matching set. Call `GET /api/v1/events?status=active|amended|void` against a fresh local disposable database and confirm 200 responses with the expected rows.
- **Fix:** `backend/src/modules/events/events.service.js` `getEvents` now filters with `where('events.status', status)`, so the later `users` join cannot make the reference ambiguous.
- **Verified:** `backend/src/modules/events/events.status-filter.test.js` (4 DB tests: active, amended, void, and filtered pagination). Live API run seeded 2 events per status and returned 200 with exactly 2 rows and `pagination.total = 2` for each filter; the unfiltered list returned all 6 rows.

## P1-25 — Trace drops replacement edge when event versions share lot pairs

- **Severity:** P1 · **Area:** backend / trace · **Status:** Fixed (2026-11-11, 998f338)
- **Evidence:** `backend/src/modules/trace/trace.service.js` used `DISTINCT ON (id)` in forward and backward recursive trace queries. That kept one row per lot and discarded another active event edge when an amendment reused the same input/output lots.
- **What happens:** A trace can show an older active event edge and omit the replacement edge after an amendment with unchanged lot pairs. Nodes remain correct, but event-level trace history becomes wrong.
- **Fix:** Trace queries now deduplicate by `(lot id, event id)` while `buildTraceResult()` continues deduplicating nodes by lot id. Amended events remain excluded by `e.status = 'active'`.
- **Verification:** `trace.amended-events.test.js` covers two current events sharing one lot pair, an amendment that preserves that pair, forward/backward/full trace results, and exclusion of the amended event. The test passes.

## P1-26 — Compliance-gap email is enqueued inside the event transaction

- **Severity:** P1 · **Area:** backend / events · **Status:** Fixed (2026-11-13, aa97ef2)
- **Evidence:** `backend/src/modules/events/events.service.js:148-171` called `emailQueue.add('compliance_gap_alert', ...)` from inside `insertEvent`, which runs on the caller's transaction. The same helper served `createEvent` and `amendEvent`.
- **What happens:** The BullMQ enqueue is a network side effect inside the database transaction. If Redis or BullMQ is unavailable, the enqueue throws and the whole event rolls back even though the compliance facts were valid. The reverse is also possible: the job is accepted, the transaction later fails, and compliance managers receive an alert for an event that never existed.
- **Real-world impact:** A Redis incident blocks event recording across every tenant. A rollback after enqueue sends a false compliance-gap alert, and the alert cannot be retracted. Alert delivery and event durability are coupled when they should not be.
- **Fix direction:** Collect the gap facts inside the transaction, return them with the event, and enqueue only after commit. A queue failure must be logged and must not fail the request; the event is the compliance record, the email is best-effort.
- **Verification:** Create an event with a required KDE field missing while the queue rejects the job: the event must commit and the request must succeed. Force a transaction rollback: the queue must not be called. Amend an event with gaps: exactly one alert must be queued for the replacement id. Check the alert is not visible to another database connection before commit.
- **Fix:** `insertEvent` now returns `complianceGapAlert` and performs no queue calls. `enqueueComplianceGapAlert` (`events.service.js:179`) resolves the active `compliance_manager` recipients and enqueues after commit; `createEvent` and `amendEvent` run it in parallel with cache invalidation (`:216`, `:431`). Failures are logged with the event id and swallowed.
- **Verified:** `events.compliance-alert.test.js` (4 DB tests: one alert per manager with the event visible on another connection at enqueue time, queue rejection leaves the committed event, rollback queues nothing, amendment queues the replacement id). Full event/trace/utils/jobs/middleware run: `16 suites / 83 tests` pass.

## P1-27 — Amendment can change event type and source

- **Severity:** P1 · **Area:** backend / events · **Status:** Fixed (2026-11-13, 0bffd49)
- **Evidence:** `backend/src/modules/events/events.validation.js:37` built `amendEventSchema` as `createEventSchema.and(...)`, so every create field stayed writable on an amendment, including `eventType` and `source`. `events.service.js` then inserted the replacement with `data.eventType` and `data.source`.
- **What happens:** An amendment can turn a `receiving` event into a `transformation`, or rewrite a `scan` record as `manual`. The old row is marked `amended` and the replacement is `active`, so the visible history now claims a different event type or provenance at that chain position. Incoming links can also change shape without the original event's constraints.
- **Real-world impact:** An audit trail that can change the type of an event under the same lot history is not trustworthy. A `scan` receipt rewritten as `manual` hides that the data came from a barcode and weakens the provenance claim FSMA 204 recordkeeping relies on.
- **Fix direction:** Pin identity fields on amend. Reject an `eventType` that differs from the superseded row and copy `source` from it. Keep correctable facts (datetime, location, notes, KDE payload, links) writable, and keep `recorded_by` derived from the authenticated amend actor.
- **Verification:** Amend with a different `eventType` → rejected, no replacement, old event still `active`. Amend a `scan` event with `source: 'manual'` → replacement and stored row keep `scan`. Confirm the amend API rejects the mismatch over HTTP.
- **Fix:** `amendEvent` now rejects `data.eventType !== oldEvent.event_type` with `400 VALIDATION_ERROR` and inserts `{ ...data, source: oldEvent.source }` (`events.service.js:382-396`). `recorded_by` remains the authenticated user on the replacement.
- **Verified:** `events.amend-atomic.test.js` adds "rejects an amendment that changes the event type" and "keeps the original source instead of trusting the amend payload" (suite now 8 tests). Live API returned `400 VALIDATION_ERROR` for a type change and kept `source=scan` through a successful amendment.

## P1-28 — Event mutations lack idempotency

- **Severity:** P1 · **Area:** backend + frontend / API correctness · **Status:** Fixed (2026-11-13, 08c5818)
- **Evidence:** `backend/src/modules/events/events.routes.js` applied idempotency only to `POST /events`; void, amend, presigned attachment URL, and attachment registration routes had no idempotency middleware. `frontend/src/api/events.api.js` and `scan-pwa/src/api/events.api.js` sent no keys for those mutations.
- **What happens:** Retries after a timeout can repeat status transitions, create replacement events, generate new upload URLs, or insert duplicate attachment rows. Audit middleware can also record a repeated successful mutation.
- **Fix direction:** Reuse P0-06 middleware on every event mutation. Validate attachment bodies before fingerprinting. Generate one client key per logical mutation and reuse it for retries. Replay only the original 2xx result.
- **Fix:** Void, amend, presigned URL, and attachment registration routes now validate bodies, claim organization-scoped idempotency keys, and place audit logging after idempotency. Web and Scan PWA mutation hooks send `Idempotency-Key`; event detail, amend, and attachment flows retain keys for unchanged retries. No schema change required.
- **Verified:** `events.mutation-idempotency.test.js` covers void, amend, presigned URL, attachment registration, mismatch, failed retry, validation retry, tenant reuse, and audit replay behavior.

---

# P2 — Robustness, performance, and delivery

## P2-01 — Pagination inputs are unvalidated (`NaN`, huge limits)

- **Severity:** P2 · **Area:** backend / API robustness · **Status:** Open
- **Evidence:** `backend/src/modules/reports/reports.controller.js:5-15` (`parseInt` with no schema), `:17-26`; compare `backend/src/modules/events/events.validation.js:44-53` which does validate.
- **What happens:** `?page=abc` produces `NaN` and reaches Knex as `OFFSET NaN`, causing a 500. `?limit=1000000` is accepted, loading the entire table into memory. Negative values are also accepted. Only some modules validate query params, so behavior varies by endpoint.
- **Real-world impact:** Trivial 500s and a cheap memory/DB exhaustion vector.
- **Fix direction:** Add a shared `paginationSchema` (`page` positive int default 1, `limit` positive int max 100/200) and apply it to every list endpoint through the existing `validate` middleware. Remove ad-hoc `parseInt` from controllers. Add tests for `abc`, `0`, `-1`, and `1000000`.
- **Verification:** Invalid pagination returns 422 with field details; large limits are rejected or clamped; no endpoint returns a 500 for malformed query strings.

## P2-02 — API response pagination shape is inconsistent

- **Severity:** P2 · **Area:** frontend/backend contract · **Status:** Open
- **Evidence:** `backend/src/utils/apiResponse.js:19-21` (top-level `pagination`); `frontend/src/pages/reports/ComplianceGapsPage.jsx:72` (`data.meta`); `frontend/src/pages/recall/RecallSimulationsPage.jsx:181` (`response?.pagination`); `backend/src/modules/reports/reports.service.js:27-34` (internal key named `meta`).
- **What happens:** The backend standard is `{ data, pagination }`, but consumers variously read `meta`, `pagination`, and nested `data.pagination`. The mismatch already caused P1-05. Future endpoints will keep guessing unless the contract is enforced.
- **Real-world impact:** Silent empty tables and broken pagers — bugs that look like backend data loss.
- **Fix direction:** Standardize on the documented top-level `pagination` (per `docs/API_STANDARDS.md`). Rename the internal `meta` return in `reports.service` to `pagination` for clarity. Add a shared frontend hook (`usePagedQuery`) that reads `response.pagination` and exposes `{ rows, page, totalPages }`, then migrate every list page. Add an API contract test asserting the envelope for one endpoint per module.
- **Verification:** Every list page reads the same field; a contract test fails if an endpoint returns `meta`.

## P2-03 — Cache invalidation runs before transaction commit

- **Severity:** P2 · **Area:** backend / cache · **Status:** Open
- **Evidence:** `backend/src/modules/events/events.service.js:124-128` (inside the `db.transaction` callback, before commit); same pattern in `import-processor.js:205-210`.
- **What happens:** The cache is cleared before the new event is visible to other connections. A concurrent trace request can repopulate the cache with the pre-commit graph, and that stale value survives the commit. If the transaction rolls back, the invalidation was unnecessary (harmless, but noisy).
- **Real-world impact:** Stale trace results immediately after a write — the most likely moment for a user to check the result.
- **Fix direction:** Invalidate after commit (Knex `transaction` resolves, then call), or use the organization-level version bump from P1-19, which is naturally post-commit if incremented after the transaction returns. For imports, do the same. Add a test that writes and immediately traces with a warm cache.
- **Verification:** Warm the cache, create an event, trace immediately; the new hop is present. Force a rollback; the cache is unchanged.

## P2-04 — Trace product lookup is not organization-scoped

- **Severity:** P2 · **Area:** backend / trace · **Status:** Open
- **Evidence:** `backend/src/modules/trace/trace.service.js:249` (`db('products').whereIn('id', productIds)`), while the rest of the trace is org-filtered.
- **What happens:** Product IDs are UUIDs and therefore unlikely to collide, but the query has no `organization_id` predicate. Combined with P0-03 (foreign lot links), it is the mechanism that turns a foreign lot reference into a visible product name/SKU leak. It also weakens the "every query is tenant-scoped" invariant.
- **Real-world impact:** Currently a defense-in-depth gap; exploitable in combination with P0-03.
- **Fix direction:** Pass `organizationId` into `buildTraceResult` and add `.where({ organization_id: organizationId })` to every lookup (products, lots, locations). Add a lint/review checklist rule: every tenant table query must include an org predicate or be justified.
- **Verification:** Link a foreign lot in a test DB (before P0-03 is fixed), trace, and confirm no foreign product data appears. After P0-03, confirm the link cannot be created at all.

## P2-05 — Event list search and filters are not indexed for scale

- **Severity:** P2 · **Area:** backend / performance · **Status:** Open
- **Evidence:** `backend/src/modules/events/events.service.js:161-215` (`COUNT(*)` + `OFFSET` pagination, `event_type`/`date` filters); migrations `20240101000007_create_events.js:28-32` (single-column and `(org, type)` indexes), `20240101000008_create_event_lot_links.js:15-18`.
- **What happens:** List queries run a full `COUNT(*)` for every page and use offset pagination, which degrades linearly. A raw `(organization_id, event_datetime DESC)` index exists (`idx_events_org_datetime`), but combinations of event type, status, date range, location, and lot link can still force bitmap heap scans or extra sorts. This is fine at pilot scale but will not hold at millions of events.
- **Real-world impact:** Slow event lists and compliance reports as data grows; export jobs hold connections longer.
- **Fix direction:** Measure with `EXPLAIN ANALYZE` on realistic volumes before changing anything. Then add targeted composite indexes based on real query plans (e.g. `(organization_id, event_type, event_datetime DESC)`), switch the event list to keyset pagination (`(event_datetime, id) < cursor`), and return `total` only when explicitly requested. Add a load test with 1M synthetic events.
- **Verification:** Query plans use the intended indexes; p95 list latency stays within target at 1M rows; no sequential scans on `events` for tenant-scoped lists.

## P2-06 — Local infrastructure uses default credentials and exposed consoles

- **Severity:** P2 · **Area:** ops / dev environment · **Status:** Open
- **Evidence:** `docker-compose.yml:9-10` (`lottrace/lottrace`), `:42-43` (`minioadmin/minioadmin`), `:53-56` (`PGADMIN_DEFAULT_PASSWORD: admin123`), ports `5050`, `5540`, `9001` bound to `0.0.0.0`.
- **What happens:** All dev services use well-known credentials and expose admin consoles on every network interface. If a developer runs this on a laptop on a shared network (or a cloud VM), the database, object storage, and pgAdmin are reachable with default passwords. The seed also creates `admin@lottrace.com` / `admin123`.
- **Real-world impact:** A dev machine becomes the easiest way into production data (especially if `.env` points at Neon and the laptop is compromised).
- **Fix direction:** Read secrets from `.env` with no defaults, bind dev ports to `127.0.0.1`, and document that compose is local-only. Never reuse these credentials in staging/production. Add a startup warning if `NODE_ENV=production` and a default credential is detected. Rotate any credential that has ever been used outside local.
- **Verification:** `docker compose config` shows no hardcoded passwords; services are unreachable from another host; production boot rejects default credentials.

## P2-07 — Frontend bundle is one large chunk; no error boundaries

- **Severity:** P2 · **Area:** frontend / resilience · **Status:** Open
- **Evidence:** `frontend/src/App.jsx:30-45` (lazy routes), `:116` (plain `<div>404 Not Found</div>`); no `ErrorBoundary` in `frontend/src`.
- **What happens:** Routes are lazy-loaded, but there is no error boundary, so any render-time exception (such as P0-08) unmounts the entire app and leaves a blank screen. Vendor code is not split into stable chunks, so every deploy invalidates the main bundle. The 404 route is unstyled and offers no navigation.
- **Real-world impact:** A single bad record blanks the whole dashboard. Users cannot recover without a full reload, and the blank screen looks like a total outage.
- **Fix direction:** Add a route-level `ErrorBoundary` with a "reload / go to dashboard" fallback and report the error to Sentry. Add a proper 404 page inside the app shell. Configure `build.rollupOptions.output.manualChunks` for React, query, and UI libraries, and verify chunk sizes. Add a top-level boundary around the app as a last resort.
- **Verification:** Throw in a page component; only that route shows the fallback, navigation still works, and the error reaches Sentry. Refresh a deep link on the deployed app and get the app, not a 404.

## P2-08 — Documentation claims completion that the code does not deliver

- **Severity:** P2 · **Area:** docs / planning · **Status:** Open
- **Evidence:** `PROGRESS.md` (Phase 2 complete), `docs/FEATURE_MAP.md` (features marked built), versus P0-07/P0-08/P1-02/P1-08 in this report.
- **What happens:** The project's own status documents say features are done when they are broken or stubs. A new session (human or AI) trusts `PROGRESS.md`, skips verification, and builds on sand. This audit itself started from that claim.
- **Real-world impact:** Wrong planning, demos that fail, and fixes that get re-broken because the "done" definition was never tested.
- **Fix direction:** Update `PROGRESS.md` and `docs/FEATURE_MAP.md` to reflect verified behavior, not file existence. Link this report and use its IDs. Define "done" as: code + test + manual verification + docs. Mark each feature `Verified`, `Implemented (unverified)`, `Partial`, or `Stub`. Keep the status current at the end of every session.
- **Verification:** Every "complete" claim in the docs maps to a passing test or a checked manual step; no feature is marked complete while a P0/P1 against it is open.

## P2-09 — Attachment upload flow leaves orphaned objects

- **Severity:** P2 · **Area:** backend / storage · **Status:** Open
- **Evidence:** `backend/src/modules/events/events.service.js:270-277` (presigned URL issued), `:279-300` (row created only after upload); `frontend/src/pages/events/RecordEventPage.jsx:193-205`.
- **What happens:** A presigned URL is issued before any database row exists. If the user abandons the form, the upload fails, or the attachment row insert fails, the object stays in the bucket forever with no reference. There is no cleanup job or S3 lifecycle rule. Conversely, if the PUT succeeds but the browser crashes before `addAttachment`, the file is orphaned and the event looks attachment-free.
- **Real-world impact:** Unbounded storage growth and orphaned evidence files that cannot be found or deleted, plus a mismatch between what the user uploaded and what the audit trail records.
- **Fix direction:** Use a two-phase flow: create a `pending` attachment row when issuing the URL, mark it `uploaded` after a verified `HeadObject`, and clean up `pending` rows older than 24 hours. Add an S3 lifecycle rule to expire the `attachments/` prefix only for objects tagged `pending` (or use a `tmp/` prefix and copy on confirm). Add a delete endpoint that soft-deletes the row and removes the object after retention. Reconcile orphaned objects with a periodic job.
- **Verification:** Upload and abandon → no permanent object after the cleanup window. Upload successfully → row is `uploaded` and downloadable. Delete → object removed and audit entry written.

## P2-10 — Minor API/UX inconsistencies

- **Severity:** P2 · **Area:** frontend/backend polish · **Status:** Open
- **Evidence:** `frontend/src/App.jsx:116` (plain-text 404); `frontend/src/lib/api.js:60-75` (hard `window.location.href = '/login'` on refresh failure); `backend/src/middleware/errorHandler.js:80` (reads `process.env.NODE_ENV` directly instead of the validated `env` module); date rendering in list pages uses local time with no timezone label.
- **What happens:** Small inconsistencies accumulate into a rough product: an unstyled 404 outside the app shell, a full page reload that discards unsaved work on session expiry, config reads that bypass validation, and timestamps that auditors may misinterpret because the timezone is implicit.
- **Real-world impact:** Lower trust and support burden; timezone ambiguity is a real compliance problem when facilities span regions.
- **Fix direction:** Add an in-shell 404 page; use a router navigation (or a modal) on session expiry and preserve a return URL; read `env.NODE_ENV` everywhere; show the timezone (or an explicit "local time" label) next to timestamps in audit/compliance views. Add these to the UI review checklist.
- **Verification:** Unknown route shows the styled 404 inside the layout. Session expiry redirects without a full reload and returns to the original page after login. Audit timestamps show an explicit timezone.

## P2-11 — Expected 4xx errors are logged at ERROR level

- **Severity:** P2 · **Area:** backend / observability · **Status:** Fixed (2026-11-09, 315e54b)
- **Evidence:** `backend/src/middleware/errorHandler.js:13` logged every error with `logger.error` before mapping it, including operational `AppError` instances that carry a 4xx status code.
- **What happens:** Every expected client response — a missing record, a foreign-tenant ID, a validation failure thrown as `AppError` — writes an ERROR line with a stack trace. The response itself is correct (404/409/422); only the log level is wrong. The audit's P1-13 verification produced 9 ERROR lines for requests that were all correct 404s.
- **Real-world impact:** Error dashboards, alerts, and log searches fill with noise from normal traffic. Real 5xx failures and incidents become harder to spot, and alert thresholds either fire constantly or get muted.
- **Fix direction:** Log operational errors with `statusCode < 500` at `warn`; keep `error` for 5xx and unknown or non-operational failures. Do not change the response envelope or the status-code mapping.
- **Verification:** Unit tests assert `warn` for operational 400/401/403/404/409/422 and `error` for an operational 500 and an unknown error. A live run against a disposable local database produced two expected 404s with `WARN ... Request failed` and zero `ERROR` lines; both responses stayed `404 NOT_FOUND`.

## P2-12 — Event list pagination is unstable when `created_at` values tie

- **Severity:** P2 · **Area:** backend / API pagination · **Status:** Fixed (2026-11-10, ca4985e)
- **Evidence:** `backend/src/modules/events/events.service.js` built the `GET /events` query with `.orderBy('events.created_at', 'desc')` and no tiebreaker. `events.created_at` defaults to `CURRENT_TIMESTAMP`, which PostgreSQL evaluates once per transaction (transaction start time), so concurrent inserts can carry the same value.
- **What happens:** When several events share a `created_at`, the sort has no defined order among them. The database may return tied rows in different physical orders for different `LIMIT`/`OFFSET` values, so page 1 and page 2 can overlap or leave a row out. The order can also change between two identical requests.
- **Real-world impact:** Reviewers paging through the event list can miss events or see duplicates, and any client that aggregates pages (export, report, script) builds an incomplete history. In an audit tool this looks like data loss even when no row was deleted.
- **Fix direction:** Keep `created_at DESC` as the primary sort and add `chain_seq DESC` as a deterministic tiebreaker. `chain_seq` is unique per organization, so the pair is a total order. Do not change the response envelope or the pagination shape.
- **Verification:** `backend/src/modules/events/events.list-order.test.js` inserts five events that share one `created_at`, then asserts page 1 is `[5,4]`, page 2 `[3,2]`, page 3 `[1]`, and that the three pages contain five unique ids. The test failed before the fix (page 1 returned `[4,5]`) and passes after it. A live `GET /api/v1/events?page=N&limit=2` run against a disposable local database returned `[5,4]`, `[3,2]`, `[1]`, status 200 on every page, and no duplicate ids.

## P2-13 — `event_evidence` lacks database-level immutability enforcement

- **Severity:** P2 · **Area:** backend / database integrity · **Status:** Fixed (2026-11-11, c9473b8)
- **Evidence:** The `event_evidence` table was described as append-only, but PostgreSQL allowed direct `UPDATE` and `DELETE` operations. HMAC verification detected tampering later, but did not prevent accidental mutation.
- **What happens:** A database writer could modify or delete signed evidence rows. The verifier would detect the resulting mismatch, but the append-only invariant was not enforced at the database boundary.
- **Fix:** Migration `20240101000019_create_event_evidence.js` adds `event_evidence_immutable`, a `BEFORE UPDATE OR DELETE` trigger. It rejects every mutation except the one-time seal update that replaces `PENDING` hash placeholders on the newly inserted row.
- **Verification:** Evidence tests cover rejected update/delete operations and disable the trigger only for controlled tamper simulations. Fresh migration and rollback both pass; trigger and function exist after migration and disappear after rollback.

## P2-14 — Audit report and progress docs overstate test counts and coverage

- **Severity:** P2 · **Area:** documentation / verification · **Status:** Fixed (2026-11-11, 642d2e1)
- **Evidence:** P1-18 documentation stated `14 suites, 91 tests pass`, while the complete DB-backed run now executes 20 suites and 161 tests.
- **What happens:** Maintainers and reviewers see stale verification evidence and cannot reliably compare current test coverage with the documented result.
- **Fix:** Updated P1-18 verification text and `PROGRESS.md` to report the current run: 20 suites, 157 passed tests, and 4 skipped tests. Added missing P1-25, P2-13, and P2-14 entries to the issue table and detailed report.
- **Verification:** Full local DB-backed Jest run passes: `Test Suites: 20 passed, 20 total`; `Tests: 4 skipped, 157 passed, 161 total`. Email tests pass without hash environment variables because test fixtures now provide required hash settings.

## P2-15 — Amendment reason is stored and required as `voidReason`

- **Severity:** P2 · **Area:** backend / API contract · **Status:** Fixed (2026-11-13, 71bfa91)
- **Evidence:** `backend/src/modules/events/events.validation.js` required `voidReason` from `amendEventSchema`; `events.service.js` wrote it to `events.void_reason` and the signed evidence `reason`. The migration named the column `void_reason` on a table that also stores amendments.
- **What happens:** An amendment is not a void, but the field name says it is. Clients must send a void-named field to correct an event, the database column mislabels amendment reasons, and any future filter or report keyed on a "void reason" silently includes amendments.
- **Real-world impact:** API consumers and auditors read the wrong semantics. A recall report that lists void reasons can mix in amendment corrections, and the contract is confusing enough that the broken web amend flow (P0-07) grew around it.
- **Fix direction:** Rename the storage to a neutral `status_reason`, require `amendReason` on amendments, keep `voidReason` on voids, and keep the evidence payload key `reason` because it is already neutral. Update the verifier, the web detail view, and the docs. Greenfield: edit the original migration and reset the development database; no backfill.
- **Verification:** Amend without `amendReason` → validation error. Send `voidReason` instead → validation error. Void still requires `voidReason`. Amend and void through the API: the event row exposes `status_reason`, and the old `void_reason` field is gone. Frontend build passes. Migrate from scratch on a reset database and confirm the column name.
- **Fix:** The events migration creates `status_reason`. `amendEventSchema` requires `amendReason` and `voidEventSchema` keeps `voidReason` (`events.validation.js:38,42`). `amendEvent` writes `status_reason: data.amendReason` and signs it; `voidEvent` writes `status_reason: voidReason` (`events.service.js:319,403`). `hash-verifier.js` compares `event.status_reason`, and `EventDetailPage.jsx` reads `status_reason`. The amend form in `RecordEventPage.jsx` is left untouched because P0-07 already blocks that flow before the API call.
- **Verified:** `events.validation.test.js` (4 schema tests), full `16 suites / 83 tests` DB suite, `vite build` passes. Live API: `voidReason`-only amendment returned `422 VALIDATION_ERROR`, `amendReason` returned `201`, `GET /events/:id` returned `status_reason: "corrected quantity"` and no `void_reason`. Dev database rolled back 21 migrations, re-applied 21, and reseeded; only `status_reason` exists on `events`.

## P2-16 — `event.amend` audit row points at the superseded event

- **Severity:** P2 · **Area:** backend / audit · **Status:** Fixed (2026-11-13, c034077)
- **Evidence:** `backend/src/middleware/auditLogger.js:29` built `entityId` as `req.params.id || req.params[`${actionPrefix}Id`] || body?.data?.id`. For `POST /events/:eventId/amend` the route param wins, so the audit row pointed at the superseded event while the response contained the replacement.
- **What happens:** The audit trail records `event.amend` against the old event id. The new event has no audit row of its own, and linking the action to the replacement requires guessing from metadata or timestamps.
- **Real-world impact:** An auditor investigating the replacement event cannot find who amended it without a join back through the old event. Automation that groups audit rows by `entity_id` attributes the amendment to the wrong record.
- **Fix direction:** For `*.amend`, prefer the response's `data.id` and keep the superseded id in metadata. Leave void and every other action on the route param, which is the correct entity for them.
- **Verification:** Unit-test the middleware with a mocked audit writer: amend logs the replacement id plus `metadata.supersededEventId`, void logs the voided id, and a 4xx response logs nothing. Confirm a live amendment writes one `event.amend` row whose `entity_id` is the replacement.
- **Fix:** `auditLogger` now resolves `targetId` from the route, uses `body.data.id` for amend actions, and stores the superseded id in `metadata.supersededEventId` (`auditLogger.js:24-35`).
- **Verified:** `backend/src/middleware/auditLogger.test.js` (3 unit tests). Live API amendment wrote one `event.amend` row with `entity_id` equal to the replacement and `metadata.supersededEventId` equal to the original.

---

# Recommended fix order

Do **not** fix issues strictly by ID. The order below minimizes rework and keeps the app demoable at every step. Each batch should be planned and approved separately.

## Batch 0 — Safety rails (half a day)

1. **P1-16** seed guard (prevents wiping a shared database).
2. **P1-15** boolean env parsing.
3. **P1-13** AppError call sites.
4. **P1-20 (first slice)** test harness + CI skeleton + `frontend/vercel.json`.
5. **P1-17** TLS verification (coordinate with deployment; may need a CA bundle).

Rationale: these are low-risk, unblock testing, and remove the chance of destroying a shared database while working on everything else.

## Batch 1 — Hash chain integrity (the core claim)

1. **P0-02** add `chain_seq` and deterministic ordering (migration).
2. **P0-01** canonical hash payload shared by create/import/verifier (migration for `hash_version`).
3. **P0-11** trace excludes amended events.
4. **P1-18** HMAC + full field coverage (only after P0-01/02 are stable; requires a key-management decision).

Rationale: P0-01 and P0-02 are coupled; doing P0-01 first without deterministic ordering leaves intermittent failures that are hard to test. P1-18 changes the hash format, so it must come after the canonical serializer exists.

**No compatibility decision is needed.** Delete legacy hash support, use the canonical/keyed format only, and reset the development database.

## Batch 2 — Write-path correctness

1. **P0-03** lot organization validation inside the transaction (+ **P2-04** org-scoped product lookup).
2. **P0-04** atomic amend (transaction plumbing; depends on Batch 1's create refactor).
3. **P0-06** idempotency (client keys, expiry, fingerprint, composite uniqueness).
4. **P0-07** amend UI payload.
5. **P0-09** datetime helpers.

Rationale: P0-04 depends on the `createEvent` refactor; P0-07 is only testable after P0-04. P0-06 must precede PWA offline work.

## Batch 3 — Read-path and permissions

1. **P0-08** safe JSON parsing.
2. **P0-12** operator read access (or navigation change).
3. **P1-05 / P1-06** pagination contracts.
4. **P1-07** permission map / `/auth/me` permissions.
5. **P2-02** standardize the pagination envelope.

Rationale: these are mostly frontend and can be demoed together. P1-05/06 and P2-02 share the same contract decision.

## Batch 4 — Compliance data paths

1. **P0-10** import shipping direction (delete and re-import existing data; no repair migration).
2. **P1-01** compliance gaps on import (same worker; do it in the same change).
3. **P1-19 / P2-03** trace cache versioning and post-commit invalidation.

Rationale: P0-10 and P1-01 touch the same import code and the same tests. Cache work comes after trace semantics are final.

## Batch 5 — Reports and exports

1. **P1-02** persistent export pipeline + download.
2. **P1-03** reports RBAC/validation.
3. **P1-04** audit export (or remove the button).
4. **P2-01** pagination validation.

Rationale: building the export pipeline first gives P1-04 a real target; RBAC should wrap the final routes.

## Batch 6 — Security and lifecycle

1. **P0-05** real RLS or honest documentation (architectural; needs a maintenance window).
2. **P1-14** proxy-aware rate limiting.
3. **P1-11** refresh-token rotation race.
4. **P1-12** user lifecycle.
5. **P1-10 / P2-09** attachment security and cleanup.
6. **P1-09** PWA cache purge.

Rationale: these need deployment/config decisions and careful integration tests. P0-05 must be finished before any pilot; the rest can follow in the order that matches the release checklist.

## Batch 7 — PWA and polish

1. **P1-08** PWA lot creation, quantities, history, manual entry, offline queue (after P0-06).
2. **P2-07** error boundaries and chunking.
3. **P2-05** performance work (measure first).
4. **P2-06** dev infrastructure hardening.
5. **P2-08** documentation truth pass (do this continuously, not only at the end).

---

# How to ask for fixes in the next session

Use one issue (or one declared batch) per session. The prompts below are deliberately explicit; copy them as-is and replace the ID.

## Prompt 1 — Plan only (always start here)

```text
You are working in the LotTrace repository (the current working directory).

Before doing anything, read:
- AGENTS.md
- PROGRESS.md (status claims may be stale; trust the code and this report)
- docs/API_STANDARDS.md
- docs/CONVENTIONS.md
- docs/DATABASE_SCHEMA.md
- docs/VALIDATION_RULES.md
- docs/AUDIT_REPORT.md — read the fix protocol and the entry for <ID>.

Task: fix <ID> — <TITLE>.

This session is PLAN ONLY. Do not edit files, do not run migrations,
do not run seed, and do not change any database.

Greenfield policy:
- LotTrace is pre-production: no backward compatibility, no legacy data,
  no backfills, and no data-preserving migrations.
- Assume the development database can be dropped and recreated at any time.
- Prefer deleting obsolete columns, tables, endpoints, hash versions, and
  dead code over keeping compatibility paths.
- Keep the final invariants: tenant isolation, append-only audit trail,
  hash verification, and RBAC.

Rules:
- Fix only <ID>. If you notice another problem, report it as a new issue;
  do not fix it.
- Verify the report's evidence against the current code. Line numbers may
  have moved since the audit.
- Use a disposable local Postgres for any DB work. Never use the Neon
  DATABASE_URL from backend/.env.
- Follow repository conventions: JavaScript only, Knex or parameterized SQL,
  organization_id from the JWT, and the standard API response helpers.
- Do not propose /api/v2, dual response shapes, feature flags, or
  compatibility shims. Update the single current contract.

Give me:
1. Confirmed root cause with current file:line evidence.
2. Exact files and functions you will change, and obsolete code/schema you
   will delete.
3. Exact behavior change, including API/schema/migration impact under the
   single current contract.
4. Greenfield database plan: exact migration/schema changes, what will be
   dropped, recreated, or reset, and confirmation that no backfill,
   dual-write, or compatibility work is needed. Rollback is a code revert
   plus a dev-database reset, not data preservation.
5. Tests to add, with specific cases and exact commands. Tests build their
   own data; do not depend on seeded rows.
6. Manual verification steps.
7. Risks and anything you need me to decide.

Stop and wait for my approval. Do not write code yet.
```

## Prompt 2 — Implement after approval

```text
Approved. Implement <ID> exactly as planned.

Constraints:
- Touch only the files needed for <ID>.
- Greenfield only: no backward-compatibility code, legacy branches,
  dual-write paths, feature flags, backfills, or data-preserving migrations.
  Delete obsolete code/schema instead of keeping it.
- Add the tests we agreed on and make them pass. Tests create their own data.
- Before any database command, print the resolved database host and confirm
  it is a local disposable database, not Neon.
- Do not run migrations against Neon.
- Prefer tests that create their own data over running the seed script. If
  seed is required, run it only against the confirmed local disposable
  database.
- Run node --check on changed backend files, the agreed test command, and
  both builds if frontend or scan-pwa changed.
- Do not commit yet.
- If anything unexpected appears, stop and report it. Do not expand scope.
- After tests pass, update <ID>'s Status in docs/AUDIT_REPORT.md to
  "Fixed (commit pending)".

Show me:
- git diff --stat
- the full test output
- the manual verification checklist
```

## Prompt 3 — Verify, no commit

```text
Verify <ID> now.

1. Walk me through each manual verification step from the report.
2. Run the relevant rows of the smoke-test matrix in docs/AUDIT_REPORT.md.
3. Show the full diff and confirm no unrelated files changed.
4. Confirm the diff contains no backward-compatibility code, backfills,
   dual-write paths, legacy verifiers, feature flags, or preserved old
   columns/endpoints.
5. Confirm the schema change is clean: the original migration was edited or
   one clean migration was added, and migrate-from-scratch succeeds on a
   reset development database.
6. Report pass or fail honestly.

If everything passes:
- do not commit yet;
- tell me the exact commit message to use;
- list any new issues discovered, with proposed IDs, but do not fix them;
- do not start the next issue.

If anything fails:
- do not mark it Fixed;
- explain the root cause and propose a corrected plan;
- wait for my approval before editing again.
```

## Prompt 4 — Commit and close

Use this only after you have reviewed the diff and verification passed.

```text
I approve the verified change for <ID>.

Commit only the files for <ID> with:
fix(<ID>): <short description>

Then update <ID>'s Status in docs/AUDIT_REPORT.md to
"Fixed (<today's date>, <commit hash>)" and commit that docs update with:
docs(audit): mark <ID> fixed

Do not include unrelated files, formatting churn, or a second issue's
changes. Do not amend or rewrite earlier commits. Do not push.

Show me git log --oneline -2, git status --short, and confirm the working
tree is clean. Do not start the next issue.
```

For a declared batch, run prompts 1–4 once per issue in the order given by
this report and keep one commit per issue. Do not fold multiple issue IDs into
one commit.

## Rules that prevent "fixing one thing and breaking another"

**Greenfield is the default for every rule below:** no backward compatibility, no legacy data, no compatibility shims.

1. **One issue, one commit.** If a fix requires touching a second issue, stop and ask.
2. **Plan before code.** No exceptions, even for "obvious" one-line fixes.
3. **Read the actual file first.** Line numbers in this report are from audit day; they drift.
4. **Migrations are disposable.** Edit the original migration or add a clean one; reset the development database. No backfills or compatibility migrations.
5. **No legacy-data preservation.** Delete obsolete rows, tables, and hashes and reseed. Pre-production data is not evidence.
6. **Test the failure path,** not just the happy path (cross-tenant 404, concurrent writes, rollback).
7. **Run the smoke matrix** after every batch, not only at the end.
8. **Stop on surprises.** A new bug found mid-fix goes into this report as a new ID; it does not get folded into the current change.
9. **Do not trust `PROGRESS.md`.** Trust tests and this report until P2-08 is fixed.
10. **Update the report.** A fix without a status update will be re-audited and re-fixed.

## Definition of done (per issue)

- [ ] Plan approved before implementation.
- [ ] Code changes limited to the issue's scope.
- [ ] Automated test reproduces the bug and passes after the fix.
- [ ] `node --check` passes for changed backend files.
- [ ] Frontend build and scan-PWA build pass (when touched).
- [ ] Development database reset, migrated from scratch, and seeded (when schema changed).
- [ ] No compatibility/backfill code or dead legacy paths added.
- [ ] Cross-tenant behavior verified (when applicable).
- [ ] Manual verification completed and recorded.
- [ ] `Status` updated in this file with commit/date.
- [ ] No new P0/P1 introduced (smoke matrix passes).

---

# Smoke test matrix

Run this after every batch. Reset the development database from scratch first. Never point the smoke run at a shared staging or production database.

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Auth | Register → verify → login → refresh → logout | Tokens rotate; no family deletion on a single refresh; logout clears cookies |
| 2 | Tenant isolation | As org A, request org B's lot/event/location by ID | 404, no data, no 500 |
| 3 | RLS (after P0-05) | Connect as app role with no org set; query `lots` | 0 rows; setting org A returns only A |
| 4 | Lot lifecycle | Create product/location → create lot → view → void | Correct org; void hides from active lists but remains in audit |
| 5 | Event create | Manual creation event with 2 outputs; reverse link order | 201; links correct; hash verifier passes |
| 6 | Event amend | Amend quantity + reason | Old `amended`, new `active`, one active version, trace uses new only |
| 7 | Event void | Void with reason | Status `void`, excluded from trace, audit entry present |
| 8 | Concurrency | 20 parallel event creates for one org | `chain_seq` unique and strictly ordered; verifier passes; no duplicate chain tips |
| 9 | Idempotency | Same key twice; same key different body; expired key | One event; 409 on mismatch; expired executes |
| 10 | Trace | A→B→C forward and C→B→A backward; cache warm | Same graph both directions; no amended/void events; new hop appears immediately |
| 11 | Import | CSV with creation/receiving/transformation/shipping | Shipping links are inputs; compliance gaps computed; trace matches manual entry |
| 12 | Export | Request CSV, wait, download | File contains expected columns; notification; other org gets 404 |
| 13 | Operator flow | Operator records event → list → detail | 200/201 at every step; no 403 |
| 14 | Datetime | Record at a non-UTC timezone; reload; amend without edits | Stored instant unchanged; input shows local time |
| 15 | PWA | Scan unknown code → create lot → record quantity 12.5 → history | Works online; correct quantity; history shows the event |
| 16 | PWA offline | Offline record → online sync → logout → login as another org | Exactly one sync; no previous-org data visible offline |
| 17 | Attachments | Upload → list → download; attempt foreign key | Download matches bytes; foreign key rejected; no orphan after cleanup |
| 18 | Emails | `EMAIL_DRY_RUN=false`; invite/reset/gap alert | Real send attempted; logs do not claim dry-run |
| 19 | Errors | Notification/attachment not found | 404 with `NOT_FOUND`, never 500 |
| 20 | Deep links | Refresh `/events/:id` on deployed frontend | App loads (SPA rewrite), not a 404 |

---

# Appendix — audit coverage and limits

## Verified during the audit

- Every backend `src/**/*.js` file passes `node --check`.
- `backend/src/config/env.js` loads successfully with the current `.env` (no secrets printed).
- `frontend` production build succeeds (`vite build`, output to a temp directory).
- `scan-pwa` production build succeeds; Vite 8 / `vite-plugin-pwa` produce compatibility warnings but `sw.js` is generated.
- No test files, test runner config, CI workflows, or app Dockerfiles exist.
- The local `jsonb` behavior of `response_body` was tested against the Docker Postgres 16 instance in a rolled-back temp table.
- Local services were running (postgres, redis, minio, pgadmin, redisinsight). The Neon database was **not** contacted or modified.
- No source or config files were modified; `docs/AUDIT_REPORT.md` is the only new file. No migrations or seeds were run.

## Not covered

- No runtime penetration test, load test, or browser E2E run.
- No production/staging configuration was inspected (only the repo).
- No external provider behavior was tested (Resend, S3/R2, Neon, Vercel, BullMQ under failure).
- Import/export performance was reasoned from code, not measured.
- Accessibility and visual design were out of scope.

## Counts

- **P0:** 14
- **P1:** 27
- **P2:** 16
- **Total:** 57

> This report is a snapshot. Re-verify each issue against the current working tree before fixing it, and update the status as you go.
