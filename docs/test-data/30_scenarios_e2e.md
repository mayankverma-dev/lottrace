# 30 — End-to-End Scenarios

> Multi-screen, multi-role journeys. Each scenario lists preconditions, steps, expected results, and reset notes.
> Field-level detail lives in files 10–20. This file proves the system works as a whole.

---

## 1. How to run these

1. Reset the disposable database and seed it (`00_README_INDEX.md` §5).
2. Replay the fixture creation order in `03_design_notes.md` §4. Stop at the state the scenario needs.
3. Use fake data only. Never point a scenario at a shared environment.
4. Record the response body and status code for every API step.
5. Reset between scenarios that mutate the same records. `E2E-04`…`E2E-06` are destructive by design.

**Baseline assumption:** `B0` from `40_import_files.md` §1. Scenarios that run imports say so and use `B1` counts.

---

## 2. Scenario index

| ID | Title | Primary roles | Mutates data | Duration |
|---|---|---|---|---|
| `E2E-01` | New tenant from registration to first event | new org_admin | Yes (ORG-006) | 20 min |
| `E2E-02` | Invite, accept, change role, deactivate, reactivate | admin, invitee | Yes | 20 min |
| `E2E-03` | Farm-to-fork trace investigation | operator, auditor | No | 10 min |
| `E2E-04` | Amend an event and prove trace continuity | compliance | Yes | 15 min |
| `E2E-05` | Void a shipping event, then hit immutability | compliance | Yes | 10 min |
| `E2E-06` | Void a lot and reuse its TLC | compliance | Yes | 10 min |
| `E2E-07` | Partial import, error dialog, notification | operator | Yes (import) | 15 min |
| `E2E-08` | Export, download, and audit the export | compliance, admin | Yes (export) | 10 min |
| `E2E-09` | Auditor investigation and permission denials | auditor, operator | No | 10 min |
| `E2E-10` | Recall simulation drill | compliance | Yes (recall) | 10 min |
| `E2E-11` | Cross-tenant isolation sweep | two org admins | No | 15 min |
| `E2E-12` | PWA online scan and record | operator | Yes | 10 min |
| `E2E-13` | PWA offline outbox sync | operator | Yes | 15 min |
| `E2E-14` | Role and navigation sweep | all four | No | 15 min |

---

## 3. `E2E-01` — New tenant from registration to first event

**Purpose:** Prove the full bootstrap path: Redis-held signup, OTP verification, org creation, first admin, empty states, checklist, and first event.

**Preconditions:** ORG-006 is empty. Capture its empty-state screens first; this scenario fills it. Use a mailbox you control or read the OTP from the API log/Redis in the dev environment.

| Step | Action | Expected |
|---|---|---|
| 1 | Open `/register` | Card `Create Organization`; fields Organization Name, First Name, Last Name, Work Email, Password |
| 2 | Submit `Cedar Fork Test Kitchen`, `Chloe`, `Dubois`, `chloe.dubois+2@cedarfork.example.com`, `Cedar!Fork2026` | `201`; UI navigates to `/verify-email`; no tokens; no `users` or `organizations` row yet |
| 3 | Check `GET /organizations/me` with any token | No user exists for this email yet; login returns `401 Invalid credentials` |
| 4 | Enter a wrong 6-digit OTP | `400 Invalid verification code`; inputs clear |
| 5 | Request resend immediately | `429 Please wait before requesting a new verification code.` |
| 6 | Enter the correct OTP from the email | `200 Email verified successfully`; user and organization rows created; tokens set; dashboard opens |
| 7 | Read the JWT claims | `role='org_admin'`, `orgId` equals the new organization id |
| 8 | Open `/` | Stat cards all `0`; checklist `0 of 4 completed`; chart `No recent activity.`; feed `No recent events.` |
| 9 | Click `Add your first location` | `/locations`; create `Test Kitchen` type `plant`, city `Portland`, state `OR`, country `US` |
| 10 | Create product `Test Salad Kit`, SKU `CF-TSK-001`, default UOM `kg`, no KDEs | Product appears; dashboard Products `1` |
| 11 | Invite a second user (operator) | Checklist step `Invite a teammate` completes |
| 12 | Record a creation event with one output lot | Checklist reaches `4 of 4` and the card disappears; dashboard Active Lots `1`, Locations `1`, Products `1`, gaps `0` |
| 13 | Open `/trace`, select the new lot | Full trace shows 1 node, 0 hops |
| 14 | Open `/audit` | `lot.create` row; **no** event-create row (finding) |

