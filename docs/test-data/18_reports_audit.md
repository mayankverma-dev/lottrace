# 18 — Dashboard, Reports, Audit Log, Notifications

> Entities: `report_exports`, `audit_log`, `notifications`; read-only aggregates over other tables.
> Screens: `/` (Dashboard), `/reports/compliance-gaps`, `/reports/exports/:exportId`, `/audit`, notification bell in the app header.
> API: `GET /dashboard/stats`, `GET /dashboard/activity`, `GET /reports/compliance-gaps`, `POST /reports/export`, `GET /reports/exports/:exportId`, `GET /reports/exports/:exportId/download`, `GET /audit`, `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.

---

## 1. Purpose and prerequisites

The dashboard summarizes counts. Compliance gaps lists events missing required product KDEs. Exports write CSV or JSON to object storage. The audit log is the append-only security trail. Notifications are per-user or org-wide messages.

| Rule | Value | Citation |
|---|---|---|
| Dashboard read roles | All four org roles | `dashboard/routes.js:10-20` |
| Gaps read roles | All four org roles | `reports/reports.routes.js:16-21` |
| Export roles | `org_admin`, `compliance_manager` | `reports/reports.routes.js:24-31` |
| Export formats | `csv`, `json`; default `csv` | `reports/reports.validation.js:9-19` |
| Export types | `events`, `audit` | `reports/reports.validation.js:9-19` |
| Export limit | 1,000,000 rows or 512 MiB | `workers/export-format.js:5-8` |
| Download URL TTL | 300 seconds | `reports/reports.service.js:9,129-137` |
| Export queue failure | `503`, code `EXPORT_QUEUE_UNAVAILABLE`, message `Export queue unavailable` | `reports/reports.service.js:82-93` |
| Audit read roles | `org_admin`, `compliance_manager`, `auditor` | `audit/audit.routes.js:14-19` |
| Audit filters | `action`, `entityType`, `entityId`, `actorId` | `audit/audit.validation.js:4-16` |
| Notifications | Any authenticated role; own rows plus org-wide | `notifications/notifications.routes.js:11-30` |
| Notification types in UI | `compliance_gap`, `import_complete`, `export_ready`, `export_failed`, `recall_simulation` | `NotificationBell.jsx:19-34` |

Create users, locations, products, lots, events, imports, and exports before testing these screens.

---

## 2. Record set

### 2.1 Exports (`report_exports`)

6 baseline exports. There is no export list screen; open `/reports/exports/<id>` directly. `rowCount` for events equals the number of persisted event rows in the organization. `EXP-003` filters `action=event.void`, so its rowCount is 1 (the `EVT-012` void operation). `EXP-006` has no filter, so its row count equals all ORG-005 audit rows and is run-dependent.

| ID | Org | Type | Format | Filters | Status | rowCount | Requested by | Download file |
|---|---|---|---|---|---|---|---|---|
| `EXP-001` | ORG-001 | events | csv | `{}` | complete | 12 | USR-003 | `lottrace-events-<uuid>.csv` |
| `EXP-002` | ORG-001 | events | json | `{}` | complete | 12 | USR-001 | `lottrace-events-<uuid>.json` |
| `EXP-003` | ORG-001 | audit | csv | `{"action":"event.void"}` | complete | 1 | USR-004 | `lottrace-audit-<uuid>.csv` |
| `EXP-004` | ORG-002 | events | csv | `{}` | complete | 2 | USR-011 | `lottrace-events-<uuid>.csv` |
| `EXP-005` | ORG-005 | events | json | `{}` | complete | 2 | USR-028 | `lottrace-events-<uuid>.json` |
| `EXP-006` | ORG-005 | audit | csv | `{}` | complete | variable | USR-028 | `lottrace-audit-<uuid>.csv` |

A `failed` export cannot be requested through the UI on purpose. To produce one, stop Redis/queue and request an export: the row is written as `failed` with `error='Failed to queue export'`, then the API returns `503` (`reports/reports.service.js:76-93`). The response does not return the row id; read it from `report_exports` in the disposable dev database. Mark this `[DB-INSPECT]`.

### 2.2 Audit log baseline

Exact rows depend on which fixture steps ran. The actions below are the only writers found in code.

| Action | Written by | Entity type | Citation |
|---|---|---|---|
| `user.invite` | Invite route middleware | `user` | `users/users.routes.js:24-30`; `auditLogger.js:29` |
| `user.patch` | User update route middleware (role/name/status changes) | `user` | `users/users.routes.js:35-42`; `auditLogger.js:21` |
| `user.deactivate` | Deactivate route middleware | `user` | `users/users.routes.js:44-50`; `auditLogger.js:24` |
| `user.reactivate` | Reactivate route middleware | `user` | `users/users.routes.js:52-58`; `auditLogger.js:25` |
| `user.resend_invite` | Resend route middleware | `user` | `users/users.routes.js:60-66`; `auditLogger.js:26` |
| `event.void` | Void route middleware | `event` | `events/events.routes.js:52-58`; `auditLogger.js:22` |
| `event.amend` | Amend route middleware; entity id is the replacement event | `event` | `events/events.routes.js:60-67`; `auditLogger.js:37-42` |
| `lot.create` | Lot service | `lot` | `lots/lots.service.js:56` |
| `lot.update` | Lot service | `lot` | `lots/lots.service.js:205` |
| `lot.void` | Lot service | `lot` | `lots/lots.service.js:256` |
| `attachment.delete` | Event service | `attachment` | `events/events.service.js:596` |
| `import.post` | Import upload middleware | `import` | `imports/routes.js:48-55`; `auditLogger.js:21` |
| `report.export` | Export request middleware | `report` | `reports/reports.routes.js:24-31`; `auditLogger.js:28` |
| `report.download` | Export download middleware | `report` | `reports/reports.routes.js:40-46`; `auditLogger.js:27` |
| `hash.verify_failed`, `hash.verify_completed` | Hash verifier worker | `event` | `workers/hash-verifier.js:270-318` |

There is **no** `event.create`, `location.*`, `product.*`, `organization.*`, `recall.*`, or `notification.*` audit row. Confirm in §9. This is a finding for `99_discrepancies_and_findings.md`.

The UI filter preset `user.role_change` does **not** match the actual action `user.patch`. Selecting it returns an empty list. Finding.

### 2.3 Notifications

Notifications are generated by workers. Counts are flow-dependent. These 8 are the baseline rows to verify; every non-empty import also creates one `import_complete` row, so more rows are normal.

| ID | Org | user_id | Type | Title | Message (after substitution) | Link | Read |
|---|---|---|---|---|---|---|---|
| `NTF-001` | ORG-001 | USR-007 | `import_complete` | `Import completed with errors` | `Your creation CSV import "<epoch_ms>_IMP-002_creation_errors.csv" completed with errors. 1 rows imported, 3 errors.` | `/imports` | no |
| `NTF-002` | ORG-001 | USR-005 | `import_complete` | `Import failed` | `Your shipping CSV import "<epoch_ms>_IMP-004_shipping_errors.csv" failed. 0 rows imported, 3 errors.` | `/imports` | no |
| `NTF-003` | ORG-001 | USR-003 | `export_ready` | `Export ready` | `Your CSV event export is ready to download (12 rows).` | `/reports/exports/<EXP-001>` | yes |
| `NTF-004` | ORG-001 | USR-001 | `export_ready` | `Export ready` | `Your JSON event export is ready to download (12 rows).` | `/reports/exports/<EXP-002>` | no |
| `NTF-005` | ORG-002 | USR-011 | `export_ready` | `Export ready` | `Your CSV event export is ready to download (2 rows).` | `/reports/exports/<EXP-004>` | no |
| `NTF-006` | ORG-005 | USR-030 | `import_complete` | `Import failed` | `Your transformation CSV import "<epoch_ms>_IMP-010_transformation_prairie_errors.csv" failed. 0 rows imported, 1 errors.` | `/imports` | yes |
| `NTF-007` | ORG-005 | USR-028 | `export_ready` | `Export ready` | `Your JSON event export is ready to download (2 rows).` | `/reports/exports/<EXP-005>` | no |
| `NTF-008` | ORG-001 | null (org-wide) | `compliance_gap` | `Compliance gap detected` | `Event requires KDE "Harvest Date".` | `/events/<EVT-013>` | no |

`NTF-008` is a **DB fixture** (`[DB-FIXTURE]`): no code inserts a `compliance_gap` row into `notifications`. Compliance gap alerts go to the email queue, not this table (`events/events.service.js:169-187`). The bell renders the icon for `compliance_gap`, so the fixture proves the UI path.

`recall_simulation` notifications are never created: the recall service inserts no notification row (`recall/service.js:6-59`). The bell supports the type, but the producer is missing. Finding.

---

## 3. Screen: `/` — Dashboard

Header `Dashboard`; subtitle `Overview of your LotTrace supply chain activities.` (`DashboardPage.jsx:27-30`).

### 3.1 Stat cards

| UI Label | API Field | Definition | Citation |
|---|---|---|---|
| Active Lots | `activeLots` | Lots with `status='active'` | `dashboard/service.js:4` |
| Locations | `activeLocations` | Locations with `is_active=true` | `dashboard/service.js:5` |
| Products | `activeProducts` | Products with `is_active=true` | `dashboard/service.js:6` |
| Compliance Gaps | `openComplianceGaps` | Events with `has_compliance_gaps=true` **and** `status='active'` | `dashboard/service.js:16-18` |

The card label `Locations` means active locations only, and `Products` means active products only. There is no card for users or total events.

### 3.2 Expected ORG-001 values

After the baseline fixtures plus the KDE corrections in `15_events.md` §10:

| Field | Value | Why |
|---|---|---|
| `activeLots` | 9 | 11 ORG-001 lots; LOT-005 recalled, LOT-007 void |
| `activeLocations` | 5 | 6 locations; LOC-005 inactive |
| `activeProducts` | 6 | All six active |
| `openComplianceGaps` | 1 | EVT-013 only |
| `eventsThisWeek` | 0 | Fixture events are dated June 2026; the query uses `now() - 7 days` |
| `totalUsers` | 10 | ORG-001 user list |
| `totalEvents` | 12 | Persisted event rows |

`eventsThisWeek` is not displayed as a card. It appears only in the API. At the current date (November 2026) the fixture events are months old, so the API returns 0. Create one event dated today to make it 1.

### 3.3 Onboarding checklist

Card `Getting Started`; `N of 4 completed`; progress bar (`OnboardingChecklist.jsx:45-56`).

| Step label | Completion rule | Link |
|---|---|---|
| `Add your first location` | `activeLocations > 0` | `/locations` |
| `Add your first product` | `activeProducts > 0` | `/products` |
| `Invite a teammate` | `totalUsers > 1` | `/settings/users` |
| `Record your first event` | `totalEvents > 0` | `/events/record` |

Completed steps render with a check icon and a line-through label; clicking a completed step is blocked. The card hides entirely when all four are complete (`OnboardingChecklist.jsx:40-43`). ORG-001 hides it. ORG-006 shows `0 of 4 completed`.

### 3.4 Charts and feed

| UI Element | API | Display | Citation |
|---|---|---|---|
| `Recent Activity (by Type)` | `GET /dashboard/activity` | Bar chart; one bar per `event_type` among the latest 10 events | `DashboardPage.jsx:13-23,50-74` |
| `Recent Events Feed` | `GET /dashboard/activity` | Latest 10 events: `<type> Event`, `by <recordedByName>`, date and time | `DashboardPage.jsx:76-104` |
| Empty chart | — | `No recent activity.` | `DashboardPage.jsx:69-71` |
| Empty feed | — | `No recent events.` | `DashboardPage.jsx:100-102` |

The chart is a type histogram of the feed, not a time series. Activity is ordered by `created_at desc`, not `event_datetime` (`dashboard/service.js:34-40`). The feed shows `event_datetime` (`DashboardPage.jsx:94-95`).

ORG-001 expected chart after the baseline order: creation 6, shipping 2, receiving 1, transformation 1 (latest 10 created rows: EVT-003…EVT-013, excluding EVT-001 and EVT-002). This is insertion-order dependent. `[UNVERIFIED-RUNTIME]`

ORG-006 expected: all stats 0, checklist visible with `0 of 4`, both cards show their empty text.

---

## 4. Screen: `/reports/compliance-gaps`

Header `Compliance Gaps`; description `Review events missing required KDEs based on product schemas.` (`ComplianceGapsPage.jsx:84-87`).

### 4.1 Table

| UI Label | API Field | Display rule | Citation |
|---|---|---|---|
| Event Type | `event_type` | Capitalized link to `/events/:id` | `ComplianceGapsPage.jsx:20-31` |
| Date & Time | `event_datetime` | `formatEventDate` | `ComplianceGapsPage.jsx:32-40` |
| Missing Required Fields | `compliance_gaps` | One red badge per gap, showing `gap.field` | `ComplianceGapsPage.jsx:41-56` |

The API returns raw snake_case gap rows, not the camelCase used elsewhere. The pager is the standard `DataTable` pager with `page`/`limit` (default 20), and the page resets on pager change (`ComplianceGapsPage.jsx:16,90-97`).

### 4.2 Expected ORG-001 result

After KDE corrections: 1 row, `EVT-013` (receiving), badge `harvest_date`. Pagination total 1.

Without the KDE corrections, `EVT-002`, `EVT-004`, `EVT-009`, and `EVT-013` all appear, and `EVT-001` (amended) also appears because the endpoint does not filter status. Keep the corrections so the expected count stays 1.

### 4.3 Empty and error states

| Condition | Display |
|---|---|
| No gaps | Table with no rows; the shared table renders its empty text |
| Network/API error | `Failed to load compliance gaps` / `Something went wrong. Please try again.` / `Retry` |
| Loading | Skeletons |

Citation: `ComplianceGapsPage.jsx:59-77`.

ORG-002 and ORG-006: no gaps. ORG-004: no gaps if `catch_area` is supplied on EVT-019 and EVT-020.

---

## 5. Export flows

### 5.1 Events export (Events list)

Button `Export` with menu items `Export CSV` and `Export JSON`, visible only with `reports.export` (`EventsListPage.jsx:156-171`).

| Step | Action | Expected |
|---|---|---|
| 1 | Click `Export` → `Export CSV` | Toast `Export started! You will be notified when it is ready.`; navigate to `/reports/exports/<id>` |
| 2 | Page opens | Title `Export details`; card title `CSV event export`; badge `Queued` then `Processing` then `Ready` |
| 3 | Wait for `Ready` | `Download export` button appears; notification `Export ready` |
| 4 | Click download | Browser downloads the presigned URL; toast only on failure |

The export payload is `{ "type": "events", "format": "csv" }`. No filters exist for event exports. The job exports **all** organization events, ordered by `chain_seq asc` (`workers/export-processor.js:30-59`).

### 5.2 Audit export (Audit Log page)

Button `Export CSV` in the Audit Log header, visible only with `reports.export` (`AuditLogPage.jsx:143-149`).

Payload from `buildAuditExportPayload(actionFilter)` (`lib/auditExport.js:1-5`):

```json
{ "type": "audit", "format": "csv", "filters": { "action": "event.void" } }
```

With `All Actions`, `filters` is `{}`. The export runs the same filter builder as the list (`audit/audit.service.js:13-32`).

### 5.3 Export detail page

Header `Export details` for events, `Audit log export` for audit (`ExportDetailPage.jsx:114-127`).

| UI Label | API Field | Display | Citation |
|---|---|---|---|
| Card title | `format`, `type` | `<CSV\|JSON> <event\|audit log> export` | `ExportDetailPage.jsx:131-134` |
| Status badge | `status` | `Queued`, `Processing`, `Ready`, `Failed` | `lib/exportStatus.js:1-6`; `ExportDetailPage.jsx:40-50` |
| Rows | `rowCount` | Number or `Pending` when null | `ExportDetailPage.jsx:139-144` |
| Requested | `createdAt` | Locale date/time | `ExportDetailPage.jsx:145-148` |
| Started | `startedAt` | Locale date/time or `—` | `ExportDetailPage.jsx:149-152` |
| Completed | `completedAt` | Locale date/time or `—` | `ExportDetailPage.jsx:153-156` |
| Failure box | `error` | Red box; generic fallback if null | `ExportDetailPage.jsx:159-163` |
| Running note | `status` | `The export is running in the background...` | `ExportDetailPage.jsx:165-170` |
| Download export | — | Button; `Preparing download...` while pending | `ExportDetailPage.jsx:172-179` |
| Request another export | — | Link back to `/events` or `/audit` on failure | `ExportDetailPage.jsx:181-187` |
| Back link | `type` | `Back to events` or `Back to audit log` | `ExportDetailPage.jsx:60-63,119-126` |

`downloadAvailable` is `true` only for `status='complete'` (`reports/reports.service.js:18-32`), but the UI ignores the field and checks `status` directly.

### 5.4 Export content

Event CSV columns, in order (`workers/export-format.js:20-43`):

```text
id,event_type,event_datetime,status,source,location_name,counterparty_info,
kde_payload,compliance_gaps,has_compliance_gaps,notes,recorded_by_name,
recorded_at,lot_links,supersedes_event_id,status_reason,record_hash,prev_hash,
chain_seq,hash_version,hash_key_id,created_at
```

JSON columns are stringified JSON inside CSV cells (`workers/export-format.js:45-50,141-145`). Values beginning with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'` to prevent spreadsheet formula injection (`workers/export-format.js:80-88`). Do not strip that apostrophe when validating.

