# 15 — Events

> Entity: `events` + `event_lot_links` + `attachments`. Screens: `/events` (list), `/events/record` (record/amend), `/events/:eventId` (detail, void, attachments), `/events/record?amendEventId=<id>` (amend).
> API: `GET/POST /events`, `GET /events/:eventId`, `POST /events/:eventId/void`, `POST /events/:eventId/amend`, `POST /events/:eventId/attachments/presigned-url`, `POST /events/:eventId/attachments`, `GET /events/:eventId/attachments`, `GET /attachments/:attachmentId/download`, `DELETE /attachments/:attachmentId`.

---

## 1. Purpose and prerequisites

An event is one Critical Tracking Event (CTE) in the supply chain. Events are immutable: corrections create a replacement that supersedes the original. Events form a per-organization HMAC hash chain.

| Rule | Value | Citation |
|---|---|---|
| Event types | `creation`, `receiving`, `transformation`, `shipping` | `events/events.validation.js:10` |
| Sources | `manual`, `scan`, `import`, `api`; default `manual` | `events/events.validation.js:13` |
| Statuses | `active`, `amended`, `void`; default `active` | `20240101000007_create_events.js:28` |
| Input rules | `creation` needs outputs only; `receiving` needs inputs only; `transformation` needs both; `shipping` needs inputs only | `events/events.validation.js:19-34` |
| Receiving location | Required for `receiving` | `events/events.validation.js:41-43` |
| Shipping/receiving outputs | Must be empty | `events/events.validation.js:35-40` |
| Lot link quantity | Positive number | `events/events.validation.js:5` |
| Lot link UOM | Non-empty string | `events/events.validation.js:6` |
| Status changes | `void` and `amend` only; original becomes non-active | `events/events.service.js:311-420` |
| Hash chain | `prev_hash` + `record_hash`, ordered by `chain_seq` | `20240101000007_create_events.js:23-27,54-62` |
| Chain sequence | Positive, unique per organization | `20240101000007_create_events.js:56-62` |
| Supersede limit | An event can be superseded at most once | `20240101000007_create_events.js:64-70` |
| Event list pagination | Keyset: `{ limit, hasNextPage, nextCursor }`; no `page` | `events/events.service.js:207-282`; `events/events.validation.js:72-82` |
| Create roles | `org_admin`, `compliance_manager`, `operator` | `events/events.routes.js:24-30` |
| Read roles | All four org roles | `events/events.routes.js:32-50` |
| Void/amend roles | `org_admin`, `compliance_manager` | `events/events.routes.js:52-68` |
| Attachment roles | Create: admin/compliance/operator; read: all four | `events/events.routes.js:70-84`, `backend/src/app.js:98-112` |

Create users, locations, products, and lots first. A receiving event requires an existing active location. A lot must belong to the same organization.

---

## 2. Record set

23 persisted events. Times are UTC. The `Date & Time` column is `event_datetime`. `recorded_by` uses the canonical user IDs.

### ORG-001 — Green Valley Fresh Foods

| ID | Type | Location | Event datetime | Inputs (lot → qty uom) | Outputs (lot → qty uom) | Recorded by | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| `EVT-001` | creation | LOC-001 | `2026-06-01T08:00:00.000Z` | — | LOT-001 → 500 kg; LOT-002 → 320 kg | USR-005 | amended | `Morning harvest, blocks A and B`; KDE `harvest_date=2026-06-01` |
| `EVT-002` | receiving | LOC-002 | `2026-06-02T09:15:00.000Z` | LOT-001 → 480 kg | — | USR-005 | active | Counterparty `Riverside Partner Farm`, supplier lot `RPF-SPN-77`; KDE `harvest_date=2026-06-01` |
| `EVT-003` | transformation | LOC-002 | `2026-06-02T09:15:00.000Z` | LOT-001 → 250 kg; LOT-003 → 100 kg | LOT-004 → 300 kg | USR-005 | active | `Wash and blend line 2`; KDE `harvest_date=2026-06-01` |
| `EVT-004` | shipping | LOC-003 | `2026-06-03T14:30:00.000Z` | LOT-004 → 200 kg | — | USR-006 | active | Counterparty `Bay Area Retail Depot`; KDE `harvest_date=2026-06-01` |
| `EVT-005` | creation | LOC-001 | `2026-06-01T08:00:00.000Z` | — | LOT-003 → 300 kg | USR-005 | active | `Kale harvest` |
| `EVT-006` | creation | LOC-001 | `2026-06-01T08:00:00.000Z` | — | LOT-006 → 200 kg | USR-005 | active | `Romaine harvest` |
| `EVT-007` | shipping | LOC-003 | `2026-06-04T11:00:00.000Z` | LOT-006 → 150 kg | — | USR-006 | void | Voided by `EVT-012`; reason `Wrong destination` |
| `EVT-008` | creation | LOC-001 | `2026-06-01T08:00:00.000Z` | — | LOT-009 → 50 units | USR-005 | active | `Cilantro bunch count 50`; KDE `bunch_count=50` |
| `EVT-009` | creation | LOC-002 | `2026-06-02T16:00:00.000Z` | — | LOT-005 → 150 kg | USR-007 | active | `Spring mix run for recall fixture`; KDE `harvest_date=2026-06-02` |
| `EVT-010` | creation | LOC-001 | `2026-06-01T08:00:00.000Z` | — | LOT-010 → 0.0001 kg | USR-005 | active | Minimum quantity boundary |
| `EVT-011` | creation | LOC-001 | `2026-06-01T08:05:00.000Z` | — | LOT-001 → 500 kg; LOT-002 → 320 kg | USR-004 | active | Replacement for `EVT-001`; `supersedes_event_id = EVT-001`; KDE `harvest_date=2026-06-01` |
| `EVT-013` | receiving | LOC-002 | `2026-06-06T10:20:00.000Z` | LOT-002 → 100 kg | — | USR-007 | active | Missing required KDE `harvest_date` → compliance gap |