**Reset:** Deletes are unavailable. Reset the database to restore ORG-006 as the empty tenant.

Citations: `auth.service.js:77-130`; `VerifyEmailPage.jsx:26-149`; `OnboardingChecklist.jsx:9-56`; `dashboard/service.js:4-40`; `events.service.js:61-106`.

---

## 4. `E2E-02` — Invite, accept, change role, deactivate, reactivate

**Purpose:** Exercise every user-lifecycle state and prove role changes only take effect on the next access token.

**Preconditions:** `B0`; USR-001 admin; USR-009 invited; USR-010 deactivated; mailbox access for the invite link.

| Step | Action | Expected |
|---|---|---|
| 1 | As USR-001, `/settings/users`, click `Invite User` | Dialog `Invite User`; role defaults to `Operator` |
| 2 | Invite `qa.invitee@greenvalley.example.com`, `Quinn`, `Avery`, role `Operator` | Row appears with `Invited`; audit `user.invite` |
| 3 | Invite the same email again | `409 User is already in this organization` |
| 4 | Invite `liam.chen@northwind.example.org` | `409 This email is already registered to an existing LotTrace account` |
| 5 | Open the invite link from the email | `/accept-invite?token=...&email=...`; card `Accept Invitation` |
| 6 | Set password `Invitee!2026` | `200 Invitation accepted`; dashboard opens as operator; audit log visible? **No**, `Access denied` |
| 7 | As USR-001, change Quinn's role to `compliance_manager` | `200`; audit action is `user.patch`, **not** `user.role_change` |
| 8 | In Quinn's existing browser, open `/audit` without re-login | Still denied until the access token expires or refresh issues a new one `[UNVERIFIED-RUNTIME]` |
| 9 | Log out and back in as Quinn | Audit log now loads; export buttons appear |
| 10 | As USR-001, try to change your own role | `403 Cannot change your own role` |
| 11 | Deactivate Quinn | `200`; Quinn's next API call returns `401 AUTH_SESSION_REVOKED` |
| 12 | Log in as Quinn | `401 Invalid credentials` |
| 13 | Reactivate Quinn | Status returns to `active` (password existed); login works |
| 14 | Try to reactivate USR-009 (invited, not deactivated) | `409 Only deactivated users can be reactivated` |
| 15 | Deactivate USR-002, then try to deactivate USR-001 | `403 Cannot deactivate the last organization admin` |

**Reset:** Invited/deactivated rows persist. Reset or leave as state fixtures.

Citations: `users/users.service.js:113-143,198-214,242-296,315-353`; `users.routes.js:24-66`; `auditLogger.js:21-29`.

---

## 5. `E2E-03` — Farm-to-fork trace investigation

**Purpose:** The core product promise: a recall investigation in seconds.

**Preconditions:** `B0`; all ORG-001 events loaded and active except the known amended/void rows.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as USR-005 (operator) | Dashboard loads; no export buttons |
| 2 | Open `/trace`, search `SPN-2026-0001` | LOT-001 resolves; forward trace shows LOT-001 at hop 0 and LOT-004 at hop 1 |
| 3 | Switch to `Backward` | Only LOT-001; no upstream event consumes it as output |
| 4 | Switch to `Full` | 2 nodes, 1 edge, `hops=1`, edge `eventId` = EVT-003, direction transformation |
| 5 | Select LOT-004, `Backward` | 3 nodes: LOT-004 hop 0; LOT-001 and LOT-003 hop -1; two edges share EVT-003 |
| 6 | Forward from LOT-004 | 1 node; the shipping event EVT-004 has no output, so the customer is not a node |
| 7 | Open the edge's event | EVT-003 detail shows both inputs and the output with quantities |
| 8 | Repeat from LOT-006 | 1 node; EVT-007 is void and excluded |
| 9 | Repeat from LOT-005 | 1 node; recalled lots still trace |
| 10 | Check the response JSON | `startLot`, `direction`, `nodes`, `edges`, `hops`, `truncated` present |

