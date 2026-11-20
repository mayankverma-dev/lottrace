# 90 — Coverage Matrix

> Proof that the bible covers every table, field, screen, endpoint, and business rule, and an honest list of what cannot be tested from the UI.

Coverage legend: **Full** = every field and state has at least one test. **Partial** = fields covered, some runtime behavior unverified. **None** = documented but not exercisable.

---

## 1. Headline numbers

| Dimension | Count | Covered | Coverage |
|---|---|---|---|
| Database tables | 18 | 16 exercisable, 2 schema-only | Partial |
| Columns | 228 | 228 documented; 190+ exercised through API/UI | Full documentation, Partial runtime |
| Web screens/routes | 26 | 26 | Full |
| PWA screens | 4 | 4 | Full |
| API mount points | 63 | 63 | Full |
| Roles | 6 | 4 human roles testable; `api_key`/`super_admin` limited | Partial |
| Organizations | 6 | 6 | Full |
| Users | 33 + seeded super admin | 34 | Full |
| Negative-case IDs | 320 | — | — |
| Other test IDs (AUTH, OPS, SEC, QRY, PAG, ISO, FLT, NTF-T, REC-T, CHK) | 162 | — | — |
| Import fixtures | 11 CSV files | 11 | Full |
| E2E scenarios | 14 | 14 | Full |

Counts come from `02_field_registry.md` §19, `App.jsx:80-117`, `scan-pwa/src/App.jsx:123-163`, and the route files. Re-count after any schema or route change.

---

## 2. Entity coverage

| # | Table | Columns | Primary API | Fixture file | Field registry | Runtime tests | Status |
|---|---|---|---|---|---|---|---|
| 1 | `organizations` | 12 | `/organizations/me` | `10_organizations.md` | §1 | ORG-001…006; settings PATCH; slug read-only | Full |
| 2 | `users` | 18 | `/users`, `/auth/*` | `11_users_auth.md` | §2 | 33 users; invite/accept/reset/deactivate | Full |
| 3 | `refresh_tokens` | 12 | `/auth/refresh`, `/logout` | `20_auth_roles.md` | §3 | Rotation, reuse, family delete, logout | Partial — expiry paths need clock control |
| 4 | `locations` | 16 | `/locations` | `12_locations.md` | §4 | 17 rows; CRUD, deactivate, duplicates | Full |
| 5 | `products` | 13 | `/products` | `13_products.md` | §5 | 17 rows; KDE builder, duplicates | Full |
| 6 | `lots` | 15 | `/lots` | `14_lots.md` | §6 | 25 rows; TLC reuse, boundaries, void | Full |
| 7 | `events` | 22 | `/events` | `15_events.md` | §7 | 22 rows; 4 CTEs; amend/void; hash | Full |
| 8 | `event_lot_links` | 8 | nested in events | `15_events.md` | §8 | Inputs/outputs across 22 events | Full |
| 9 | `attachments` | 14 | `/events/:id/attachments`, `/attachments/:id` | `15_events.md` §11 | §9 | 6 fixtures; upload/add/list/download/delete | Partial — S3 presign needs live storage |
| 10 | `audit_log` | 13 | `/audit` | `18_reports_audit.md` | §10 | Filter matrix; action inventory | Full |
| 11 | `imports` | 14 | `/imports` | `17_imports.md`, `40_import_files.md` | §11 | 10 jobs; all statuses; 11 files | Partial — worker crash paths |
| 12 | `recall_simulations` | 10 | `/recall` | `19_recall.md` | §12 | 5 rows; summary math; failed/running states | Partial — `running` only by SQL |
| 13 | `notifications` | 9 | `/notifications` | `18_reports_audit.md` | §13 | 8 baseline rows; read semantics | Full |
| 14 | `idempotency_keys` | 8 | event POST headers | `15_events.md` §12 | §14 | Replay, conflict, cross-user key | Full |
| 15 | `event_evidence` | 9 | none (internal) | `15_events.md` §13 | §15 | Void/amend evidence rows | Partial — verify through SQL |
| 16 | `report_exports` | 13 | `/reports/export`, `/reports/exports/:id` | `18_reports_audit.md` | §16 | 6 rows; all statuses; download | Full |
| 17 | `api_keys` | 10 | none mounted | `01_inventory.md` | §17 | Schema only | None |
| 18 | `webhooks` | 12 | none mounted | `01_inventory.md` | §17 | Schema only | None |