Audit CSV columns (`workers/export-format.js:52-67`):

```text
id,created_at,actor_type,actor_id,actor_name,actor_email,actor_label,action,
entity_type,entity_id,before_state,after_state,metadata,ip_address
```

CSV exports are ordered by `chain_seq asc` for events and `created_at asc, id asc` for audit. JSON is a single array. There is no BOM.

### 5.5 Export statuses

| Status | Meaning | UI label |
|---|---|---|
| `queued` | Row created, job queued | `Queued` |
| `processing` | Worker claimed the row | `Processing` |
| `complete` | File uploaded, `storage_key` set | `Ready` |
| `failed` | Queue failure, worker error, or limit exceeded | `Failed` |

Failure messages (`reports/reports.service.js:11-14`):

| Condition | `error` / message |
|---|---|
| Limit exceeded | `This export is too large. Narrow the filters and request a smaller export.` |
| Any other failure | `Export failed. Please request a new export.` |

`errorCode` is `EXPORT_LIMIT_EXCEEDED` only for the limit case.

---

## 6. Screen: `/audit` — Audit Log

Header `Audit Log`; subtitle `Security and compliance trail for all sensitive actions` (`AuditLogPage.jsx:140-143`).

### 6.1 Controls

| UI Label | API / State | Values | Expected |
|---|---|---|---|
| Filter by action | `action` | `All Actions`, `User Invited` (`user.invite`), `Role Changed` (`user.role_change`), `Lot Voided` (`lot.void`), `Event Voided` (`event.void`), `Event Amended` (`event.amend`) | Filters server-side; resets page to 1 |
| Export CSV | `POST /reports/export` | — | Creates an audit export; visible only with `reports.export` |
| Pager | `page`, `limit` | Standard 20 per page | Changes page |