**`EVT-012` is an operation label, not a row.** The design notes label the void operation `EVT-012`, but the API performs a status transition on `EVT-007`; no new event row is inserted (`events/events.service.js:311-351`). The persisted ORG-001 count is 12 events: `EVT-001`…`EVT-011` plus `EVT-013`. The total persisted count is **22 events**: 12 + 2 (ORG-002) + 3 (ORG-003) + 3 (ORG-004) + 2 (ORG-005). The coverage matrix records 22 event rows and 23 event-lifecycle records (22 rows + the void operation).

### ORG-002 — Northwind Cold Chain

| ID | Type | Location | Event datetime | Inputs | Outputs | Recorded by | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| `EVT-014` | creation | LOC-007 | `2026-06-10T09:00:00.000Z` | — | LOT-011 → 600 kg; LOT-012 → 250 kg | USR-013 | active | `Frozen berry run` |
| `EVT-015` | shipping | LOC-008 | `2026-06-11T13:15:00.000Z` | LOT-011 → 400 kg | — | USR-014 | active | Counterparty `Truck Yard Transfer`; source `manual` |

### ORG-003 — Harvest Moon Dairy

| ID | Type | Location | Event datetime | Inputs | Outputs | Recorded by | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| `EVT-016` | receiving | LOC-010 | `2026-06-15T06:30:00.000Z` | LOT-013 → 2000 liters | — | USR-019 | active | Counterparty `Dairy Farm`; supplier lot `HM-MILK-0615` |
| `EVT-017` | transformation | LOC-010 | `2026-06-16T11:00:00.000Z` | LOT-013 → 1500 liters | LOT-014 → 400 kg; LOT-015 → 50 kg | USR-020 | active | `Pasteurize and age`; KDE `tank_id=T-12` |
| `EVT-018` | shipping | LOC-010 | `2026-06-18T08:45:00.000Z` | LOT-014 → 100 kg | — | USR-019 | active | Counterparty `Milk Run Transfer` |

### ORG-004 — Blue Harbor Seafood

| ID | Type | Location | Event datetime | Inputs | Outputs | Recorded by | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| `EVT-019` | creation | LOC-014 | `2026-06-20T05:45:00.000Z` | — | LOT-017 → 600 kg; LOT-018 → 900 kg | USR-025 | active | KDE `catch_area=3` to avoid a gap |
| `EVT-020` | transformation | LOC-013 | `2026-06-21T12:00:00.000Z` | LOT-017 → 500 kg | LOT-019 → 380 kg | USR-025 | active | `Fillet line`; KDE `catch_area=3` |
| `EVT-021` | shipping | LOC-013 | `2026-06-22T15:20:00.000Z` | LOT-019 → 120 kg | — | USR-025 | active | Counterparty `Seattle Cold Partner` |

### ORG-005 — Prairie Grain Co-op

| ID | Type | Location | Event datetime | Inputs | Outputs | Recorded by | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| `EVT-022` | creation | LOC-016 | `2026-06-24T07:10:00.000Z` | — | LOT-020 → 25000 kg; LOT-021 → 12000 kg; LOT-022 → 8000 kg | USR-030 | active | `Elevator intake` |
| `EVT-023` | transformation | LOC-016 | `2026-06-26T10:30:00.000Z` | LOT-020 → 10000 kg | LOT-023 → 9000 kg | USR-030 | active | `Mill run 1`; KDE `moisture_pct=12.5` |

### 2.1 Event operation labels

| Label | Persisted row? | Meaning |
|---|---|---|
| `EVT-012` | no | Void operation on `EVT-007`; sets `status='void'`, `status_reason='Wrong destination'` |
| `EVT-011` | yes | Amendment replacement for `EVT-001`; original becomes `amended` |
| `EVT-001` | yes | First creation; ends `amended` after `EVT-011` |

### 2.2 Attachments

6 attachment metadata rows. Upload the bytes through the presigned flow before adding metadata; otherwise the add call returns `409 ATTACHMENT_NOT_UPLOADED`.

| ID | Org | Event | Filename | Content type | Size | Purpose |
|---|---|---|---|---|---|---|
| `ATT-001` | ORG-001 | EVT-001 | `harvest-log-2026-06-01.txt` | `text/plain` | 1,024 bytes | Text upload success |
| `ATT-002` | ORG-001 | EVT-003 | `wash-line-photo.png` | `image/png` | 24,576 bytes | Image upload success |
| `ATT-003` | ORG-001 | EVT-013 | `supplier-receipt.pdf` | `application/pdf` | 8,192 bytes | PDF upload success |
| `ATT-004` | ORG-002 | EVT-014 | `freezer-log.txt` | `text/plain` | 2,048 bytes | Cross-org download denial |
| `ATT-005` | ORG-003 | EVT-016 | `milk-ticket.pdf` | `application/pdf` | 4,096 bytes | Attachment list pagination |
| `ATT-006` | ORG-004 | EVT-019 | `catch-cert.jpg` | `image/jpeg` | 16,384 bytes | Allowed type check |

