# 01 — Phase 0 Summary and Phase 1 Inventory

> Read this before writing test cases. It states what exists, what does not, and where each item lives.

---

## Phase 0 — Orientation summary

### Repository state

| Fact | Value | Citation |
|---|---|---|
| Branch | `audit-fixes` | `git log --oneline -3` |
| HEAD | `38ba59f docs(audit): mark P2-05 fixed` | git |
| Backend test claim | 65 suites, 557 tests | `PROGRESS.md` |
| Frontend test claim | 58 tests | `PROGRESS.md` |
| Scan PWA test claim | 24 tests | `PROGRESS.md` |
| Development policy | Greenfield; disposable DB; no compatibility layers | `AGENTS.md` |
| Runtime stack | Node.js + Express, React + Vite, PostgreSQL, Redis, BullMQ | `AGENTS.md` |

No test was executed for this documentation pack. Everything below is read from code and migrations. Runtime-only behavior is marked `[UNVERIFIED-RUNTIME]`.

### Build-state observations

1. **API keys and webhooks tables exist but have no routes, services, or UI.**
   Migrations create `api_keys` and `webhooks` (`backend/src/db/migrations/20240101000013_create_api_keys.js:6-20`, `20240101000014_create_webhooks.js:6-21`). `backend/src/app.js:90-119` mounts no `/api-keys` or `/webhooks` module. No `backend/src/modules/api-keys/` or `webhooks/` directory exists. `docs/FEATURE_MAP.md:127-131` marks them not started. The tables are schema-only; RLS is enabled (`backend/src/db/migrations/20240101000018_add_rls_policies.js:1-12`). Manual testing is limited to direct DB inspection.

2. **Email verification is Redis-backed, not DB-backed.**
   The current migration stream adds then removes `email_verified`, `verification_otp`, and `verification_expires_at` (`20260702151000_add_email_verification_to_users.js:6-10`, `20260702181500_remove_email_verification.js:6-10`). Registration stores a pending payload in Redis for 30 minutes and returns no tokens (`backend/src/modules/auth/auth.service.js:114-131`). The frontend page `/verify-email` remains and works with the Redis flow.

3. **`super_admin` has no management surface.**
   The seed script creates one platform user with role `super_admin` and a dedicated platform organization (`backend/src/db/seed-super-admin.js:164-260`). The RBAC middleware lets `super_admin` pass every role check (`backend/src/middleware/rbac.js`). No super-admin routes or pages are mounted in `backend/src/app.js` or `frontend/src/App.jsx`.

4. **Recall simulation is synchronous.**
   `POST /api/v1/recall` creates the row as `running`, calls `fullTrace` inline, and updates to `complete` or `failed` before responding (`backend/src/modules/recall/service.js:6-58`). There is no BullMQ worker for recall despite `docs/JOBS.md` describing one. UI states for `running` are therefore transient/unreachable in normal operation `[UNVERIFIED-RUNTIME]`.

5. **Event list uses keyset pagination, all other lists use page/limit.**
   `getEventsQuerySchema` rejects `page` because the object is `.strict()` and has no `page` key (`backend/src/modules/events/events.validation.js:72-82`). The response pagination is `{ limit, hasNextPage, nextCursor }` (`backend/src/modules/events/events.service.js:258-270`).

6. **The PWA records only receiving and shipping.**
   `PWA_EVENT_TYPES = ['receiving', 'shipping']` (`scan-pwa/src/lib/recordEventPayload.js:4`). Creation and transformation are web-only.

7. **There is no API to set a lot to `recalled`.**
   The column default is `active` and the enum is documented in the migration comment (`backend/src/db/migrations/20240101000006_create_lots.js:12`), but no route writes `recalled`. `docs/DATABASE_SCHEMA.md` includes the status; only a DB fixture can create it.

8. **There is no API to deactivate a product or a user's own account.**
   Products have `is_active` but no deactivate route (`backend/src/modules/products/products.routes.js:15-35`). Users can be deactivated by an admin, not by themselves (`backend/src/modules/users/users.routes.js:44-50`, self-deactivation blocked at `users.service.js:243-245`).