There is no free-text search, actor filter, entity filter, or date filter in the UI. Those exist only in the API (`audit/audit.validation.js:4-16`). The imported `Search` icon is unused (`AuditLogPage.jsx:3`).

### 6.2 Table columns

| UI Label | API Field | Display | Citation |
|---|---|---|---|
| Timestamp | `created_at` | `MMM d, yyyy h:mm:ss a` | `AuditLogPage.jsx:49-57` |
| Actor | `actor_type`, `actor_first_name`, `actor_last_name`, `actor_email` | `System` badge when `actor_type='system'`; otherwise name plus email | `AuditLogPage.jsx:58-72` |
| Action | `action` | Monospace badge, exact string | `AuditLogPage.jsx:73-81` |
| Entity | `entity_type`, `entity_id` | Capitalized type; first UUID segment plus `...` | `AuditLogPage.jsx:82-93` |
| IP Address | `ip_address` | Text or `N/A` | `AuditLogPage.jsx:94-102` |

### 6.3 Access and empty states

| Condition | Display |
|---|---|
| Role lacks `audit.read` or API returns `403` | `Access denied` / `You do not have permission to view the audit log.` |
| No rows | `No audit logs found` / `Sensitive actions will appear here.` |
| API error | `Failed to load audit logs` / `Something went wrong. Please try again.` / `Retry` |