All filenames and contents are fake. Do not upload real certificates. Size values are arbitrary but below the 50 MiB maximum.

---

## 3. Screen: `/events` — list

Header `Events`; subtitle `Supply chain traceability events` (`EventsListPage.jsx:148-151`). Buttons: `Export` (admin/compliance only) and `Record Event` (admin/compliance/operator).

### 3.1 Table columns

| UI Label | API Field | Display rule | Citation |
|---|---|---|---|
| Type | `event_type` | Badge `Creation`, `Receiving`, `Transformation`, `Shipping`; add `VOID` or `AMENDED` badge | `EventsListPage.jsx:20-33,56-68` |
| Date & Time | `event_datetime` | `formatEventDate` | `EventsListPage.jsx:70-77` |
| Location | `location_name` | Name or `N/A` | `EventsListPage.jsx:79-87` |
| Recorded By | `recorded_by_name`, `recorded_at` | Full name plus local date | `EventsListPage.jsx:88-99` |
| Actions | — | `View Details`; `Amend Event` only for `events.amend` and active status | `EventsListPage.jsx:100-120` |

List responses are raw snake_case event rows plus `location_name`, `recorded_by_name`, and `lot_links` (`events/events.service.js:235-251`). The screen uses keyset paging with `Previous`/`Next` and `Page N` (`EventsListPage.jsx:36-38,198-222`).

### 3.2 List controls

| Control | Query | Expected |
|---|---|---|
| Previous | cursor stack pop | Returns to previous cursor page; newest-first order |
| Next | `cursor` | Next 20 rows; disabled when `hasNextPage=false` |
| `Record Event` | — | Navigates to `/events/record` |
| `Export CSV` / `Export JSON` | `POST /reports/export` | Creates an export and navigates to `/reports/exports/:id` |

There is **no search box and no type/status/source/date filter** in the UI. Use the API query parameters in §5.

### 3.3 Empty state

Title `No events recorded`; description `Record your first supply chain event to establish traceability.`; action `Record Event` only when `events.create` (`EventsListPage.jsx:181-194`).

---

## 4. Screen: `/events/record` — record event

Header `Record Event`; subtitle `Capture a Critical Tracking Event (CTE) for FSMA 204 compliance`; submit `Save Event` / `Saving…` (`RecordEventPage.jsx:298-305,508`).

### 4.1 Form fields

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Event Type * | `eventType` | `Creation` | Select; options `Creation`, `Receiving`, `Transformation`, `Shipping`; default `Receiving` | Accepted |
| Location * | `locationId` | `Main Farm` | Select from active locations; default empty | Accepted; stored UUID |
| Date & Time * | `eventDatetime` | `2026-06-01T08:00` (local) | `datetime-local` | Converted to ISO UTC |
| Supplier Name * | `counterpartyInfo.name` | `Riverside Partner Farm` | Text; visible for `receiving` only | Stored JSON `{ "name": ... }` |
| Supplier Lot Code | `counterpartyInfo.lotCode` | `RPF-SPN-77` | Text; `receiving` only | Stored JSON |
| Customer Name * | `counterpartyInfo.name` | `Bay Area Retail Depot` | Text; visible for `shipping` only | Stored JSON |
| Add Lot (Inputs) | `inputs[]` | LOT-001 | Button appends a row; visible for receiving/transformation/shipping | Row added |
| Lot | `inputs[i].lotId` | `SPN-2026-0001 — Organic Baby Spinach` | Select; lists first 100 lots | Accepted |
| Qty | `inputs[i].quantity` | `480` | Number; `min=0`, `step=0.01`; default 1 | Positive number |
| UOM | `inputs[i].uom` | `kg` | Text; default `kg` | Non-empty |
| Add Lot (Outputs) | `outputs[]` | LOT-004 | Button appends a row; visible for creation/transformation | Row added |
| Lot (output) | `outputs[i].lotId` | `MIX-2026-0001` | Select | Accepted |
| Qty (output) | `outputs[i].quantity` | `300` | Number | Positive |
| UOM (output) | `outputs[i].uom` | `kg` | Text | Non-empty |
| KDE field (dynamic) | `kdePayload.<name>` | `2026-06-01` | Text/number/date; rendered only when a selected lot's product has a custom schema | Value stored; missing required value creates a gap |
| Notes | `notes` | `Morning harvest, blocks A and B` | Textarea; optional | Stored |
| Attachments | — | choose `harvest-log-2026-06-01.txt` | File input, multiple | Uploaded after event creation |
| Save Event | — | click | Button | `201`, toast `Event created successfully` |

### 4.2 Conditional visibility

| Event type | Inputs section | Outputs section | Counterparty section |
|---|---|---|---|
| `creation` | hidden | visible | hidden |
| `receiving` | visible | hidden | visible; Supplier Name and Supplier Lot Code |
| `transformation` | visible | visible | hidden |
| `shipping` | visible | hidden | visible; Customer Name |

Citation: `RecordEventPage.jsx:33-34,383-437`.

### 4.3 Client behavior to observe