---

## Phase 1 — Entity and screen inventory

### 1.1 Database tables

All tables are created under `backend/src/db/migrations/`. “RLS” means row-level security is enabled and forced.

| # | Table | Purpose | Tenant column | RLS | Migration |
|---|---|---|---|---|---|
| 1 | `organizations` | Tenant root and defaults | `id` | No | `20240101000001_create_organizations.js:6-21` |
| 2 | `users` | People and platform admin | `organization_id` | Yes | `20240101000002_create_users.js:6-24`; RLS `...018:1-27` |
| 3 | `refresh_tokens` | Rotating refresh sessions | via `user_id` | No | `20240101000003_create_refresh_tokens.js:6-23` |
| 4 | `locations` | Farms, plants, warehouses, partners | `organization_id` | Yes | `20240101000004_create_locations.js:5-29` |
| 5 | `products` | SKUs, GTIN, FTL flag, KDE schema | `organization_id` | Yes | `20240101000005_create_products.js:5-25` |
| 6 | `lots` | Traceable lot instances | `organization_id` | Yes | `20240101000006_create_lots.js:5-37` |
| 7 | `events` | Immutable CTE records | `organization_id` | Yes | `20240101000007_create_events.js:5-102` |
| 8 | `event_lot_links` | Input/output edges | `organization_id` | Yes | `20240101000008_create_event_lot_links.js:5-34` |
| 9 | `attachments` | Event files and upload state | `organization_id` | Yes | `20240101000009_create_attachments.js:5-27` |
| 10 | `audit_log` | Append-only sensitive-action trail | `organization_id` | Yes | `20240101000010_create_audit_log.js:5-31` |
| 11 | `imports` | CSV import jobs | `organization_id` | Yes | `20240101000011_create_imports.js:6-25` |
| 12 | `recall_simulations` | Mock recall runs | `organization_id` | Yes | `20240101000012_create_recall_simulations.js:6-20` |
| 13 | `api_keys` | Schema only; no code path | `organization_id` | Yes | `20240101000013_create_api_keys.js:6-20` |
| 14 | `webhooks` | Schema only; no code path | `organization_id` | Yes | `20240101000014_create_webhooks.js:6-21` |
| 15 | `notifications` | In-app messages | `organization_id` | Yes | `20240101000015_create_notifications.js:6-21` |
| 16 | `idempotency_keys` | HTTP replay protection | `organization_id` | Yes | `20240101000017_create_idempotency_keys.js:14-37` |
| 17 | `event_evidence` | Signed post-seal changes | `organization_id` | Yes | `20240101000019_create_event_evidence.js:11-76` |
| 18 | `report_exports` | Persistent export jobs | `organization_id` | Yes | `20240101000020_create_report_exports.js:10-46` |

### 1.2 Enumerations enforced in code or SQL

| Enum | Values | Enforcement | Citation |
|---|---|---|---|
| Org status | `active` (only value ever written) | default; no check constraint | `...001_create_organizations.js:12` |
| Plan tier | `starter` (only value ever written) | default | `...001_create_organizations.js:11` |
| User role | `org_admin`, `compliance_manager`, `operator`, `auditor`, `super_admin` | Zod for invites/updates excludes `super_admin` | `users.validation.js:4-10`; DB `...002:13` |
| User status | `invited`, `active`, `deactivated` | code flows | `users.service.js:116-180,243-352` |
| Location type | `farm`, `plant`, `warehouse`, `distributor`, `retailer`, `other` | Zod enum | `locations.validation.js:4-8` |
| Lot status | `active`, `recalled`, `void` | default + code writes `void`; `recalled` DB-only | `...006:12`; `lots.service.js:239-260` |
| Event type | `creation`, `receiving`, `transformation`, `shipping` | Zod enum | `events.validation.js:10` |
| Event source | `manual`, `scan`, `import`, `api` | Zod enum | `events.validation.js:13` |
| Event status | `active`, `amended`, `void` | default + amend/void flows | `...007:28`; `events.service.js:311-420` |
| Link direction | `input`, `output` | code only | `...008:10` |
| Attachment status | `pending`, `uploaded`, `deleting`, `deleted` | SQL check | `...009:21` |
| Import status | `pending`, `processing`, `complete`, `complete_with_errors`, `failed` | code writes all five; SQL comment lists four | `imports/validation.js:12`; `import-processor.js:227-233` |
| Export type | `events`, `audit` | SQL check | `...020:29` |
| Export format | `csv`, `json` | SQL check | `...020:30` |
| Export status | `queued`, `processing`, `complete`, `failed` | SQL check | `...020:32-36` |
| Notification type | `compliance_gap`, `import_complete`, `export_ready`, `recall_simulation` | free text, no check | `...015:10` |
| Audit actor type | `user`, `api_key`, `system`, `super_admin` | free text | `...010:9` |

