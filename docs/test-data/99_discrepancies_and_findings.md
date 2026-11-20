# 99 — Discrepancies, Findings, and Open Questions

> Code is the source of truth. This file records every place where the code disagrees with the docs, the UI disagrees with the API, or a rule is unreachable.
> Nothing here was fixed. No source, config, or database file was changed.

---

## 1. How to read this file

| Field | Meaning |
|---|---|
| ID | `F-xx` finding, `Q-xx` open question |
| Severity | **P1** blocks a core promise or creates a compliance hole. **P2** visible wrong behavior or misleading docs. **P3** polish or testability. |
| Evidence | `path/to/file:line` from the current branch |
| Impact | What a tester sees, or what a customer would hit |
| Test consequence | How the bible handles it, and what to assert until it is fixed |

Severity is about user impact, not effort.

---

## 2. Summary

| Severity | Count | Themes |
|---|---|---|
| P1 | 7 | Dead recall deep link, API/UI permission inversions, missing audit rows for primary records, imports discard KDEs |
| P2 | 12 | Unreachable states, dead filter, missing notifications, weak password policy, no list filters, stale docs |
| P3 | 6 | Comment drift, coercion edges, schema-only modules |
| Open questions | 7 | Product decisions that block a test oracle |

The most important finding is **F-05**: creating an event writes no audit row. Event creation is the product's primary evidentiary act. The hash chain still protects the event, but the audit log cannot answer "who recorded this event and when" beyond `events.recorded_by` and `created_at`.

---

## 3. P1 findings

### F-01 — Recall "View Full Trace Tree" link is dead

**Evidence:** `frontend/src/pages/recall/RecallSimulationDetailPage.jsx:54` links to `/trace?lotId=${sim.triggering_lot_id}`. `frontend/src/pages/trace/TracePage.jsx:51` initializes `selectedLotId` to `''` and the page never reads `useSearchParams`.

**Impact:** A compliance manager clicks the main action on a recall result and lands on an empty trace screen. The simulation already computed the tree; the link cannot show it.

**Test consequence:** `E2E-10` step 6 asserts "no lot selected". `19_recall.md` marks the link broken. Until fixed, testers must copy the lot id and select it manually.

---

### F-02 — Compliance managers can void a lot by API but the UI hides the button

**Evidence:** `backend/src/modules/lots/lots.routes.js:38-39` allows `org_admin` and `compliance_manager`. `frontend/src/pages/lots/LotDetailPage.jsx:140` gates the menu item on `can('org_admin')`. The permission map gives compliance `lots.*` (`frontend/src/hooks/usePermissions.js:5-6`), so the API is the only way.

**Impact:** Two roles with the same backend permission get different capabilities. A compliance manager cannot correct a bad lot from the UI, which is the role most likely to own a recall correction.

**Test consequence:** `E2E-06` step 9 voids by API as compliance and records the missing UI control. `90_coverage_matrix.md` rule 13 covers both paths.

---

### F-03 — Operator API permissions exceed the UI in two places

**Evidence:**
- `backend/src/modules/locations/locations.routes.js:21-22` allows `operator` to `POST /locations`. `usePermissions.js:22-31` gives operators no `locations.create`, and `LocationsListPage.jsx:206` hides `Add Location`.
- `backend/src/modules/imports/routes.js:49-50` allows `operator` to upload imports. The operator permission list has no `imports.*`, so the sidebar hides the page, but a direct visit renders the full upload card.

**Impact:** The backend is broader than the product matrix in `docs/PRD.md:107,112`. An operator who bookmarks `/imports` can upload. The UI gives no hint this is allowed.

**Test consequence:** `20_auth_roles.md` §10 records "No UI, API yes" for operator locations. For imports, test both the sidebar state and a direct URL. Do not assert a 403 for either.

**Decision needed:** either grant the UI permissions or tighten the routes. Pick one, then update both.

---

### F-04 — Auditor sees the import upload card, then gets 403

**Evidence:** `frontend/src/App.jsx:111` mounts `/imports` with no role guard. `frontend/src/pages/imports/ImportPage.jsx:293-356` renders the upload card with no `can()` check. `backend/src/modules/imports/routes.js:49-50` denies `auditor`.

**Impact:** A read-only auditor is invited to upload a file, then receives `403 Insufficient permissions to access this resource`. This is the clearest UI/API contradiction in the app.

**Test consequence:** `E2E-09` step 6 says "list visible; no upload card controls usable" — that is the **intended** state, not the current one. Change the assertion to "upload card visible; upload returns 403" until fixed.

---

### F-05 — Event creation writes no audit row