Citations: `AuditLogPage.jsx:105-133,173-178`.

Operator USR-005 sees `Access denied` because `audit.read` is false in the permission map. The API would also return `403` (`audit/audit.routes.js:16`).

### 6.4 Expected audit actions and filters

| Filter | Expected ORG-001 rows after baseline |
|---|---|
| `All Actions` | Every audit row, newest first; includes `event.void`, `event.amend`, `lot.create`, `lot.update`, `lot.void`, `import.post`, `report.export`, `report.download`, `user.invite` |
| `user.invite` | One row per invited user |
| `user.role_change` | **0 rows** — actual update action is `user.patch` |
| `lot.void` | Rows for LOT-007 and LOT-016 (if voided through the API) |
| `event.void` | 1 row for EVT-007 |
| `event.amend` | 1 row for the EVT-011 replacement; `metadata.supersededEventId` holds the EVT-001 id |

The `event.amend` row's `entity_id` is the **new** event (`auditLogger.js:37-42`). Open the replacement event, not the original.

---

## 7. Notifications

### 7.1 Bell

| Element | Behavior | Citation |
|---|---|---|
| Bell icon | Header, all pages | `AppLayout.jsx:12`; `NotificationBell.jsx:36-38` |
| Red dot | Shown when unread count > 0; count from `unreadOnly=true` query | `NotificationBell.jsx:41-48` |
| Panel title | `Notifications` | `NotificationBell.jsx:75-76` |
| `Mark all read` | Visible only when unread count > 0; marks all own/org-wide rows read | `NotificationBell.jsx:77-89` |
| Row | Icon by type, bold title when unread, message, relative time, unread dot | `NotificationBell.jsx:99-126` |
| Click row | Marks read (if unread), closes panel, navigates to `link` when present | `NotificationBell.jsx:50-58` |
| Empty | `No notifications yet.` | `NotificationBell.jsx:93-96` |
| Loading | `Loading...` | `NotificationBell.jsx:91-92` |