- The Location control is labelled `*` for all event types, but the API only requires it for `receiving` (`RecordEventPage.jsx:355`; `events.validation.js:41-43`). A creation event submitted through the API without `locationId` succeeds.
- Input quantity is converted with `Number(value)`; an empty field becomes `0` and fails server validation (`RecordEventPage.jsx:101-114`).
- KDE inputs are text controls. Boolean and number KDEs are not rendered as checkboxes or numeric selects; `type` is used only to set the HTML input type (`RecordEventPage.jsx:451-459`).
- Dynamic KDE fields are computed from selected lots and products; if the same KDE name appears in multiple schemas it is shown once (`RecordEventPage.jsx:122-142`).

---

## 5. Screen: `/events/:eventId` — detail

Page header `Event Details`; subtitle `Recorded on <created_at>` (`EventDetailPage.jsx:138-140`).

### 5.1 Display fields

| Section | UI Label | API Field | Display rule | Citation |
|---|---|---|---|---|
| Header badge | Status | `status` | `Active`, `Amended`, `Void` | `EventDetailPage.jsx:45-55` |
| Compliance Gaps | — | `compliance_gaps` | `No compliance gaps detected.` or list of `gap.message` | `EventDetailPage.jsx:173-192` |
| Core Information | Type | `event_type` | Badge | `EventDetailPage.jsx:198-204` |
| Core Information | Event Date | `event_datetime` | Formatted date/time | `EventDetailPage.jsx:206-207` |
| Core Information | Reason for Change | `status_reason` | Shown only when status not `active` and reason present | `EventDetailPage.jsx:210-217` |
| Core Information | Supersedes | `supersedes_event_id` | Link `Event <first 8 chars>...` | `EventDetailPage.jsx:218-226` |
| Input Lots | — | `inputs[]` | Lot code link plus `quantity uom`; `No inputs` | `EventDetailPage.jsx:232-252` |
| Output Lots | — | `outputs[]` | Lot code link plus `quantity uom`; `No outputs` | `EventDetailPage.jsx:253-272` |
| Key Data Elements | — | `kde_payload` | Each key/value; `No KDEs recorded.` | `EventDetailPage.jsx:274-295` |
| Metadata | Notes | `notes` | Text or `—` | `EventDetailPage.jsx:296-309` |
| Metadata | Source | `source` | Capitalized | `EventDetailPage.jsx:310-313` |
| Metadata | Hash | `record_hash` | Monospace, wrap anywhere | `EventDetailPage.jsx:314-317` |
| Attachments | Filename | `filename` | Name plus `Download` | `EventDetailPage.jsx:320-340` |

The detail response includes `inputs` and `outputs` from `event_lot_links` with `traceability_lot_code` and `product_id` (`events/events.service.js:284-309`). It does **not** expose `counterparty_info` in the detail cards; the field is present in the API response but not rendered.

### 5.2 Detail actions

| Action | Visibility | Dialog / behavior | Citation |
|---|---|---|---|
| Amend Event | `events.amend` and status `active` | Navigates to `/events/record?amendEventId=<id>` | `EventDetailPage.jsx:145-170`; `EventsListPage.jsx:112-116` |
| Void Event | `events.void` and status `active` | Dialog `Void Event` | `EventDetailPage.jsx:150-170,349-380` |
| Download attachment | Detail page, any reader | Calls `GET /attachments/:id/download` | `EventDetailPage.jsx:320-340` |

### 5.3 Void dialog

Title `Void Event`; description `This will mark the event as voided. This action is irreversible and affects the traceability graph.` (`EventDetailPage.jsx:352-357`).

| UI Label | API Field | Value | Input Type | Expected |
|---|---|---|---|---|
| Reason for voiding * | `voidReason` | `Recorded in error` | Textarea, required | Accepted |
| Cancel | — | click | Button | Closes |
| Void Event / Voiding... | — | click | Button | `200`, toast `Event voided successfully`; badge `Void`; amend/void actions disappear |

---

## 6. Screen: amend event

Header `Amend Event`; subtitle `Create a corrected event that supersedes the original`; submit `Amend Event` (`RecordEventPage.jsx:298-303`).

The form loads the original event and prefills type, location, datetime, notes, counterparty, inputs, outputs, and KDE payload (`RecordEventPage.jsx:73-90`).

| UI Label | API Field | Value | Input Type | Expected |
|---|---|---|---|---|
| Reason for amending (this will supersede the old event) * | `amendReason` | `Corrected harvest weight` | Text input, required | Accepted |
| Event Type * | `eventType` | original type | Select | Must equal original; changing returns `400` |
| All other fields | same as create | corrected values | Same controls | Accepted |
| Amend Event | — | click | Button | `201`, toast `Event amended successfully`; new event id returned |

The amendment creates a **new** event row with `supersedes_event_id = original`, then marks the original `amended` (`events/events.service.js:386-407`). The replacement inherits the original `source` (`events/events.service.js:384`).

---

## 7. Validation and negative cases

### 7.1 Zod rules