**Evidence:** `backend/src/modules/events/events.routes.js:24-30` mounts `POST /events` without `auditLogger`. Only void (`:57`) and amend (`:66`) use it. `events.service.js` never calls `writeAuditLog` on create.

**Impact:** The audit log shows `event.void` and `event.amend` but not the creation of the event being voided. An investigator cannot prove who introduced a record, from which IP, or through which route. `events.recorded_by` is the only attribution.

**Test consequence:** `E2E-01` step 14 and `E2E-12` step 13 assert the absence. `18_reports_audit.md` §6 lists only the actions that exist. Do not invent an `event.create` row.

**Recommended fix:** mount `auditLogger('event')` on create. The middleware already derives `event.post`; rename it to `event.create` for readability.

---

### F-06 — Master-data and recall changes write no audit row

**Evidence:** `auditLogger` is mounted only in `users.routes.js`, `events.routes.js` (void/amend), `imports/routes.js`, and `reports.routes.js`. No mount exists in `locations.routes.js`, `products.routes.js`, `organizations.routes.js`, or `recall/routes.js`. Lots use explicit `writeAuditLog` (`lots.service.js:52,201,256`).

**Impact:** Creating a location, editing a product's KDE schema, renaming the organization, and running a recall leave no trace. KDE schema changes alter future compliance-gap computation, so this is a real evidentiary gap.

**Test consequence:** `18_reports_audit.md` §6 action inventory stops at the implemented set. `19_recall.md` step 10 asserts no recall row.

---

### F-07 — Imports silently discard KDE columns, so imported events can create gaps

**Evidence:** `backend/src/jobs/workers/import-event.js:99` builds `kdePayload: {}` and `:119` writes `kde_payload: JSON.stringify({})`. The processor never reads product KDE columns from the CSV. `events/compliance.js` then compares required KDEs against an empty object.

**Impact:** A CSV that contains `harvest_date` still produces an event with a compliance gap if the product requires `harvest_date`. `IMP-001` against a KDE-bearing product demonstrates this. The user cannot fix it through the import; they must amend the event in the UI.

**Test consequence:** `40_import_files.md` §5 documents the expected gaps. `IMP-002`/`IMP-006` use products without required KDEs so their gap counts stay 0. The optional `OPT-kde_gap_creation.csv` exists to prove the behavior.

**Decision needed:** either accept KDE columns in the import contract or reject CSVs that contain them. Silently dropping a compliance field is the worst option.

---

## 4. P2 findings

### F-08 — `user.role_change` audit filter can never match

**Evidence:** `frontend/src/pages/audit/AuditLogPage.jsx:164` offers `Role Changed`. The backend derives actions from HTTP method: `PATCH /users/:id` produces `user.patch` (`backend/src/middleware/auditLogger.js:21`; `users.routes.js:36-41`). No code writes `user.role_change`.

**Impact:** A tester selects the only role-related filter and gets an empty list after changing a role. It looks like audit logging is broken.

**Test consequence:** `E2E-02` step 7 and `E2E-09` step 4 assert `user.patch`. `50_search_filter.md` §3.5 records the zero result.

**Fix:** change the preset value to `user.patch` and label it "User Updated", or emit `user.role_change` when the `role` field changes.

---

### F-09 — Attachment add and download are not audited; delete is

**Evidence:** `POST /events/:eventId/attachments` and `GET /attachments/:id/download` have no `auditLogger` (`events.routes.js:70-84`; `app.js:97-112`). Delete is audited inside the service (`events.service.js:591-600`, action `attachment.delete`).

**Impact:** Evidence can be attached and exported without a trail, but its removal is recorded. That asymmetry weakens the evidence story.

**Test consequence:** `15_events.md` §11 lists only `attachment.delete` as audited.

---

### F-10 — `products.is_active` exists but nothing can set it

**Evidence:** `backend/src/modules/products/products.validation.js:23-31` has no `isActive` field. `products.routes.js` has no deactivate route. The column and list filter exist (`products.service.js:74-77`), but every product stays active.

**Impact:** A discontinued SKU cannot be hidden. `GET /products?isActive=false` always returns zero. The UI has no control.

**Test consequence:** `50_search_filter.md` §3.2 asserts `isActive=false` returns 0. `13_products.md` treats all fixtures as active.

---

### F-11 — A lot can never enter `recalled` through the API

**Evidence:** `updateLotSchema` accepts only `notes` and `quantity` (`backend/src/modules/lots/lots.validation.js:12-15`). `status` appears only in the **list filter** (`:25`). `voidLot` writes `void`; recall simulation never writes lot status (`recall/service.js:6-59`).