### 1.3 Web application screens

Routes are declared in `frontend/src/App.jsx:80-117`.

| Screen | Route | Component | Primary API calls | Visible roles (UI) |
|---|---|---|---|---|
| Login | `/login` | `LoginPage` | `POST /auth/login` | Public |
| Register | `/register` | `RegisterPage` | `POST /auth/register` | Public |
| Forgot password | `/forgot-password` | `ForgotPasswordPage` | `POST /auth/forgot-password` | Public |
| Reset password | `/reset-password?token=` | `ResetPasswordPage` | `POST /auth/reset-password` | Public |
| Accept invite | `/accept-invite?token=&email=` | `AcceptInvitePage` | `POST /auth/accept-invite` | Public |
| Verify email | `/verify-email` | `VerifyEmailPage` | `POST /auth/verify-email`, `POST /auth/resend-verification` | Public |
| Dashboard | `/dashboard` | `DashboardPage` | `GET /dashboard/stats`, `/dashboard/activity` | All four org roles |
| Organization profile | `/settings` | `OrganizationPage` | `GET/PATCH /organizations/me` | All can view; admin can edit |
| Users and roles | `/settings/users` | `UsersPage` | `GET /users`, invite/update/deactivate/reactivate/resend | Admin sees actions; compliance sees list |
| Locations list | `/locations` | `LocationsListPage` | `GET/POST /locations`, `POST /:id/deactivate` | All read; admin/compliance/operator create; admin deactivate |
| Location detail | `/locations/:locationId` | `LocationDetailPage` | `GET/PATCH /locations/:id` | All read; admin/compliance edit |
| Products list | `/products` | `ProductsListPage` | `GET/POST /products` | All read; admin/compliance create |
| Product detail | `/products/:productId` | `ProductDetailPage` | `GET/PATCH /products/:id` | All read; admin/compliance edit |
| Lots list | `/lots` | `LotsListPage` | `GET/POST /lots` | All read; admin/compliance/operator create |
| Lot detail | `/lots/:id` | `LotDetailPage` | `GET/PATCH /lots/:id`, `POST /:id/void` | All read; operator edit; admin/compliance void |
| Events list | `/events` | `EventsListPage` | `GET /events`, export | All four |
| Record event | `/events/record` | `RecordEventPage` | `POST /events`, attachment calls | Admin/compliance/operator |
| Amend event | `/events/record?amendEventId=` | `RecordEventPage` | `GET /events/:id`, `POST /:id/amend` | Admin/compliance |
| Event detail | `/events/:id` | `EventDetailPage` | `GET /events/:id`, attachments, void/amend | All read; admin/compliance void/amend |
| Trace | `/trace` | `TracePage` | `GET /lots`, `/trace/:lotId/{forward,backward,full}` | All four; `?lotId=` is ignored (finding F-01) |
| Imports | `/imports` | `ImportPage` | `GET/POST /imports`, templates, errors | Admin/compliance/operator upload; auditor read. Sidebar hides the page from operators; direct URL still renders the upload card for every role |
| Compliance gaps | `/reports/compliance-gaps` | `ComplianceGapsPage` | `GET /reports/compliance-gaps` | All four |
| Export detail | `/reports/exports/:exportId` | `ExportDetailPage` | `GET /reports/exports/:id`, download | Admin/compliance |
| Recall list | `/recall` | `RecallSimulationsPage` | `GET/POST /recall`, `GET /lots` | Admin/compliance/auditor |
| Recall detail | `/recall/:id` | `RecallSimulationDetailPage` | `GET /recall/:id` | Admin/compliance/auditor |
| Audit log | `/audit` | `AuditLogPage` | `GET /audit`, audit export | Admin/compliance/auditor |
| Not found | `*` | `NotFoundPage` | none | Any authenticated |