### 2.1 Side tables and enums

| Item | Covered in |
|---|---|
| `locations.type` enum (6) | `12_locations.md` |
| `products.custom_kde_schema` types (4) | `13_products.md` |
| `lots.status` enum (3) | `14_lots.md` |
| `events.event_type` enum (4) | `15_events.md` |
| `events.status` enum (3) | `15_events.md` |
| `events.source` enum (4) | `15_events.md` |
| `imports.status` enum (5) | `17_imports.md` |
| `users.role` enum (6) | `20_auth_roles.md` |
| `users.status` enum (3) | `11_users_auth.md` |
| `notifications.type` UI map (5) | `18_reports_audit.md` |
| `attachments.status` (`pending`, `uploaded`, `deleted`) | `15_events.md` §11 |

---

## 3. Screen coverage

### 3.1 Web app (26 routes)

| Route | Screen | Roles | States tested | File |
|---|---|---|---|---|
| `/login` | Login | public | success, bad password, unverified dead panel, rate limit | `20_auth_roles.md` §6 |
| `/register` | Register | public | success, duplicate, invited, validation | `20_auth_roles.md` §4 |
| `/verify-email` | OTP | public | correct, wrong, expired, resend block | `20_auth_roles.md` §5 |
| `/forgot-password` | Request reset | public | known/unknown email | `20_auth_roles.md` §7 |
| `/reset-password` | Set password | public | valid/expired/reused token | `20_auth_roles.md` §7 |
| `/accept-invite` | Accept invite | public | valid, wrong email, expired | `20_auth_roles.md` §8 |
| `/dashboard` | Dashboard | all | populated, empty, checklist 0–4 | `18_reports_audit.md` §3 |
| `/settings` | Organization settings | admin edit; others read | read, edit, validation, super-admin | `10_organizations.md` |
| `/settings/users` | Users & Roles | admin/compliance | invite, edit role, deactivate, reactivate, resend, pager | `11_users_auth.md`, `20_auth_roles.md` §9 |
| `/locations` | Locations list | all read; create admin/compliance/operator API | search, type filter, empty, inactive | `12_locations.md` §3 |
| `/locations/:id` | Location detail | all read; edit admin/compliance | view, edit, deactivate, not found | `12_locations.md` §4 |
| `/products` | Products list | all read | search, empty, KDE badges | `13_products.md` §3 |
| `/products/:id` | Product detail | all read; edit admin/compliance | view, edit, KDE builder, not found | `13_products.md` §4 |
| `/lots` | Lots list | all read | search, empty, pager | `14_lots.md` §3 |
| `/lots/:id` | Lot detail | all read; edit admin/compliance/operator API | edit, void, status blocks, trace link | `14_lots.md` §4 |
| `/events` | Events list | all read | cursor pager, empty, export menu, badges | `15_events.md` §3 |
| `/events/record` | Record event | admin/compliance/operator | 4 CTE forms, validation, KDE, attachments, idempotency | `15_events.md` §4 |
| `/events/:id` | Event detail | all read | lifecycle, links, attachments, hash, void/amend | `15_events.md` §5–§9 |
| `/trace` | Trace | all | forward/backward/full, empty, deep chain, cache | `16_trace.md` |
| `/imports` | Bulk import | read all; upload admin/compliance/operator | upload, template, statuses, errors, empty | `17_imports.md` §3 |
| `/reports/compliance-gaps` | Compliance gaps | all | rows, empty, error | `18_reports_audit.md` §4 |
| `/reports/exports/:id` | Export detail | admin/compliance | queued/processing/complete/failed, download | `18_reports_audit.md` §5 |
| `/recall` | Recall list + dialog | admin/compliance; auditor read | empty, create, validation, pager | `19_recall.md` §3 |
| `/recall/:id` | Recall detail | admin/compliance; auditor read | complete/failed/running, missing | `19_recall.md` §4 |
| `/audit` | Audit log | admin/compliance/auditor | filters, empty, denied, export | `18_reports_audit.md` §6 |
| `*` | Not found | authenticated | any unknown path | `01_inventory.md` |

`/dashboard` is the index redirect (`App.jsx:91`). `SettingsLayout` has only two children, so there is no billing page despite `docs/RBAC.md` listing one.

### 3.2 Scan PWA (4 routes)