**Impact:** `recalled` is a database-only state. A mock recall does not mark the triggering lot recalled. The `LOT_RECALLED` update block is reachable only for seeded rows.

**Test consequence:** `14_lots.md` seeds LOT-005 as recalled. `E2E-06` step 4 uses the seed. Do not claim a recall simulation changes lot status.

**Decision needed:** should a completed recall set `recalled` on affected lots? If yes, add an endpoint and an audit action.

---

### F-12 — Inactive locations are accepted by event creation when the UUID is supplied

**Evidence:** `backend/src/modules/events/events.service.js:63-67` looks up `locations` by `id` and `organization_id` only. It does not filter `is_active`. Deactivation only flips the flag (`locations.service.js:193-204`).

**Impact:** The web form lists active locations, so a UI user cannot pick LOC-005. An API or PWA caller with a cached UUID can record new events against a closed site.

**Test consequence:** `12_locations.md` NEG cases cover the API path. `E2E-11` step 11 proves cross-tenant rejection but not inactive rejection.

**Fix:** add `is_active: true` to the lookup, or document that historical sites must remain usable.

---

### F-13 — Deactivated locations vanish from the UI with no way to list them

**Evidence:** `listLocations` defaults to `is_active: true` when `isActive` is absent (`locations.service.js:82-87`). The list page has search and type only (`LocationsListPage.jsx:56-62`). No `isActive` toggle exists.

**Impact:** After deactivation, LOC-005 is unreachable from the UI. Its detail URL still works, but there is no path back to it. Same pattern for products if F-10 is ever fixed.

**Test consequence:** `50_search_filter.md` §3.1 uses the API for inactive queries. UI tests assert LOC-005 is absent.

---

### F-14 — `recall_simulations.result_storage_key` is never written

**Evidence:** declared at `backend/src/db/migrations/20240101000012_create_recall_simulations.js:13` with the comment "full result in S3". No other reference exists in `backend/src`.

**Impact:** Dead column. Large trace results are still stored inline in `result_summary`, which is fine for current sizes but means the documented design is not implemented.

**Test consequence:** `02_field_registry.md` §12 marks it internal-only. Do not test an S3 artifact.

---

### F-15 — Recall lot picker silently caps at 50 lots

**Evidence:** `frontend/src/pages/recall/RecallSimulationsPage.jsx:39` calls `useGetLots({ limit: 50 })` with no status filter and no pagination. The select renders whatever comes back.

**Impact:** In an org with more than 50 lots, a user cannot select lot 51+, and the missing lots are not explained. Void and recalled lots consume slots.

**Test consequence:** `50_search_filter.md` §3.8 records the cap. ORG-001 has 11 lots, so the cap is invisible until a larger tenant is seeded.

**Fix:** reuse the trace lot picker pattern (server-side search) or add a "load more" control.

---

### F-16 — Login page handles an error code the API no longer emits

**Evidence:** `frontend/src/pages/auth/LoginPage.jsx:39-55` special-cases `EMAIL_NOT_VERIFIED` and navigates to `/verify-email`. `auth.service.js:134-146` filters `status: 'active'` and returns `INVALID_CREDENTIALS` for everything else. Pending signups live only in Redis (`auth.service.js:126`). The email-verification columns were removed by `20260702181500_remove_email_verification.js`.

**Impact:** The "Please verify your email address" panel is unreachable. A user who registered but never verified gets the generic `Invalid credentials`, which is confusing but not a security bug.

**Test consequence:** `20_auth_roles.md` §6 marks the panel dead. Assert the generic error.

---

### F-17 — Password policy is length-only

**Evidence:** `backend/src/modules/auth/auth.validation.js:7,24,39` and `users.validation` use `z.string().min(8)` with no complexity rule.

**Impact:** `password123` is accepted. For a compliance product, this may fail a customer's security review.

**Test consequence:** `20_auth_roles.md` uses `LotTrace!Test2026` for realism, and includes `password123` as a **valid** boundary case. Do not assert a complexity error.

**Decision needed:** raise the policy. If changed, update every fixture password and the `11_users_auth.md` table.

---

### F-18 — Two notification types have no producer rows

**Evidence:** The bell maps `compliance_gap` and `recall_simulation` (`frontend/src/components/notifications/NotificationBell.jsx:21,29`). Compliance gaps enqueue an **email** only (`events.service.js:169-187`). Recall writes no notification (`recall/service.js`). The `notifications` table is written by import completion (`import-processor.js:257`), export success/failure, and hash verification failure.

**Impact:** A recall never lights the bell. A compliance gap sends email but no in-app message. `NTF-008` in `18_reports_audit.md` is a hand-seeded row used to prove the renderer, not a generated one.