Shared UI:

| Component | Purpose | Citation |
|---|---|---|
| `AppLayout` | Sidebar + top bar + outlet | `frontend/src/components/layout/AppLayout.jsx` |
| `Sidebar` | 12 navigation items, permission-filtered | `frontend/src/components/layout/Sidebar.jsx:12-25` |
| `ProtectedRoute` | Redirects unauthenticated users to `/login` | `frontend/src/components/layout/ProtectedRoute.jsx` |
| `NotificationBell` | Polls notifications, mark read/all read | `frontend/src/components/notifications/NotificationBell.jsx` |
| `OnboardingChecklist` | Dashboard setup checklist | `frontend/src/components/dashboard/OnboardingChecklist.jsx` |
| `DataTable` | Shared table, sorting, pagination | `frontend/src/components/common/DataTable.jsx` |
| `FormField` | Label + error wrapper | `frontend/src/components/common/FormField.jsx` |

### 1.4 Scan PWA screens

Routes are declared in `scan-pwa/src/App.jsx:122-127`.

| Screen | Route | Component | API calls | Notes |
|---|---|---|---|---|
| PWA login | `/login` | `pages/auth/LoginPage` | `POST /auth/login`, resend verification | No self-registration |
| Scan | `/scan` and `/` | `pages/ScanPage` | `GET /lots?traceabilityLotCode=`, `POST /events` | Camera, bulk mode, create lot, event form |
| History | `/history` | `pages/HistoryPage` | `GET /events` | Cursor paging, source filter |
| Manual entry | `/manual` | `pages/ManualEntryPage` | same lookup and event paths | Typed code fallback |

PWA feature components:

| Component | Purpose | Citation |
|---|---|---|
| `Scanner` | ZXing camera reader, 2-second duplicate suppression | `scan-pwa/src/features/scanner/Scanner.jsx:86-101` |
| `CreateLotForm` | Product search/select, quantity, UOM, notes | `scan-pwa/src/features/lots/CreateLotForm.jsx:16-24` |
| `QuickEventForm` | Receiving/shipping only, location, per-lot quantity | `scan-pwa/src/features/events/QuickEventForm.jsx:23-36` |
| `outbox` | IndexedDB queue keyed by org+user | `scan-pwa/src/lib/outbox.js:9-28` |
| `gs1Parser` | GS1 AI 01/10/11/17/30 parser | `scan-pwa/src/utils/gs1Parser.js:2-56` |

### 1.5 API surface