| Field | Rule | Exact message | Citation |
|---|---|---|---|
| `eventType` | enum of four values | `Invalid option: expected one of "creation"\|"receiving"\|"transformation"\|"shipping"` | `events.validation.js:10` |
| `locationId` | UUID, optional | `Invalid uuid` | `events.validation.js:11` |
| `eventDatetime` | ISO datetime | `Invalid ISO datetime` | `events.validation.js:12` |
| `source` | enum | `Invalid option: expected one of "manual"\|"scan"\|"import"\|"api"` | `events.validation.js:13` |
| `kdePayload` | record, any | `Expected object, received ...` | `events.validation.js:14` |
| `notes` | optional string | No max; no message | `events.validation.js:15` |
| `counterpartyInfo` | optional record | `Expected object` | `events.validation.js:16` |
| `inputs[].lotId` | UUID | `Invalid uuid` | `events.validation.js:3-7` |
| `inputs[].quantity` | positive number | `Too small: expected number to be >0` | `events.validation.js:5` |
| `inputs[].uom` | min 1 | `Too small: expected string to have >=1 characters` | `events.validation.js:6` |
| Shape refinement | type-specific counts | `Invalid inputs/outputs for the specified eventType` | `events.validation.js:19-34` |
| Shipping outputs | must be empty | `Shipping events have no output lots` | `events.validation.js:35-37` |
| Receiving outputs | must be empty | `Receiving events have no output lots` | `events.validation.js:38-40` |
| Receiving location | required | `Receiving location is required` | `events.validation.js:41-43` |
| `amendReason` | min 1 | `Reason is required to amend an event` | `events.validation.js:46-48` |
| `voidReason` | min 1 | `Void reason is required` | `events.validation.js:50-52` |
| Query `page` | not allowed (strict) | `Unrecognized key(s) in object: 'page'` | `events.validation.js:72-82` |
| Query `limit` | 1–100, default 20 | `Too big: expected number to be <=100` | `events.validation.js:73` |
| Query dates | ISO datetime | `Invalid ISO datetime` | `events.validation.js:80-81` |

### 7.2 Negative cases

| ID | Case | Request / input | Expected |
|---|---|---|---|
| `NEG-EVT-01` | Creation with no outputs | `{"eventType":"creation",...}` | `422`, root, `Invalid inputs/outputs for the specified eventType` |
| `NEG-EVT-02` | Receiving with no inputs | `{"eventType":"receiving",...}` | `422`, root, same message |
| `NEG-EVT-03` | Transformation with inputs only | no outputs | `422`, root, same message |
| `NEG-EVT-04` | Shipping with no inputs | no inputs | `422`, root, same message |
| `NEG-EVT-05` | Shipping with an output lot | add output | `422`, field `outputs`, `Shipping events have no output lots` |
| `NEG-EVT-06` | Receiving with an output lot | add output | `422`, field `outputs`, `Receiving events have no output lots` |
| `NEG-EVT-07` | Receiving without location | omit `locationId` | `422`, field `locationId`, `Receiving location is required` |
| `NEG-EVT-08` | Creation without location via API | omit `locationId` | `201`; location is optional for non-receiving |
| `NEG-EVT-09` | Quantity 0 | input quantity 0 | `422`, field `inputs.0.quantity`, `Too small: expected number to be >0` |
| `NEG-EVT-10` | Quantity negative | input quantity -5 | `422`, same field, same message |
| `NEG-EVT-11` | UOM empty | `uom: ""` | `422`, field `inputs.0.uom`, min message |
| `NEG-EVT-12` | Lot UUID malformed | `lotId: "abc"` | `422`, field `inputs.0.lotId`, `Invalid uuid` |
| `NEG-EVT-13` | Foreign lot | ORG-002 lot UUID with ORG-001 token | `404`, message `One or more lots not found` (`utils/tenantLots.js`) |
| `NEG-EVT-14` | Unknown location | random UUID | `404`, message `Location not found` |
| `NEG-EVT-15` | Foreign location | ORG-002 location UUID with ORG-001 token | `404`, message `Location not found` |
| `NEG-EVT-16` | Event datetime without timezone | `"2026-06-01T08:00:00"` | `422`, field `eventDatetime`, `Invalid ISO datetime` |
| `NEG-EVT-17` | Bad event type | `"harvest"` | `422`, field `eventType`, enum message |
| `NEG-EVT-18` | Bad source | `"excel"` | `422`, field `source`, enum message |
| `NEG-EVT-19` | Void an amended event | `EVT-001` after amendment | `409`, message `Event is not active`, code `EVENT_IMMUTABLE` |
| `NEG-EVT-20` | Void a void event | `EVT-007` again | `409`, same |
| `NEG-EVT-21` | Amend an amended event | `EVT-001` again | `409`, same |
| `NEG-EVT-22` | Amend with a different event type | creation → shipping | `400`, message `Event type cannot change when amending an event`, code `VALIDATION_ERROR` |
| `NEG-EVT-23` | Amend with empty reason | `amendReason: ""` | `422`, field `amendReason`, `Reason is required to amend an event` |
| `NEG-EVT-24` | Void with empty reason | `voidReason: ""` | `422`, field `voidReason`, `Void reason is required` |
| `NEG-EVT-25` | `GET /events?page=2` | — | `422`, root, `Unrecognized key(s) in object: 'page'` |
| `NEG-EVT-26` | `GET /events?limit=0` | — | `422`, field `limit`, min 1 |
| `NEG-EVT-27` | `GET /events?limit=101` | — | `422`, field `limit`, max 100 |
| `NEG-EVT-28` | `GET /events?eventType=harvest` | — | `422`, field `eventType`, enum message |
| `NEG-EVT-29` | `GET /events?dateFrom=2026-06-01` | — | `422`, field `dateFrom`, `Invalid ISO datetime` |
| `NEG-EVT-30` | Operator voids | USR-005 | `403`, message `Insufficient permissions to access this resource` |
| `NEG-EVT-31` | Auditor creates event | USR-008 | `403`, same |
| `NEG-EVT-32` | Cross-tenant detail | ORG-001 token + `EVT-014` UUID | `404`, message `Event not found` |
| `NEG-EVT-33` | Cross-tenant amend | same | `404`, message `Event not found` |
| `NEG-EVT-34` | Cross-tenant void | same | `404`, message `Event not found` |
| `NEG-EVT-35` | Attachment type `image/gif` | presigned request | `422`, message `Attachment type is not allowed` |
| `NEG-EVT-36` | Attachment filename 256 chars | presigned request | `422`, field `filename`, max 255 |
| `NEG-EVT-37` | Attachment add before upload | add metadata with a valid pending id | `409`, message `Attachment has not been uploaded`, code `ATTACHMENT_NOT_UPLOADED` |
| `NEG-EVT-38` | Attachment >50 MiB | upload a 51 MiB file then add | `422`, message `Attachment exceeds the 50 MiB size limit` |
| `NEG-EVT-39` | Attachment MIME mismatch | upload `text/plain`, declare `image/png` | `422`, message `Attachment content type does not match the upload request` |
| `NEG-EVT-40` | Download pending attachment | id of pending row | `404`, message `Attachment not found` |
| `NEG-EVT-41` | Cross-tenant attachment download | ORG-002 attachment id with ORG-001 token | `404`, message `Attachment not found` |
| `NEG-EVT-42` | Idempotency key reused with different body | same key, changed qty | `409`, code `IDEMPOTENCY_KEY_REUSED`, message `Idempotency key was already used with a different request` |
| `NEG-EVT-43` | Concurrent identical request | same key, same body, in flight | `409`, code `IDEMPOTENCY_KEY_IN_PROGRESS`, message `An identical request is still being processed; retry with the same Idempotency-Key` |