The panel fetches two queries: unread only (`limit 10`) for the badge count and all (`limit 20`) for the list. The badge shows `pagination.total`, not `data.length`, so it can exceed 10 (`NotificationBell.jsx:41-42,47`).

### 7.2 API semantics

| Rule | Value | Citation |
|---|---|---|
| Visibility | `user_id = caller` OR `user_id IS NULL` | `notifications/notifications.service.js:7-12` |
| `unreadOnly` | String `'true'` or `'false'`; any other value is `422` | `notifications/notifications.validation.js:4-7` |
| Order | `created_at desc` | `notifications/notifications.service.js:12` |
| Mark one read | Only if own or org-wide; otherwise `404 Notification not found` | `notifications/notifications.service.js:21-33`; `notifications.controller.js:14-25` |
| Mark all read | Updates own and org-wide unread rows | `notifications/notifications.service.js:35-43` |
| No audit row | Notification reads are not audited | `notifications/notifications.routes.js` has no `auditLogger` |

### 7.3 Test matrix

| ID | Action | Expected |
|---|---|---|
| `NTF-T01` | Log in as USR-007 with unread NTF-001 | Red dot; panel row bold; title `Import completed with errors` |
| `NTF-T02` | Click NTF-001 | Row becomes read; navigates to `/imports` |
| `NTF-T03` | Click `Mark all read` | All own/org-wide rows read; dot disappears; button disappears |
| `NTF-T04` | Log in as USR-001 | Does **not** see USR-007's NTF-001; sees org-wide NTF-008 and own NTF-004 |
| `NTF-T05` | Log in as ORG-002 USR-011 | Sees only ORG-002 notifications; no ORG-001 rows |
| `NTF-T06` | `GET /notifications?unreadOnly=yes` | `422`, field `unreadOnly`, enum message |
| `NTF-T07` | Mark another user's notification read | `404 Notification not found` |
| `NTF-T08` | Mark unknown UUID read | `404 Notification not found` |
| `NTF-T09` | `PATCH /notifications/read-all` with none unread | `200`, `All notifications marked as read` |