Mounted in `backend/src/app.js:90-119`. All paths below are relative to `/api/v1`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/auth/register` | Public, rate-limited | — | `auth.routes.js:11` |
| POST | `/auth/login` | Public, rate-limited | — | `auth.routes.js:12` |
| POST | `/auth/verify-email` | Public | — | `auth.routes.js:13` |
| POST | `/auth/resend-verification` | Public | — | `auth.routes.js:14` |
| POST | `/auth/refresh` | Cookie | — | `auth.routes.js:15` |
| POST | `/auth/logout` | Cookie/bearer | — | `auth.routes.js:16` |
| POST | `/auth/forgot-password` | Public | — | `auth.routes.js:17` |
| POST | `/auth/reset-password` | Public | — | `auth.routes.js:18` |
| POST | `/auth/accept-invite` | Public | — | `auth.routes.js:19` |
| GET | `/organizations/me` | Bearer | Any authenticated | `organizations.routes.js:15` |
| PATCH | `/organizations/me` | Bearer | `org_admin` | `organizations.routes.js:18` |
| GET | `/users` | Bearer | `org_admin`, `compliance_manager` | `users.routes.js:16-21` |
| POST | `/users/invite` | Bearer | `org_admin` | `users.routes.js:24-30` |
| GET | `/users/:userId` | Bearer | `org_admin`, `compliance_manager` | `users.routes.js:33` |
| PATCH | `/users/:userId` | Bearer | `org_admin` | `users.routes.js:36-42` |
| POST | `/users/:userId/deactivate` | Bearer | `org_admin` | `users.routes.js:45-50` |
| POST | `/users/:userId/reactivate` | Bearer | `org_admin` | `users.routes.js:53-58` |
| POST | `/users/:userId/resend-invite` | Bearer | `org_admin` | `users.routes.js:61-66` |
| GET | `/locations` | Bearer | Any authenticated | `locations.routes.js:15-18` |
| POST | `/locations` | Bearer | `org_admin`, `compliance_manager`, `operator` | `locations.routes.js:21-25` |
| GET | `/locations/:locationId` | Bearer | Any authenticated | `locations.routes.js:28` |
| PATCH | `/locations/:locationId` | Bearer | `org_admin`, `compliance_manager` | `locations.routes.js:31-35` |
| POST | `/locations/:locationId/deactivate` | Bearer | `org_admin` | `locations.routes.js:38-41` |
| GET | `/products` | Bearer | Any authenticated | `products.routes.js:15-18` |
| POST | `/products` | Bearer | `org_admin`, `compliance_manager` | `products.routes.js:21-25` |
| GET | `/products/:productId` | Bearer | Any authenticated | `products.routes.js:28` |
| PATCH | `/products/:productId` | Bearer | `org_admin`, `compliance_manager` | `products.routes.js:31-35` |
| GET | `/lots` | Bearer | Any authenticated | `lots.routes.js:15-18` |
| POST | `/lots` | Bearer | `org_admin`, `compliance_manager`, `operator` | `lots.routes.js:21-25` |
| GET | `/lots/:lotId` | Bearer | Any authenticated | `lots.routes.js:28` |
| PATCH | `/lots/:lotId` | Bearer | `org_admin`, `compliance_manager`, `operator` | `lots.routes.js:31-35` |
| POST | `/lots/:lotId/void` | Bearer | `org_admin`, `compliance_manager` | `lots.routes.js:38-42` |
| POST | `/events` | Bearer + `Idempotency-Key` | `org_admin`, `compliance_manager`, `operator` | `events.routes.js:24-30` |
| GET | `/events` | Bearer | All four org roles | `events.routes.js:39-44` |
| GET | `/events/:eventId` | Bearer | All four | `events.routes.js:46-50` |
| GET | `/events/:eventId/attachments` | Bearer | All four | `events.routes.js:32-37` |
| POST | `/events/:eventId/void` | Bearer + idempotency | `org_admin`, `compliance_manager` | `events.routes.js:52-59` |
| POST | `/events/:eventId/amend` | Bearer + idempotency | `org_admin`, `compliance_manager` | `events.routes.js:61-68` |
| POST | `/events/:eventId/attachments/presigned-url` | Bearer + idempotency | `org_admin`, `compliance_manager`, `operator` | `events.routes.js:70-76` |
| POST | `/events/:eventId/attachments` | Bearer + idempotency | `org_admin`, `compliance_manager`, `operator` | `events.routes.js:78-84` |
| GET | `/attachments/:attachmentId/download` | Bearer | All four | `backend/src/app.js:97-104` |
| DELETE | `/attachments/:attachmentId` | Bearer | `org_admin`, `compliance_manager` | `backend/src/app.js:105-112` |
| GET | `/trace/:lotId/forward` | Bearer | All four | `trace.routes.js:14-19` |
| GET | `/trace/:lotId/backward` | Bearer | All four | `trace.routes.js:21-26` |
| GET | `/trace/:lotId/full` | Bearer | All four | `trace.routes.js:28-33` |
| GET | `/audit` | Bearer | `org_admin`, `compliance_manager`, `auditor` | `audit.routes.js:14-19` |
| GET | `/reports/compliance-gaps` | Bearer | All four | `reports.routes.js:16-21` |
| POST | `/reports/export` | Bearer | `org_admin`, `compliance_manager` | `reports.routes.js:24-31` |
| GET | `/reports/exports/:exportId` | Bearer | `org_admin`, `compliance_manager` | `reports.routes.js:33-38` |
| GET | `/reports/exports/:exportId/download` | Bearer | `org_admin`, `compliance_manager` | `reports.routes.js:40-46` |
| GET | `/imports` | Bearer | Any authenticated | `imports/routes.js:34-37` |
| POST | `/imports` | Bearer, multipart | `org_admin`, `compliance_manager`, `operator` | `imports/routes.js:49-55` |
| GET | `/imports/:id` | Bearer | Any authenticated | `imports/routes.js:40` |
| GET | `/imports/:importId/errors` | Bearer | Any authenticated | `imports/routes.js:43-46` |
| GET | `/imports/template/:cteType` | Bearer | Any authenticated | `imports/routes.js:28-31` |
| POST | `/recall` | Bearer | `org_admin`, `compliance_manager` | `recall/routes.js:12-17` |
| GET | `/recall` | Bearer | `org_admin`, `compliance_manager`, `auditor` | `recall/routes.js:19-24` |
| GET | `/recall/:id` | Bearer | `org_admin`, `compliance_manager`, `auditor` | `recall/routes.js:26-30` |
| GET | `/dashboard/stats` | Bearer | All four | `dashboard/routes.js:10-14` |
| GET | `/dashboard/activity` | Bearer | All four | `dashboard/routes.js:16-20` |
| GET | `/notifications` | Bearer | Any authenticated | `notifications.routes.js:15-19` |
| PATCH | `/notifications/read-all` | Bearer | Any authenticated | `notifications.routes.js:21-24` |
| PATCH | `/notifications/:id/read` | Bearer | Any authenticated | `notifications.routes.js:26-30` |
| GET | `/health` | Public | — | `backend/src/app.js:84-86` |

### 1.6 Business-rule inventory

| # | Rule | Citation | Tested in |
|---|---|---|---|
| R1 | Tenant id comes only from JWT; body cannot override it | `backend/src/middleware/tenantScope.js`, `AGENTS.md` rule 9 | `20_auth_roles.md` §5 |
| R2 | Cross-tenant IDs return 404, never 403 | `backend/src/middleware/tenantScope.js`; services use `organization_id` in every lookup | `20_auth_roles.md` §5 |
| R3 | Event input/output shape depends on event type | `events.validation.js:19-44` | `15_events.md` §6 |
| R4 | Receiving requires a location | `events.validation.js:41-43` | `15_events.md` §6 |
| R5 | Shipping and receiving must have zero outputs | `events.validation.js:35-40` | `15_events.md` §6 |
| R6 | Events are immutable; corrections create a superseding event | `events.service.js:311-420`; `docs/PRD.md:345` | `15_events.md` §9 |
| R7 | Event hashes form a per-org chain ordered by `chain_seq` | `...007_create_events.js:54-62`; `utils/hashChain.js` | `15_events.md` §11 |
| R8 | `chain_seq` is unique per org and positive | `...007_create_events.js:57-62` | `90_coverage_matrix.md` |
| R9 | Event can be superseded only once | unique partial index `...007:66-70` | `15_events.md` §9 |
| R10 | TLC unique per org+product among non-void lots | partial unique index `...006:32-37` | `14_lots.md` §5 |
| R11 | Lot quantity must be positive | `lots.validation.js:7,14` | `14_lots.md` §4 |
| R12 | Void lot cannot be updated; recalled lot cannot be updated | `lots.service.js:181-184` | `14_lots.md` §6 |
| R13 | Voiding an already-void lot returns `LOT_VOIDED` | `lots.service.js:240-242` | `14_lots.md` §6 |
| R14 | Duplicate location name requires GLN, address line 1, or city | `locations.service.js:13-31` | `12_locations.md` §5 |
| R15 | Duplicate product name requires a distinct SKU | `products.service.js:13-27` | `13_products.md` §5 |
| R16 | KDE field name must be snake_case | `products.validation.js:5` | `13_products.md` §4 |
| R17 | Required product KDEs missing from an event create compliance gaps | `events/compliance.js:9-38` | `15_events.md` §10 |
| R18 | Invited email cannot self-register | `auth.service.js:83-95` | `11_users_auth.md` §4 |
| R19 | Email is globally unique, case-insensitive | `...20260702172631:14-16` | `11_users_auth.md` §4 |
| R20 | Invite expires after 72 hours; reset token after 1 hour | `users.service.js:104-105`; `auth.service.js:408-421` | `11_users_auth.md` §7 |
| R21 | Last org admin cannot be demoted or deactivated | `users.service.js:206-218,262-270` | `11_users_auth.md` §9 |
| R22 | Admin cannot change own role or deactivate self | `users.service.js:198-201,243-245` | `11_users_auth.md` §9 |
| R23 | Import groups rows by `transaction_id`; one event per group | `import-processor.js:144-175`; `import-event.js:16-27` | `17_imports.md` §5 |
| R24 | Import is idempotent per org+transaction | `import-event.js:17-27` | `17_imports.md` §5 |
| R25 | Transformation import needs input and output rows | `import-processor.js:162-175` | `17_imports.md` §6 |
| R26 | Trace cache TTL 5 minutes, versioned per org | `trace.service.js:6,17-40` | `16_trace.md` §6 |
| R27 | Trace caps recursion at 50 hops | `trace.service.js:7` | `16_trace.md` §7 |
| R28 | Export limit 1,000,000 rows or 512 MiB | `export-format.js:5-8` | `18_reports_audit.md` §4 |
| R29 | Audit log is append-only and tenant-scoped | `...010:5-31`; `audit.service.js:13-31` | `18_reports_audit.md` §6 |
| R30 | Idempotency key length 1–255 and only 2xx responses are stored | `...017:28-37` | `15_events.md` §8 |
| R31 | PWA offline records are scoped to org+user | `scan-pwa/src/lib/outbox.js:23-28` | `11_users_auth.md` §11 |
| R32 | PWA retries 401/408/429 but parks other 4xx | `scan-pwa/src/lib/outbox.js:37-42` | `11_users_auth.md` §11 |

### 1.7 Entity coverage map

| Entity | Records in pack | Primary file |
|---|---|---|
| Organizations | 6 | `10_organizations.md` |
| Users | 33 generated + 1 seeded super admin | `11_users_auth.md` |
| Locations | 17 | `12_locations.md` |
| Products | 17 | `13_products.md` |
| Lots | 25 | `14_lots.md` |
| Events | 22 rows + `EVT-012` void operation (23 lifecycle records) | `15_events.md` |
| Attachments | 6 | `15_events.md` §12 |
| Imports | 10 jobs from 10 CSV fixtures | `17_imports.md`, `40_import_files.md` |
| Recall simulations | 5 | `19_recall.md` |
| Report exports | 6 | `18_reports_audit.md` |
| Notifications | 8 | `18_reports_audit.md` §7 |
| Audit entries | generated by actions above | `18_reports_audit.md` §6 |

Counts are deliberately above the requested minimum of 5 organizations and 5–10 users per organization.

---

## Phase 1 exit criteria

- [x] Every mounted backend module identified.
- [x] Every web and PWA route identified.
- [x] Every database table identified.
- [x] Every enum and status identified with enforcement location.
- [x] Role gate identified for every endpoint.
- [x] Known schema-only and unreachable features flagged.
- [x] Documentation mismatches queued for `99_discrepancies_and_findings.md`.