| Route | Screen | States tested | File |
|---|---|---|---|
| `/` and `/scan` | Scanner | camera, manual fallback, lot found, not found, create lot, bulk, error | `30_scenarios_e2e.md` E2E-12 |
| `/manual` | Manual entry | lookup, unknown, create lot, event form, offline | E2E-12 |
| `/history` | History | list, empty, offline | E2E-12 |
| `/login` | PWA login | success, failure | E2E-12 |

The PWA has no registration, password reset, settings, or import screens.

### 3.3 Modals and dialogs

| Dialog | File |
|---|---|
| Create Location | `12_locations.md` §3.2 |
| Deactivate Location confirmation | `12_locations.md` §3.4 |
| Create/Edit Product + KDE builder | `13_products.md` §3.2 |
| Create Lot | `14_lots.md` §3.2 |
| Void Lot | `14_lots.md` §7 |
| Void Event | `15_events.md` §9 |
| Amend Event | `15_events.md` §8 |
| Add Attachment | `15_events.md` §11 |
| Invite User | `20_auth_roles.md` §9 |
| Edit Role | `20_auth_roles.md` §9 |
| Deactivate/Reactivate user confirmations | `11_users_auth.md` |
| Run Simulation | `19_recall.md` §3.1 |
| Import Errors | `17_imports.md` §3.4 |
| Notification panel | `18_reports_audit.md` §7 |

---

## 4. API coverage

| Module | Mount | Endpoint declarations | Covered in |
|---|---|---|---|
| Auth | `/api/v1/auth` | 9 | `20_auth_roles.md` §2 |
| Organizations | `/api/v1/organizations` | 2 | `10_organizations.md` |
| Users | `/api/v1/users` | 7 | `11_users_auth.md`, `20_auth_roles.md` |
| Locations | `/api/v1/locations` | 5 | `12_locations.md` |
| Products | `/api/v1/products` | 4 | `13_products.md` |
| Lots | `/api/v1/lots` | 5 | `14_lots.md` |
| Events + attachments | `/api/v1/events` | 8 + 2 app-level | `15_events.md` |
| Trace | `/api/v1/trace` | 3 | `16_trace.md` |
| Reports | `/api/v1/reports` | 4 | `18_reports_audit.md` |
| Audit | `/api/v1/audit` | 1 | `18_reports_audit.md` |
| Imports | `/api/v1/imports` | 5 | `17_imports.md` |
| Recall | `/api/v1/recall` | 3 | `19_recall.md` |
| Dashboard | `/api/v1/dashboard` | 2 | `18_reports_audit.md` |
| Notifications | `/api/v1/notifications` | 3 | `18_reports_audit.md` |

Total: 61 router declarations plus 2 app-level attachment routes = 63 mount points. Each has at least a success case and a role-denial case. Query-parameter coverage is in `50_search_filter.md`.

### 4.1 Response-shape coverage

| Shape | Endpoints | File |
|---|---|---|
| Standard `{ success, message, data }` | most | `00_README_INDEX.md` §6 |
| Paginated `{ ..., pagination }` | 10 modules | `00_README_INDEX.md` §6 |
| Keyset | events | `15_events.md` §3.3 |
| `202` accepted | export create | `18_reports_audit.md` §5.3 |
| `204` no content | none found | — |
| Error codes | `VALIDATION_ERROR`, `NOT_FOUND`, `AUTH_FORBIDDEN`, `AUTH_REQUIRED`, `DUPLICATE_ENTRY`, `EVENT_IMMUTABLE`, `LOT_VOIDED`, `LOT_RECALLED`, `EMAIL_IN_USE`, `EMAIL_INVITED`, `EMAIL_DEACTIVATED`, `EXPORT_NOT_READY`, `EXPORT_FAILED`, `EXPORT_QUEUE_UNAVAILABLE`, `IMPORT_INVALID_FORMAT`, `RATE_LIMITED`, `INVALID_TOKEN`, `USER_INVALID` | all files |

---

## 5. Business-rule coverage