**Test consequence:** `18_reports_audit.md` §7 labels NTF-008 as a DB fixture. `E2E-10` step 9 asserts no notification.

---

### F-19 — The events list has no filter controls despite a full filter API

**Evidence:** `backend/src/modules/events/events.validation.js:72-82` supports `eventType`, `status`, `source`, `locationId`, `lotId`, `dateFrom`, `dateTo`. `frontend/src/pages/events/EventsListPage.jsx` renders only the table and pager; there is no filter `Select` or date `Input`.

**Impact:** A user cannot narrow the event list in the UI. Auditors must use the audit page or the API. This is the largest feature gap between backend and frontend after F-01.

**Test consequence:** `50_search_filter.md` §2 lists every event filter as API-only. UI tests assert the absence.

---

## 5. P3 findings

### F-20 — Import status comment omits `complete_with_errors`

**Evidence:** `backend/src/db/migrations/20240101000011_create_imports.js:12` comments `pending | processing | complete | failed`. The code writes `complete_with_errors` (`import-processor.js:227-233`; `imports/validation.js:12`).

**Impact:** A reader trusting the schema comment builds the wrong enum. No runtime effect.

**Test consequence:** `17_imports.md` documents all five. `01_inventory.md` §1.2 notes the drift.

---

### F-21 — `FEATURE_MAP.md` says API keys and webhooks are not started, but their migrations exist

**Evidence:** `docs/FEATURE_MAP.md:127-132` marks 3.1, 3.2, 3.5, 3.6 as unbuilt. `backend/src/db/migrations/20240101000013_create_api_keys.js` and `...014_create_webhooks.js` exist. No routes or workers are mounted.

**Impact:** "Not started" is directionally right for behavior but wrong for schema. A tester may look for tables and find them.

**Test consequence:** `01_inventory.md` §1.1 and `02_field_registry.md` §17 treat them as schema-only. `90_coverage_matrix.md` §7 marks them "None".

---

### F-22 — `RBAC.md` disagrees with the code in three places

**Evidence:**
- `docs/RBAC.md:43` says operators cannot create/edit a location. The API allows `POST /locations` for operators (`locations.routes.js:21-22`).
- `docs/RBAC.md:50` says operators cannot upload a CSV. The API allows it (`imports/routes.js:49-50`).
- `docs/RBAC.md:55` shows auditors with read-only export. The API denies auditors `POST /reports/export` (`reports.routes.js:24-31`).

**Impact:** A QA engineer writing tests from `RBAC.md` will assert the wrong status codes.

**Test consequence:** `20_auth_roles.md` §10 is the authoritative matrix and calls out the drift.

---

### F-23 — `PRD.md` disagrees with the code on operator imports and auditor exports

**Evidence:** `docs/PRD.md:112` marks bulk import as admin/compliance only; the API allows operators. `docs/PRD.md:114` marks export as allowed for auditors; the API denies them. `docs/PRD.md:107` denies operators location management; the API allows create.

**Impact:** Same as F-22. The PRD reads like a stricter product than the code implements.

**Test consequence:** Tests follow `20_auth_roles.md`, not the PRD matrix.

---

### F-24 — Numeric coercion accepts scientific notation and can overflow the offset

**Evidence:** `z.coerce.number()` accepts `limit=1e2` as 100. `page=999999999999999999999` becomes `1e21`; `paginate` multiplies it into an offset far beyond bigint range (`pagination.js:39-43`).

**Impact:** `limit=1e2` is harmless. The huge page is likely a `500` from PostgreSQL rather than a `422`, but this was not executed. Marked `[UNVERIFIED-RUNTIME]`.

**Test consequence:** `50_search_filter.md` `QRY-03`/`QRY-04` record the coercion behavior and the unverified outcome.

---

### F-25 — No endpoint returns `204`

**Evidence:** `apiResponse.noContent` exists (`utils/apiResponse.js:31-33`), and `docs/API_STANDARDS.md:116` defines `204` for delete. No route calls it. Attachment delete returns `200`.

**Impact:** Cosmetic drift between the standard and the implementation. Clients must not assume `204`.

**Test consequence:** `90_coverage_matrix.md` §4.1 records "None found".

---

## 6. Behaviors that look wrong but are intentional

Do not file these as bugs.