---

## 8. API reference

### 8.1 Dashboard

`GET /api/v1/dashboard/stats` → `data`:

```json
{
  "activeLots": 9,
  "activeLocations": 5,
  "activeProducts": 6,
  "eventsThisWeek": 0,
  "openComplianceGaps": 1,
  "totalUsers": 10,
  "totalEvents": 12
}
```

`GET /api/v1/dashboard/activity` → `data`: array of up to 10 raw event rows plus `recordedByName`.

### 8.2 Compliance gaps

`GET /api/v1/reports/compliance-gaps?page=1&limit=20` → standard paginated envelope. Each row: `id`, `event_type`, `event_datetime`, `location_id`, `compliance_gaps` (JSON array), `kde_payload`, `created_at` (`reports/reports.service.js:43-56`).

There is no status filter and no organization join for location name. The page does not show the location.

### 8.3 Export request

`POST /api/v1/reports/export` → `202`, message `Export queued` (`reports/reports.controller.js:11-19`).

```json
{ "type": "events", "format": "csv" }
```

```json
{ "type": "audit", "format": "json", "filters": { "action": "lot.void" } }
```

Response `data` is the public export object: `id`, `type`, `format`, `status`, `rowCount`, `error`, `errorCode`, `createdAt`, `startedAt`, `completedAt`, `downloadAvailable` (`reports/reports.service.js:18-32`).