**Expected edge for EVT-003:** `from` LOT-001 → `to` LOT-004; a second edge `from` LOT-003 → `to` LOT-004. Both `eventId` = EVT-003.

Citations: `trace.service.js:228-270`; `16_trace.md` TRC-001…TRC-009.

---

## 6. `E2E-04` — Amend an event and prove trace continuity

**Purpose:** Amendment creates a replacement event, keeps the original as evidence, and re-seals the hash chain.

**Preconditions:** `B0`; EVT-001 is `amended`, EVT-011 is its active replacement. Capture the current trace from LOT-001.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as USR-004 (compliance) | EVT-011 detail shows `Replacement for EVT-001`; EVT-001 shows `Amended` |
| 2 | Attempt `POST /events/<EVT-011>/amend` with no `amendReason` | `422`, field `amendReason`, `Reason is required to amend an event` |
| 3 | Amend EVT-011, changing notes only | `201`; new event active; EVT-011 becomes `amended`; new row `supersedes_event_id` = EVT-011 |
| 4 | Attempt to amend the new event but change `eventType` | `400`, code `VALIDATION_ERROR`, `Event type cannot change when amending an event` |
| 5 | Trace LOT-001 again | Uses the newest active replacement; hop count unchanged; no duplicate node for amended rows |
| 6 | Check the audit log | New `event.amend` row whose `entity_id` is the **new** event; `metadata.supersededEventId` = EVT-011 |
| 7 | Check the event list | All three rows appear with `AMENDED` badges except the newest `ACTIVE` |
| 8 | Re-request an events export | All rows included, including amended originals; `rowCount` rises by 1 |
| 9 | Attempt to void the original EVT-001 | `409 Event is not active` |

**Reset:** Reload the event fixtures, or resets the amendment chain.

Citations: `events.service.js:311-430`; `15_events.md` §8.

---

## 7. `E2E-05` — Void a shipping event, then hit immutability

**Purpose:** Void is a status transition, not a delete. Hash evidence and trace exclusion must both hold.

**Preconditions:** `B0`; EVT-007 active, shipping LOT-006.

| Step | Action | Expected |
|---|---|---|
| 1 | As USR-004, open EVT-007 | Status `Active`; no void reason |
| 2 | Void with an empty reason | `422`, `Void reason is required` |
| 3 | Void with `Duplicate shipment entry` | `200`; status `void`; `status_reason` set; the row still exists |
| 4 | Trace LOT-006 full | 1 node, 0 hops; EVT-007 excluded |
| 5 | Void EVT-007 again | `409 Event is not active` |
| 6 | Amend EVT-007 | `409 Event is not active` |
| 7 | Audit log filter `Event Voided` | One row, `entity_id` = EVT-007 |
| 8 | Check event list | `VOID` badge; row not hidden |
| 9 | Check hash chain | `record_hash` unchanged by the void; a signed `event_evidence` row records the transition |
| 10 | Check the dashboard | Total events unchanged; active event count effectively drops but no card shows it |

Citations: `events.service.js:152-230`; `15_events.md` §9.

---

## 8. `E2E-06` — Void a lot and reuse its TLC

**Purpose:** The lot TLC uniqueness index is partial on non-void rows.

**Preconditions:** `B0`; LOT-007 void with TLC `CIL-2026-0003`; LOT-008 active with the same TLC; LOT-005 recalled.