| Behavior | Why it is correct | Citation |
|---|---|---|
| Cross-tenant ids return `404`, not `403` | Do not confirm existence | `AGENTS.md`; every service scopes by `organization_id` |
| No hard deletes | Records stay linked to events and audit | void/deactivate flows |
| Unknown audit filter returns `200` with an empty list | Filters are not resource lookups | `audit.service.js:13-32` |
| Any org user can download another user's export | Exports are org-scoped, not user-scoped | `reports.service.js:9-141` |
| Duplicate import is silently skipped | Idempotency is by `import_<org>_<transaction_id>` | `import-event.js:17-27` |
| `limit=1e2` works | `z.coerce.number()` accepts numeric strings | `pagination.js:4-5` |
| Dashboard week count is 0 for June 2026 fixtures | The window is "last 7 days" from the real clock | `dashboard/service.js` |
| An amended event still appears in exports | Originals are evidence, not deleted | `15_events.md` §8 |
| Resend verification returns `429` right after signup | TTL guard blocks resends while `ttl > 780` | `auth.service.js:256-270` |
| A voided event still appears in the list | Status is visible; history is preserved | `15_events.md` §9 |

---

## 7. Open questions

| ID | Question | Why it blocks a test oracle | Current behavior |
|---|---|---|---|
| `Q-01` | Should an import accept product KDE columns? | Decides whether `IMP-001` gaps are a defect or expected | Discarded (`import-event.js:99`) |
| `Q-02` | Should event creation be audited? | Decides whether `E2E-01` step 14 is a failure | No row |
| `Q-03` | Should a recall simulation mark affected lots `recalled`? | Decides whether `LOT_RECALLED` is testable end to end | No status change |
| `Q-04` | Should operators keep location-create and import-upload? | Decides which side to change in F-03 | API allows, UI hides |
| `Q-05` | Should inactive locations stay selectable for backdated events? | Decides F-12's fix | Accepted by UUID |
| `Q-06` | Should auditors ever see the import upload card? | Decides F-04's fix | Visible, then 403 |
| `Q-07` | Is `compliance_manager` allowed to void lots? | Decides F-02's fix | API yes, UI no |

---

## 8. Test-suite impact

| File | Impacted assertions | Action taken in the bible |
|---|---|---|
| `18_reports_audit.md` | Audit action inventory, `user.role_change` filter, recall notification | Lists only implemented actions; marks the dead preset |
| `19_recall.md` | Deep link, notification, audit | Asserts broken link, no notification, no audit |
| `20_auth_roles.md` | Route matrix vs UI | Matrix follows the API; UI mismatches marked |
| `30_scenarios_e2e.md` | E2E-02, E2E-06, E2E-09, E2E-10, E2E-14 | Asserts current behavior and labels the finding |
| `40_import_files.md` | KDE gaps, status counts | Gap counts assume empty KDE payloads |
| `50_search_filter.md` | Events UI filters, coercion | Filters marked API-only; coercion recorded |
| `90_coverage_matrix.md` | Rules 13, 37, 40, 46 | Rule text matches code |

---

## 9. Suggested fix order

1. **F-05 + F-06** — audit event creation and master-data changes. Highest compliance value, lowest risk.
2. **F-01** — read `lotId` in `TracePage`, or pass state from the recall page.
3. **F-02, F-03, F-04** — pick one permission source and align UI and API.
4. **F-07** — decide the import KDE contract before more import fixtures are written.
5. **F-08** — fix the dead audit preset.
6. **F-10, F-11** — add product deactivation and lot recall transitions, or remove the dead columns/filters from the docs.
7. **F-19** — add event filters. The API is already done.
8. **F-12, F-13, F-15** — inactive-location handling and lot-picker search.
9. **F-16, F-17** — login copy and password policy.
10. **F-20…F-25** — doc and comment cleanup.

---

## 10. Corrections made during verification

These were wrong in earlier drafts of this bible and are now fixed:

| Item | Earlier claim | Verified fact |
|---|---|---|
| Operator lot edit | UI hides it | UI shows `Edit Details` because the menu is gated on `events.create` (`LotDetailPage.jsx:128`) |
| Compliance void lot | UI hides it | Confirmed: gated on `can('org_admin')` (`LotDetailPage.jsx:140`) |
| `limit=1e2` | `422` | Accepted as 100 |
| `dateFrom` without millis | `422` | Accepted by `z.string().datetime()` |
| `dateFrom` with `+00:00` | Accepted | `422`; only `Z` is accepted |
| Import status migration comment | Lists all five | Lists four; code writes five |
| Recall deep link | "Unverified" | Confirmed broken by code read |
| Event count | "23 persisted" | 22 rows plus one void operation |

---

## 11. Sign-off

| Gate | Result |
|---|---|
| Every finding cites a file and line | Pass |
| No source, config, or database file modified | Pass |
| Findings separated from intentional behavior | Pass |
| Runtime-unverified claims marked | Pass |
| Fixture IDs in findings exist in the record tables | Pass |