| # | Rule | Citation | Test |
|---|---|---|---|
| 1 | Organization id only from JWT | `middleware/tenantScope.js` | E2E-11 |
| 2 | Cross-tenant path id returns 404 | services | E2E-11 |
| 3 | Email globally unique, case-insensitive | `20260702172631_enforce_global_unique_email.js:15` | `NEG-AUTH-*`, E2E-02 |
| 4 | Invite TTL 72 h | `users.service.js:140-143` | `AUTH-I02` |
| 5 | Reset token TTL 1 h, single use | `auth.service.js:386-410` | `AUTH-P05`–`P07` |
| 6 | OTP 6 digits, 30 min | `auth.service.js:45-56,113-118` | `AUTH-V01`–`V03` |
| 7 | Access token 30 min, refresh 7 d | `auth.service.js:58-72` | `SEC-06`–`SEC-08` |
| 8 | Refresh reuse >10 s kills family | `auth.service.js:311-329` | `SEC-07` |
| 9 | Deactivation blocks the next request | `users.service.js:272-273`; `authenticate.js:51-67` | E2E-02 |
| 10 | Last admin cannot be demoted/deactivated | `users.service.js:203-214,259-270` | E2E-02 |
| 11 | Location duplicate rule | `locations.service.js:13-31` | `12_locations.md` §5 |
| 12 | Location deactivate soft only | `locations.service.js:193-204` | `12_locations.md` §4.4 |
| 13 | Product duplicate requires distinct SKU | `products.service.js:13-27` | `13_products.md` §5 |
| 14 | KDE name snake_case | `products.validation.js:5` | `13_products.md` §5 |
| 15 | One active lot per product + TLC | `20240101000006_create_lots.js` | E2E-06 |
| 16 | Lot quantity >0, decimal(15,4) | `lots.validation.js:7`; migration | E2E-06 |
| 17 | Void lot blocks edit/void | `lots.service.js:182,240-242` | E2E-06 |
| 18 | Recalled lot blocks edit | `lots.service.js:183` | E2E-06 |
| 19 | CTE input/output shape | `events.validation.js:19-44` | `15_events.md` §6 |
| 20 | Receiving requires location | `events.validation.js:41-44` | `15_events.md` §6 |
| 21 | Shipping has no outputs | `events.validation.js:35-37` | `15_events.md` §6 |
| 22 | Amend cannot change type | `events.service.js:311-430` | E2E-04 |
| 23 | Amend/void require active | `events.service.js:152-230` | E2E-04, E2E-05 |
| 24 | Hash chain seals after links | `events.service.js:61-140` | `15_events.md` §13 |
| 25 | Void/amend evidence signed | `event_evidence` | `15_events.md` §13 |
| 26 | Idempotency key per org | `20240101000017_create_idempotency_keys.js` | `15_events.md` §12 |
| 27 | Trace uses active events only | `trace.service.js:228-270` | `16_trace.md` §8 |
| 28 | Trace MAX_HOPS 50 | `trace.service.js` | `16_trace.md` §7 |
| 29 | Trace cache key/version/TTL | `trace.service.js` | `16_trace.md` §9 |
| 30 | Compliance gap per product KDE | `events/compliance.js` | `15_events.md` §10 |
| 31 | Gap email only to compliance managers | `events.service.js:169-187` | `15_events.md` §10 |
| 32 | Import required columns | `import-processor.js:21-26` | `17_imports.md` §4 |
| 33 | Import direction by CTE | `import-direction.js:6-33` | `40_import_files.md` §6 |
| 34 | Import group transaction semantics | `import-processor.js:162-205` | `IMP-007`, `IMP-010` |
| 35 | Import idempotency | `import-event.js:17-27` | `CHK-IMP-09` |
| 36 | Import error report JSON | `import-processor.js:213-222` | `17_imports.md` §7.4 |
| 37 | Export roles and formats | `reports.routes.js`; `reports.validation.js` | E2E-08 |
| 38 | Export size limit | `export-format.js:5-8` | `18_reports_audit.md` §5.5 |
| 39 | Download presign TTL 300 s | `reports.service.js:9,129-137` | `OPS-RPT-03` |
| 40 | Audit action/entity/actor filters | `audit.service.js:13-32` | `50_search_filter.md` §3.5 |
| 41 | Audit append-only, no delete | `20240101000010_create_audit_log.js` | `18_reports_audit.md` §11 |
| 42 | Recall name/lot validation | `recall/validation.js:5-7` | `19_recall.md` §5 |
| 43 | Recall summary math | `recall/service.js:23-51` | `19_recall.md` §7 |
| 44 | Notification own/org-wide visibility | `notifications.service.js:7-12` | `NTF-T04`–`T05` |
| 45 | Notification read ownership | `notifications.service.js:21-33` | `NTF-T07` |
| 46 | Notification types generated by workers | `import-processor.js:247-263`; `reports/reports.notifications.js:34-50` | `18_reports_audit.md` §7 |
| 47 | RLS policies per tenant | `20240101000018_add_rls_policies.js`, `20260629000000_add_phase2_rls_policies.js` | E2E-11 |
| 48 | Rate limits | `rateLimiter.js:69-134` | `20_auth_roles.md` §11 |
| 49 | File type/size limits | `imports/routes.js:13-23`; events attachment config | `17_imports.md` §8; `15_events.md` §11 |
| 50 | Server-side RBAC on every route | route files | `20_auth_roles.md` §10 |