| Step | Action | Expected |
|---|---|---|
| 1 | As USR-004, open LOT-007 | Status `Void`; void reason visible |
| 2 | Try to edit quantity | `400 Cannot update a voided lot`, code `LOT_VOIDED` |
| 3 | Try to void again | `400 Lot is already voided`, code `LOT_VOIDED` |
| 4 | Open LOT-005 (recalled) and edit | `400 Cannot update a recalled lot`, code `LOT_RECALLED` |
| 5 | Create a new lot with product Cilantro, TLC `CIL-2026-0003`, quantity `25`, UOM `units` | `201`; allowed because LOT-007 is void |
| 6 | Create another active lot with TLC `CIL-2026-0003` | `409`, code `DUPLICATE_ENTRY`; message names the TLC |
| 7 | Create a lot with quantity `0` | `422`, `Quantity must be positive` |
| 8 | Create a lot with quantity `0.0001` | `201`; decimal(15,4) minimum positive |
| 9 | Void the new lot via API as compliance | `200`; **the UI hides Void Lot for compliance** (finding) |
| 10 | Check audit | `lot.void` rows; no lot-delete row |

Citations: `lots.service.js:180-276`; `20240101000006_create_lots.js` uniqueness index; `14_lots.md` §7.

---

## 9. `E2E-07` — Partial import, error dialog, notification

**Purpose:** Bulk ingestion end to end, including row errors, status, notification, and audit.

**Preconditions:** `B0`, ORG-001 locations and products loaded, Redis and workers running. Use the files in `docs/test-data/imports/`.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as USR-007 (operator); open `/imports` | Upload card; `Receiving` selected |
| 2 | Upload `IMP-002_creation_errors.csv` with Event Type `Creation` | `201`; toast `Import queued`; row `Pending` |
| 3 | Wait for refresh | `Partial`; `1 imported`; `3 errors →`; `4 total` |
| 4 | Open the error dialog | Exactly the three messages in `40_import_files.md` §3.2, rows 2–4 |
| 5 | Check the bell | `Import completed with errors`, message `Your creation CSV import "<epoch_ms>_IMP-002_creation_errors.csv" completed with errors. 1 rows imported, 3 errors.` |
| 6 | Upload `IMP-004` as `Shipping` | `Failed`; 3 errors; no event created |
| 7 | Upload `IMP-005_header_only.csv` as `Creation` | `Failed`, total `0`, no errors link, **no notification** |
| 8 | Upload `IMP-006` as `Creation` | `Complete`, 3 imported, 1 event with 3 outputs |
| 9 | Upload `IMP-006` again | `Complete`, 3 imported, **no new event** (idempotency) |
| 10 | Check `/events` | Imported events show source `Import`; no `creation` gaps for Romaine |
| 11 | Check `/audit` as admin | One `import.post` per upload |
| 12 | Upload `IMP-001` as `Receiving` to the wrong CTE instead | `Complete` but events have output links instead of inputs; trace breaks (negative test) |

**State after:** `B1` partially; see `40_import_files.md` §7 for exact counts.

Citations: `import-processor.js:32-70,130-175,224-263`; `import-event.js:17-73`; `17_imports.md`.

---

## 10. `E2E-08` — Export, download, and audit the export

**Purpose:** Asynchronous export, notification, presigned download, and audit trail.

**Preconditions:** `B0`; USR-003 compliance; USR-005 operator.