Exact role-denial body:

```json
{
  "success": false,
  "message": "Insufficient permissions to access this resource",
  "error": { "code": "AUTH_FORBIDDEN" }
}
```

`rbac.js:14` passes that custom message. The default `Insufficient permissions` in `apiResponse.forbidden` applies only when no message is supplied.

---

## 8. Idempotency

Event creation, void, amend, and both attachment mutations pass through `idempotency` (`events/events.routes.js:28,56,65,74,82`).

| Case | Expected |
|---|---|
| No `Idempotency-Key` header | Request proceeds; no replay protection (`idempotency.js:74`) |
| Key 1–255 chars | Accepted; normalized |
| Key >255 chars | `422`, field `Idempotency-Key` |
| Same key + same body after `201` | Original `201` body replayed; no duplicate event |
| Same key + different body | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key while first request is in flight | `409 IDEMPOTENCY_KEY_IN_PROGRESS` |
| Failed request (4xx/5xx) with a key | Claim deleted; retry with the same key executes again (`idempotency.js:141-151`) |

Use the keys in `03_design_notes.md:256-270`. One key per logical operation. Reuse only for retry with the identical body.

---

## 9. Lifecycle rules

### 9.1 Void

| Condition | Result |
|---|---|
| Event `active` | `200`; status `void`; reason saved; evidence row written; audit `event.void` |
| Event `amended` | `409 EVENT_IMMUTABLE`, `Event is not active` |
| Event `void` | `409 EVENT_IMMUTABLE`, `Event is not active` |
| Voiding does not delete links | Trace queries exclude void events (`trace.service.js:133-137,207-211`) |
| Void does not change lot status | Lots remain whatever they were |

### 9.2 Amend

| Condition | Result |
|---|---|
| Event `active`, same type | New event created; original `amended`; `supersedes_event_id` set |
| Different type | `400`, `Event type cannot change when amending an event` |
| Event not active | `409 EVENT_IMMUTABLE` |
| Replacement event | Has a new UUID, new `chain_seq`, new hash; source copied from original |
| Original links | Retained on the original row; trace excludes the replaced event |
| Second amendment of same original | `409`, unique partial index would also reject with `23505` |
| Amend an amendment | Allowed if the replacement is still `active`; creates a chain of supersedes |

### 9.3 Hash chain

Every event stores `prev_hash`, `record_hash`, `chain_seq`, `hash_version`, and `hash_key_id` (`20240101000007_create_events.js:23-27`). The service reads the chain tip under an organization advisory lock, allocates `chain_seq = tip + 1`, inserts a pending hash, creates links, then seals the hash in the same transaction (`events/events.service.js:76-141`). Do not expect `record_hash` to match a manually computed value unless you use the same HMAC key and canonical JSON.

The chain is ordered by `created_at DESC, chain_seq DESC` for listing (`events/events.service.js:252-257`). `chain_seq` is the authoritative order.

---

## 10. Compliance gaps

For every linked lot, the event checks the product's `custom_kde_schema`. A required field whose value is missing or falsy adds one gap (`events/compliance.js:21-35`). Duplicate field names collapse to one gap.

| Fixture | Required field | Event value | Result |
|---|---|---|---|
| `EVT-013` | `harvest_date` on PRD-001 | absent | one gap `{ "field": "harvest_date", "message": "Harvest Date is required" }` |
| `EVT-001` | `harvest_date` on PRD-001 | `2026-06-01` | no gap (amended row, still counted by the gaps page) |
| `EVT-002` | `harvest_date` on PRD-001 | `2026-06-01` | no gap |
| `EVT-003` | `harvest_date` on PRD-001/PRD-003 | `2026-06-01` | no gap |
| `EVT-004` | `harvest_date` on PRD-003 | `2026-06-01` | no gap |
| `EVT-008` | `bunch_count` on PRD-005 | `50` | no gap |
| `EVT-009` | `harvest_date` on PRD-003 | `2026-06-02` | no gap |
| `EVT-019` | `catch_area` on PRD-012 | `3` | no gap |
| `EVT-020` | `catch_area` on PRD-012 | `3` | no gap |
| `EVT-023` | `moisture_pct` on PRD-015 | `12.5` | no gap |