### 8.4 Export detail and download

`GET /reports/exports/:exportId` → `200` or `404 Export not found`.

`GET /reports/exports/:exportId/download`:

| Condition | Response |
|---|---|
| `status='complete'` | `200`, `{ downloadUrl, expiresAt, filename, contentType }` |
| `status='failed'` | `409`, code `EXPORT_FAILED`, message `Export failed` |
| `status` queued/processing | `409`, code `EXPORT_NOT_READY`, message `Export is not ready` |
| Unknown/cross-org id | `404 Export not found` |
| Bad UUID param | `422`, field `exportId`, message `Must be a valid export ID` |

Citations: `reports/reports.service.js:98-141`; `reports/reports.validation.js:21-23`.

### 8.5 Audit log

`GET /api/v1/audit?page=1&limit=20&action=event.void&entityType=event&actorId=<uuid>` → standard paginated envelope. Rows include all `audit_log` columns plus `actor_first_name`, `actor_last_name`, `actor_email` (`audit/audit.service.js:16-31`).

Unknown filter values return an empty list, not `422`. Filters are exact matches. `entityId` and `actorId` must be UUIDs.

### 8.6 Notifications

`GET /api/v1/notifications?page=1&limit=20&unreadOnly=true` → standard paginated envelope, message `Notifications fetched successfully`.

`PATCH /notifications/:id/read` → `200`, message `Notification marked as read`.

`PATCH /notifications/read-all` → `200`, message `All notifications marked as read`, `data: null`.

---

## 9. Negative cases