| Step | Action | Expected |
|---|---|---|
| 1 | As USR-003, open `/events` and click `Export` → `Export CSV` | Toast `Export started! You will be notified when it is ready.`; navigate to `/reports/exports/<id>` |
| 2 | Observe the detail page | `Export details`; card `CSV event export`; badge `Queued` → `Processing` → `Ready` |
| 3 | Check the bell before completion | No notification yet |
| 4 | Wait for `Ready` | `Download export` appears; bell shows `Export ready` with row count |
| 5 | Click `Download export` | Browser downloads `lottrace-events-<uuid>.csv`; header matches `18_reports_audit.md` §5.4 |
| 6 | Parse the CSV | 12 data rows at `B0`; JSON cells valid; no formula injection |
| 7 | Request a JSON export | File parses as one array of 12 objects |
| 8 | Go to `/audit` as USR-003, filter `Event Voided`, click `Export CSV` | Export includes only `event.void` rows; detail header `Audit log export` |
| 9 | Check audit as USR-001 | `report.export` and `report.download` rows |
| 10 | As USR-005, call `POST /reports/export` directly | `403 Insufficient permissions to access this resource` |
| 11 | Download an export owned by another user in the same org | Allowed; exports are org-scoped, not user-scoped |
| 12 | Stop Redis and request an export | `503 Export queue unavailable`; row status `failed` with `error='Failed to queue export'` |

**Reset:** Exports and audit rows have no delete path. Delete generated S3 objects in the disposable bucket if needed.

Citations: `reports.service.js:9-141`; `export-processor.js`; `export-format.js:20-88`; `18_reports_audit.md` §5.

---

## 11. `E2E-09` — Auditor investigation and permission denials

**Purpose:** Confirm read-only investigation and that the UI hides what the API denies.

**Preconditions:** `B0`; USR-008 auditor; at least one voided event and one amended event.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as USR-008 | Dashboard loads; no `Add Location`, `Add Product`, `Record Event`, `Record Lot`, `Export`, `Import`, or `Run Simulation` buttons |
| 2 | Open `/audit` | Rows visible, newest first; no `Export CSV` button |
| 3 | Filter `Event Amended` | Row exists; entity link opens the replacement event |
| 4 | Filter `Role Changed` | Empty list; the real action is `user.patch` (finding) |
| 5 | Open `/events`, an event detail | Read-only; no Void/Amend/Add Attachment |
| 6 | Open `/imports` | List visible; no upload card controls usable |
| 7 | Open `/recall` | List visible; no `Run Simulation` |
| 8 | Call `POST /events` directly | `403` |
| 9 | Call `POST /imports` directly | `403` |
| 10 | Call `POST /recall` directly | `403` |
| 11 | Call `POST /reports/export` directly | `403` |
| 12 | Call `GET /audit` directly | `200` |
| 13 | Log in as USR-005 operator and open `/audit` | `Access denied` page; API `403` |

Citations: `usePermissions.js:3-43`; `audit.routes.js:14-19`; `rbac.js:13-15`; `20_auth_roles.md` §10.

---

## 12. `E2E-10` — Recall simulation drill

**Purpose:** Run a mock recall and validate the computed impact summary.

**Preconditions:** `B0`; ORG-001 trace graph intact.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as USR-003; open `/recall` | List shows REC-001 and REC-002 |
| 2 | Click `Run Simulation` | Dialog with `Simulation Name` and `Triggering Lot` |
| 3 | Submit empty | Inline `Name is required` and `Lot is required`; no request |
| 4 | Enter `E2E Spinach Drill`, select LOT-001 | `201 Recall simulation completed`; navigate to detail |
| 5 | Read the result card | Affected Lots `2`, Locations `1`, Products `2`, `1 hops` |
| 6 | Click `View Full Trace Tree` | Opens `/trace` with **no lot selected** (broken deep link, finding) |
| 7 | Run from LOT-004 | `3 / 1 / 3 / 1` |
| 8 | Run from LOT-020 (ORG-005 as USR-029) | `2 / 1 / 1 / 1`; both lots share one product |
| 9 | Check the bell | No new notification (finding) |
| 10 | Check the audit log | No `recall.*` row (finding) |
| 11 | As USR-008 auditor, open the detail URL | Visible; no Run button |
| 12 | As USR-005 operator, open `/recall` | `403`/unlinked; direct API `403` |

Citations: `recall/service.js:6-59`; `RecallSimulationDetailPage.jsx:42-136`; `19_recall.md`.

---

## 13. `E2E-11` — Cross-tenant isolation sweep

**Purpose:** No identifier from another organization may leak data or existence.