Every event that links a PRD-001 or PRD-003 lot must carry `harvest_date`; otherwise it adds a gap. The corrections above keep the baseline at exactly one gap (`EVT-013`) and one dashboard gap count.

Falsy-value trap: `0`, `false`, `""`, and `null` all count as missing (`events/compliance.js:28`). A required boolean KDE cannot be satisfied with `false`.

Generated column `has_compliance_gaps` is true only when `compliance_gaps` is a non-empty array (`20240101000007_create_events.js:47-52`).

---

## 11. Attachments

### 11.1 Presigned upload

| Step | Request | Expected |
|---|---|---|
| 1 | `POST /events/:eventId/attachments/presigned-url` with `{"filename":"harvest-log.txt","contentType":"text/plain"}` | `200`; `{ uploadUrl, attachmentId }`; attachment row `status='pending'` |
| 2 | `PUT <uploadUrl>` with raw bytes and `Content-Type: text/plain` | `200` from object storage `[INFRA]` |
| 3 | `POST /events/:eventId/attachments` with `{"attachmentId":"<uuid>"}` | `201`; message `Attachment added successfully`; row `status='uploaded'`; size and MIME from storage |
| 4 | `GET /events/:eventId/attachments` | Only `uploaded` rows, newest first, standard pagination |

Allowed types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `text/plain` (`events/events.service.js:22-29`).

### 11.2 Attachment fields

| UI Label | API Field | Type | Notes |
|---|---|---|---|
| — | `id` | UUID | Server-generated |
| — | `parentType` | `event` | Fixed |
| — | `parentId` | UUID | Event id |
| Filename | `filename` | text | 1–255 chars |
| — | `contentType` | text | 1–255 chars; must be allowed |
| — | `sizeBytes` | integer | Set from storage; not client-supplied |
| — | `uploadedBy` | UUID | Current user |
| — | `status` | `pending`, `uploaded`, `deleting`, `deleted` | Only `uploaded` appears in list |
| — | `createdAt`, `uploadedAt` | timestamps | `uploadedAt` null until confirmed |

There is no attachment deletion UI and no delete button. The delete endpoint exists at `DELETE /api/v1/attachments/:attachmentId` for `org_admin` and `compliance_manager` only (`backend/src/app.js:106-112`), and deletion is soft: status `deleted`, audit `attachment.delete`, evidence appended (`events/events.service.js:567-605,633-660`).

---

## 12. List query, search, and pagination matrix

The API supports filters that the UI does not expose (`events/events.validation.js:72-82`; `events/events.service.js:212-225`).

| ID | Request | Expected ORG-001 result |
|---|---|---|
| `F-EVT-01` | `GET /events` | 12 rows, newest created first; includes `EVT-001` (amended) and `EVT-007` (void); no default status filter |
| `F-EVT-02` | `?limit=5` | 5 rows; `hasNextPage=true`; `nextCursor` non-null |
| `F-EVT-03` | `?eventType=creation` | 7 rows: EVT-001, 005, 006, 008, 009, 010, 011 |
| `F-EVT-04` | `?eventType=receiving` | 2 rows: EVT-002, EVT-013 |
| `F-EVT-05` | `?eventType=shipping` | 2 rows: EVT-004 (active), EVT-007 (void) |
| `F-EVT-06` | `?status=void` | EVT-007 |
| `F-EVT-07` | `?status=amended` | EVT-001 |
| `F-EVT-08` | `?source=manual` | All 12 unless an event was created by import/PWA |
| `F-EVT-09` | `?locationId=<LOC-003>` | EVT-004 and EVT-007 |
| `F-EVT-10` | `?lotId=<LOT-001>` | EVT-001, EVT-002, EVT-003, EVT-011 |
| `F-EVT-11` | `?dateFrom=2026-06-02T00:00:00.000Z&dateTo=2026-06-03T23:59:59.999Z` | EVT-002, EVT-003, EVT-004, EVT-009 |
| `F-EVT-12` | `?eventType=creation&limit=2` then next cursor | Stable keyset paging; no duplicates |
| `F-EVT-13` | `?cursor=garbage` | `500` or `422` from cursor decode; record actual `[UNVERIFIED-RUNTIME]` |
| `F-EVT-14` | ORG-002 token `GET /events` | 2 rows: EVT-014, EVT-015 |
| `F-EVT-15` | ORG-001 token `?lotId=<LOT-011>` | 0 rows; foreign lot id is not rejected, it simply matches nothing |

The last row is a tenant-information leak check: `lotId` is a UUID filter with no ownership validation in the list query. It returns an empty list, not `404`, so it does not confirm existence.

---

## 13. Payload reference

### Creation with two outputs