| ID | Case | Request / input | Expected |
|---|---|---|---|
| `NEG-RPT-01` | Operator requests export | USR-005 `POST /reports/export` | `403`, `Insufficient permissions to access this resource` |
| `NEG-RPT-02` | Auditor requests export | USR-008 | `403`, same |
| `NEG-RPT-03` | Auditor reads compliance gaps | USR-008 | `200` |
| `NEG-RPT-04` | Operator reads compliance gaps | USR-005 | `200` |
| `NEG-RPT-05` | Export with `type=users` | body | `422`, field `type`, union error |
| `NEG-RPT-06` | Export with `format=xlsx` | body | `422`, field `format`, enum message |
| `NEG-RPT-07` | Export with extra key | `{ "type":"events", "format":"csv", "x":1 }` | `422`, root, `Unrecognized key(s) in object: 'x'` |
| `NEG-RPT-08` | Audit export with extra filter key | `filters: { "status": "void" }` | `422`, strict object error |
| `NEG-RPT-09` | Download queued export | direct call | `409`, `Export is not ready` |
| `NEG-RPT-10` | Download failed export | direct call after queue failure | `409`, `Export failed` |
| `NEG-RPT-11` | Download cross-tenant export | ORG-001 token + ORG-002 `EXP-004` | `404 Export not found` |
| `NEG-RPT-12` | Get export with malformed UUID | `/reports/exports/abc` | `422`, `Must be a valid export ID` |
| `NEG-RPT-13` | Compliance gaps `limit=101` | query | `422`, field `limit`, max 100 |
| `NEG-RPT-14` | Audit log as operator | USR-005 | `403`, `Insufficient permissions to access this resource` |
| `NEG-RPT-15` | Audit log as auditor | USR-008 | `200` |
| `NEG-RPT-16` | Audit filter `entityId=abc` | query | `422`, field `entityId`, uuid error |
| `NEG-RPT-17` | Audit export as operator | UI hides button; direct API `403` | `403` |
| `NEG-RPT-18` | Export while Redis is down | request export | `503`, `Export queue unavailable`; DB row `failed` |
| `NEG-RPT-19` | Notification mark-read with malformed id | `PATCH /notifications/abc/read` | `422`, field `id`, uuid error |
| `NEG-RPT-20` | Notification `unreadOnly=false` | query | `200`; no unread filter |
| `NEG-RPT-21` | Notification cross-org id | ORG-002 user marks ORG-001 NTF-008 read | `404 Notification not found` |
| `NEG-RPT-22` | Notifications with no auth | no bearer | `401`, `AUTH_REQUIRED` |

Exact role-denial body (`rbac.js:13-15`):

```json
{
  "success": false,
  "message": "Insufficient permissions to access this resource",
  "error": { "code": "AUTH_FORBIDDEN" }
}
```

---

## 10. Operational tests

| ID | Action | Expected |
|---|---|---|
| `OPS-RPT-01` | Request an events CSV export as USR-003 | `202`; detail page polls; within seconds `Ready`; notification |
| `OPS-RPT-02` | Request an events JSON export | File is a single JSON array; parses with `JSON.parse` |
| `OPS-RPT-03` | Download after `expiresAt` | Presigned URL returns storage `403`; request a new URL |
| `OPS-RPT-04` | Request 2 exports rapidly | Both queue; `exportLimiter` may throttle `[UNVERIFIED-RUNTIME]` |
| `OPS-RPT-05` | Stop the export worker, request export | Status stays `Queued`; page keeps polling; no failure |
| `OPS-RPT-06` | Stop Redis, request export | `503`; row `failed`; notification `Export failed` |
| `OPS-RPT-07` | Export events for ORG-006 | `Complete` with `rowCount: 0`; CSV contains only the header |
| `OPS-RPT-08` | Audit export with `action=event.void` | 1 data row |
| `OPS-RPT-09` | Start a second session as the same user after marking all read | Dot stays off; state comes from the DB |
| `OPS-RPT-10` | Create event, then check audit log | **No** `event.create` row; only void/amend appear |
| `OPS-RPT-11` | Change a user role, filter `Role Changed` | Empty list; filter `All Actions` shows `user.patch` |
| `OPS-RPT-12` | Upload an import, check bell | `Import <status>` notification for the uploader only |

---

## 11. Cleanup

| Entity | Cleanup |
|---|---|
| Exports | Cannot be deleted via API. Object keys stay under `exports/org_<org>/`. Reset the database or delete keys in the disposable environment. |
| Audit log | Append-only; no delete path. Reset the database. |
| Notifications | No delete path; mark read only. Reset the database. |

Do not truncate `audit_log` in any shared environment. The dev database is disposable.