**Preconditions:** `B0`; ORG-001 and ORG-002 populated; ORG-001 token and ORG-002 token ready.

| Step | Action | Expected |
|---|---|---|
| 1 | ORG-001 token `GET /lots/<LOT-011>` | `404 Lot not found` |
| 2 | ORG-001 token `GET /events/<EVT-014>` | `404 Event not found` |
| 3 | ORG-001 token `GET /locations/<LOC-007>` | `404 Location not found` |
| 4 | ORG-001 token `GET /products/<PRD-007>` | `404 Product not found` |
| 5 | ORG-001 token `GET /users/<USR-011>` | `404 User not found` |
| 6 | ORG-001 token `GET /trace/<LOT-011>/full` | `404 Lot not found` |
| 7 | ORG-001 token `GET /reports/exports/<EXP-004>` | `404 Export not found` |
| 8 | ORG-001 token `GET /imports/<IMP-008>` | `404 Import not found` |
| 9 | ORG-001 token `GET /recall/<REC-003>` (ORG-003) | `404 Simulation not found` |
| 10 | ORG-001 token marks ORG-002 NTF-005 read | `404 Notification not found` |
| 11 | ORG-001 creates an event with LOT-011 | `404 Lot not found`; no partial write |
| 12 | ORG-001 creates a lot with SKU `NW-FRB-001` | `201`; SKU reuse across orgs is allowed |
| 13 | ORG-001 invites `liam.chen@northwind.example.org` | `409`, cross-org duplicate message |
| 14 | ORG-001 searches `FZN-2026-0100` | Returns LOT-024 only, never LOT-011 |
| 15 | ORG-001 creates a location named `Reno Cold Store` | Allowed; duplicate rules are org-scoped |

Citations: `tenantScope.js`; `20240101000018_add_rls_policies.js`; each service's `where organization_id`.

---

## 14. `E2E-12` — PWA online scan and record

**Purpose:** The scan workflow on a phone-sized viewport.

**Preconditions:** ORG-001 products and locations; USR-005 active; scan PWA running on port 3002.

| Step | Action | Expected |
|---|---|---|
| 1 | Open the PWA and log in | Lands on `/scan`; bottom nav Scan / Manual / History |
| 2 | Allow camera; scan `SPN-2026-0001` (or paste into manual) | Lot found; green confirmation; haptic |
| 3 | Choose `Record Event` | Quick form: Event Type, Location, Notes |
| 4 | Event Type options | Only `Receiving` and `Shipping` |
| 5 | Submit with no location | Inline `Select a location` |
| 6 | Choose `Packing House`, type `Receiving`, notes `PWA receiving` | `201`; toast `Event saved`; returns to scan; success animation |
| 7 | Open History | New event at the top with the lot code and type |
| 8 | Bulk mode: scan the same code twice | `SPN-2026-0001 already scanned` warning; no duplicate row |
| 9 | Bulk mode: scan LOT-001 and LOT-003, submit one receiving | One event with two input links |
| 10 | Scan an unknown code `ZZZ-9999` | `Unknown Lot Code` with `Create New Lot` |
| 11 | Create the lot from the PWA | Product select, quantity, UOM; `201`; proceeds to the event form |
| 12 | Check the web app | The new lot and event appear; source `scan` |
| 13 | Check the audit log | No event-create audit row; lot.create is present |

**Note:** the PWA cannot create `creation` or `transformation` events. Those require the web app or an import.

Citations: `ScanPage.jsx:47-121`; `QuickEventForm.jsx:24-134`; `ManualEntryPage.jsx:38-150`; `recordEventPayload.js:71-120`.

---

## 15. `E2E-13` — PWA offline outbox sync

**Purpose:** Durable offline queue, idempotency, and per-user isolation.

**Preconditions:** USR-006 active; PWA loaded once online; at least one lot known to the device.