All 50 rules have at least one positive and one negative test. Rules 27, 28, 37, 38, 40, 48, and 50 have multiple.

---

## 6. Cross-file traceability

| Concern | Primary file | Also covered in |
|---|---|---|
| Conventions, reset, quality gates | `00_README_INDEX.md` | — |
| Entity/screen inventory and phase summary | `01_inventory.md` | `90_coverage_matrix.md` |
| Every column and API mapping | `02_field_registry.md` | entity files |
| Fixture graph, ids, ordering, time anchors | `03_design_notes.md` | `40_import_files.md` §1 |
| Tenancy and user state | `10_organizations.md`, `11_users_auth.md` | `20_auth_roles.md` |
| Master data | `12_locations.md`, `13_products.md` | `14_lots.md` |
| Supply-chain facts | `14_lots.md`, `15_events.md` | `16_trace.md` |
| Investigation | `16_trace.md` | `19_recall.md`, E2E-03 |
| Bulk ingestion | `17_imports.md` | `40_import_files.md` |
| Reporting and security trail | `18_reports_audit.md` | E2E-08, E2E-09 |
| Mock recall | `19_recall.md` | E2E-10 |
| Access control | `20_auth_roles.md` | E2E-14 |
| Whole-system journeys | `30_scenarios_e2e.md` | all |
| Query behavior | `50_search_filter.md` | all list screens |
| Findings | `99_discrepancies_and_findings.md` | cited inline everywhere |

---

## 7. What is documented but not runtime-tested

| Area | Why | What to do |
|---|---|---|
| `api_keys` table and API-key principal | No mounted routes | Schema review only; treat as unbuilt |
| `webhooks` table and dispatcher | No mounted routes or worker | Schema review only; treat as unbuilt |
| `super_admin` tenant scope | Seed row may lack `organizationId` | Create a row with an org, or call only platform routes `[UNVERIFIED-RUNTIME]` |
| S3/R2 presigned PUT | Needs live bucket and CORS | Run `OPS` attachment tests in a real environment |
| Email delivery | Needs SMTP/provider | Read OTP/reset links from worker logs or Redis |
| Redis outage | Destructive to local state | Run in an isolated dev stack |
| Clock-dependent token expiry | Needs fake timers or DB edits | Use direct `refresh_tokens.expires_at` updates in dev |
| Worker crash mid-import | Needs process kill | Observe `processing` row and retry behavior |
| RLS enforcement independent of app | Needs a DB role without `BYPASSRLS` | Connect as the app role, not the owner |
| Audit hash tamper detection | Requires DB update | Run in disposable DB; verify `hash.verify_failed` notification |
| Export >1,000,000 rows | Expensive | Assert limit handling only in a disposable environment |
| Trace 50-hop truncation | Needs a 50+ hop synthetic chain | Build with a script in dev |

`[UNVERIFIED-RUNTIME]` markers in entity files correspond to this table. No test claims a runtime result that was not read from code.

---

## 8. Sign-off checklist

| Gate | Check | Result |
|---|---|---|
| G1 | Every table in `02_field_registry.md` has an entity file or an explicit schema-only note | Pass |
| G2 | Every route in `App.jsx` and `scan-pwa/src/App.jsx` appears in §3 | Pass |
| G3 | Every mounted API module appears in §4 | Pass |
| G4 | Every business rule in §5 has a citation and a test id | Pass |
| G5 | Every fixture id referenced in a scenario exists in a record table | Pass |
| G6 | Counts agree across `03_design_notes.md`, `40_import_files.md`, entity files | Pass after the `B0`/`B1` split |
| G7 | No real personal data; all emails on reserved example domains | Pass |
| G8 | No source, config, or database file modified while writing the bible | Pass |
| G9 | Discrepancies recorded instead of silently normalized | Pass |