```json
{
  "eventType": "creation",
  "locationId": "<LOC-001-uuid>",
  "eventDatetime": "2026-06-01T08:00:00.000Z",
  "source": "manual",
  "kdePayload": {},
  "notes": "Morning harvest, blocks A and B",
  "inputs": [],
  "outputs": [
    { "lotId": "<LOT-001-uuid>", "quantity": 500, "uom": "kg" },
    { "lotId": "<LOT-002-uuid>", "quantity": 320, "uom": "kg" }
  ]
}
```

Expected `201`, message `Event created successfully`. `data.status = "active"`, `data.chain_seq` is the next integer, `data.record_hash` is a hex HMAC.

### Receiving

```json
{
  "eventType": "receiving",
  "locationId": "<LOC-002-uuid>",
  "eventDatetime": "2026-06-02T09:15:00.000Z",
  "source": "manual",
  "counterpartyInfo": { "name": "Riverside Partner Farm", "lotCode": "RPF-SPN-77" },
  "notes": "Received via refrigerated truck",
  "inputs": [{ "lotId": "<LOT-001-uuid>", "quantity": 480, "uom": "kg" }],
  "outputs": []
}
```

### Transformation

```json
{
  "eventType": "transformation",
  "locationId": "<LOC-002-uuid>",
  "eventDatetime": "2026-06-02T09:15:00.000Z",
  "source": "manual",
  "kdePayload": { "harvest_date": "2026-06-01" },
  "inputs": [
    { "lotId": "<LOT-001-uuid>", "quantity": 250, "uom": "kg" },
    { "lotId": "<LOT-003-uuid>", "quantity": 100, "uom": "kg" }
  ],
  "outputs": [{ "lotId": "<LOT-004-uuid>", "quantity": 300, "uom": "kg" }]
}
```

### Shipping

```json
{
  "eventType": "shipping",
  "locationId": "<LOC-003-uuid>",
  "eventDatetime": "2026-06-03T14:30:00.000Z",
  "source": "manual",
  "counterpartyInfo": { "name": "Bay Area Retail Depot" },
  "inputs": [{ "lotId": "<LOT-004-uuid>", "quantity": 200, "uom": "kg" }],
  "outputs": []
}
```

### Void

```json
{ "voidReason": "Wrong destination" }
```

### Amend

```json
{
  "eventType": "creation",
  "locationId": "<LOC-001-uuid>",
  "eventDatetime": "2026-06-01T08:05:00.000Z",
  "source": "manual",
  "kdePayload": { "harvest_date": "2026-06-01" },
  "amendReason": "Corrected harvest time and KDE",
  "notes": "Corrected harvest record",
  "inputs": [],
  "outputs": [
    { "lotId": "<LOT-001-uuid>", "quantity": 500, "uom": "kg" },
    { "lotId": "<LOT-002-uuid>", "quantity": 320, "uom": "kg" }
  ]
}
```

`source` is ignored and replaced with the original source (`events/events.service.js:384`).

### List response shape

```json
{
  "success": true,
  "message": "Events fetched successfully",
  "data": [
    {
      "id": "<uuid>",
      "organization_id": "<uuid>",
      "event_type": "creation",
      "location_id": "<uuid>",
      "counterparty_info": null,
      "event_datetime": "2026-06-01T08:00:00.000Z",
      "recorded_by": "<uuid>",
      "recorded_at": "2026-06-01T08:00:00.000Z",
      "source": "manual",
      "kde_payload": {},
      "compliance_gaps": null,
      "has_compliance_gaps": false,
      "notes": "Morning harvest",
      "record_hash": "<hex>",
      "prev_hash": "<hex>",
      "chain_seq": 1,
      "hash_version": 3,
      "hash_key_id": "<key-id>",
      "status": "active",
      "supersedes_event_id": null,
      "status_reason": null,
      "created_at": "2026-06-01T08:00:00.000Z",
      "location_name": "Main Farm",
      "recorded_by_name": "Elena Rossi",
      "lot_links": [
        { "id": "<uuid>", "traceabilityLotCode": "SPN-2026-0001", "direction": "output", "quantity": "500.0000", "uom": "kg" }
      ]
    }
  ],
  "pagination": { "limit": 20, "hasNextPage": false, "nextCursor": null }
}
```

`lot_links` is aggregated JSON from a subquery whose order is not guaranteed (`events/events.service.js:242-247`). Do not assert link order. `[UNVERIFIED-RUNTIME]`

---

## 14. Audit expectations

| Action | Audit row? | Action value | Citation |
|---|---|---|---|
| Create event | **No** | — | `events/events.routes.js:24-30` has no `auditLogger` |
| Void event | Yes, via middleware | `event.void` | `events/events.routes.js:57`; `auditLogger.js:22` |
| Amend event | Yes, via middleware; entity id is the replacement | `event.amend` | `events/events.routes.js:66`; `auditLogger.js:39-42` |
| Add attachment | No audit row | — | Route has no `auditLogger` |
| Delete attachment | Yes, service writes | `attachment.delete` | `events/events.service.js:591-601` |
| Download attachment | **No** | — | `app.js:98-104` has no `auditLogger` |

The missing `event.create` audit row is a finding for `99_discrepancies_and_findings.md`. The hash chain still proves creation, but the Audit Log page will not show new events.

---

## 15. Cleanup

- Events cannot be deleted. Void them or reset the database.
- An amended event stays visible with status `amended`; its replacement is a separate row.
- Attachments are soft-deleted; the object may remain in storage until the purge job runs (`events/events.service.js:607-631`).
- Delete import-created events only by resetting the database; the import worker has no delete path.