| Step | Action | Expected |
|---|---|---|
| 1 | Log in as USR-006; scan LOT-001; open the event form | Form loads |
| 2 | Set DevTools to offline; choose `Receiving`, `Packing House`, submit | Toast `Event queued — it will sync when you are online`; banner `You're offline — events will sync when reconnected.` |
| 3 | Scan another lot and queue a second event | Two records in IndexedDB `lottrace-outbox` |
| 4 | Reload the page while offline | Records survive; history may not load |
| 5 | Log out and log in as USR-005 on the same device | USR-005 sees **zero** queued records |
| 6 | Log back in as USR-006 and go online | Banner clears; toast `Synced 2 queued events` |
| 7 | Check the web app | Exactly 2 new events; no duplicates |
| 8 | Queue an event, go online, but make the server return `422` (e.g. invalid location) | Record parked with `failedAt`; no infinite retry; permanent-failure rule `4xx except 401/408/429` |
| 9 | Queue an event and let the access token expire | Sync gets `401`; record stays queued for retry after refresh |
| 10 | Check the outbox in DevTools | Owner key is `<orgId>:<userId>`; payload includes `kdePayload:{}` and no outputs |
| 11 | Submit a queued event twice by double-clicking sync | Same idempotency key; one event |

**Reset:** Clear the site's IndexedDB, or the queued records persist across sessions.

Citations: `outbox.js:9-82,37-42`; `outboxSync.js`; `ConnectivityBanner.jsx:8-37`; `QuickEventForm.jsx:77-132`.

---

## 16. `E2E-14` — Role and navigation sweep

**Purpose:** One pass over the UI and API permission matrix.

**Preconditions:** `B0`; one active user per role in ORG-001.

| Step | admin USR-001 | compliance USR-003 | operator USR-005 | auditor USR-008 |
|---|---|---|---|---|
| Sidebar shows Settings → Users | Yes | Yes (may be hidden) | No | No |
| `/settings/users` loads | Yes | Yes `[UNVERIFIED-RUNTIME]` | Denied | Denied |
| Invite button | Yes | No | No | No |
| Add Location | Yes | Yes | **No UI, API yes** | No |
| Edit Location | Yes | Yes | No | No |
| Deactivate Location | Yes | No | No | No |
| Add Product | Yes | Yes | No | No |
| Add Lot | Yes | Yes | Yes | No |
| Record Event | Yes | Yes | Yes | No |
| Void/Amend Event | Yes | Yes | No | No |
| Add Attachment | Yes | Yes | Yes | No |
| Delete Attachment | Yes | Yes | **No** | No |
| Export events | Yes | Yes | No | No |
| Audit log | Yes | Yes | No | Yes |
| Imports upload | Yes | Yes | Yes | No |
| Recall run | Yes | Yes | No | No |
| Recall list | Yes | Yes | No | Yes |
| Compliance gaps | Yes | Yes | Yes | Yes |
| Notification bell | Yes | Yes | Yes | Yes |

Every `No` above must also be `403` from the API for the same action, except the two marked mismatches: operator `POST /locations` is allowed by the API but has no UI control, and compliance_manager `POST /lots/:id/void` is allowed by the API but hidden by the `can('org_admin')` check at `LotDetailPage.jsx:140`. Operator lot editing, lot creation, and event recording are consistent between UI and API.

Citations: `20_auth_roles.md` §10; `usePermissions.js:3-43`.

---

## 17. Scenario coverage map

| Area | Scenarios |
|---|---|
| Auth and onboarding | E2E-01, E2E-02, E2E-14 |
| Tenant isolation | E2E-11 |
| Lots and TLC rules | E2E-06, E2E-11 |
| Events and hash chain | E2E-04, E2E-05, E2E-12 |
| Trace engine | E2E-03, E2E-04, E2E-05, E2E-10 |
| Imports | E2E-07 |
| Exports and audit | E2E-08, E2E-09 |
| Notifications | E2E-02 (invite email not in bell), E2E-07, E2E-08 |
| Recall | E2E-10 |
| PWA and offline | E2E-12, E2E-13 |
| RBAC | E2E-01, E2E-02, E2E-09, E2E-14 |
