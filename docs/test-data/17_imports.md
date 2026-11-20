# 17 — Imports

> Entity: `imports`. Screen: `/imports` (upload card, template card, recent imports, error dialog).
> API: `POST /imports`, `GET /imports`, `GET /imports/:id`, `GET /imports/:importId/errors`, `GET /imports/template/:cteType`.

---

## 1. Purpose and prerequisites

Bulk import creates events from CSV. It does **not** create locations or products; both must already exist and be active. It can create lots that do not exist yet.

| Rule | Value | Citation |
|---|---|---|
| Upload roles | `org_admin`, `compliance_manager`, `operator` | `imports/routes.js:48-55` |
| Read roles | Any authenticated role, including `auditor` | `imports/routes.js:25-46` |
| File size | 10 MiB | `imports/routes.js:13-23` |
| File type | MIME `text/csv` or filename ending `.csv` | `imports/routes.js:16-22` |
| Empty file | `422`, message `Uploaded file is empty`, code `IMPORT_INVALID_FORMAT` | `imports/controller.js:24-27` |
| Required body field | `cte_type` enum | `imports/validation.js:6-8` |
| Statuses | `pending`, `processing`, `complete`, `complete_with_errors`, `failed` | `imports/validation.js:12`; `import-processor.js:224-233` |
| Worker rate | 5 files per minute, concurrency 2 | `import-processor.js:279-283` |
| Import queue | BullMQ `import-queue`, job `process-import` | `imports/service.js:162-168` |
| Import event source | `import` | `import-event.js:118` |
| Import KDE payload | Always `{}` | `import-event.js:98-106,119` |
| Error report | JSON array in object storage, not CSV | `import-processor.js:213-222` |
| Duplicate transaction | Skipped silently by `idempotency_key = import_<org>_<transaction_id>` | `import-event.js:17-27` |

Create users, locations, and products first. Use active locations and active products only.

---

## 2. Record set

10 import jobs. Row counts are explained in `40_import_files.md`. `valid_rows` is the number of CSV rows in successfully processed transaction groups, not the number of events. `error_rows` is the number of error messages, which can exceed the number of failing rows.

| ID | Org | Filename | CTE type | Status | Total rows | Valid rows | Error rows | Created by | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `IMP-001` | ORG-001 | `IMP-001_receiving_valid.csv` | receiving | complete | 2 | 2 | 0 | USR-007 | Two receiving events |
| `IMP-002` | ORG-001 | `IMP-002_creation_errors.csv` | creation | complete_with_errors | 4 | 1 | 3 | USR-007 | Mixed errors; one good group |
| `IMP-003` | ORG-001 | `IMP-003_transformation_valid.csv` | transformation | complete | 5 | 5 | 0 | USR-003 | Two transformation groups |
| `IMP-004` | ORG-001 | `IMP-004_shipping_errors.csv` | shipping | failed | 3 | 0 | 3 | USR-005 | All rows invalid |
| `IMP-005` | ORG-001 | `IMP-005_header_only.csv` | creation | failed | 0 | 0 | 0 | USR-007 | Header only; no error report, no notification |
| `IMP-006` | ORG-001 | `IMP-006_creation_valid.csv` | creation | complete | 3 | 3 | 0 | USR-007 | Three outputs in one transaction |
| `IMP-007` | ORG-001 | `IMP-007_transformation_group_error.csv` | transformation | failed | 3 | 0 | 1 | USR-003 | Group missing an output row |
| `IMP-008` | ORG-002 | `IMP-008_receiving_northwind.csv` | receiving | complete | 1 | 1 | 0 | USR-013 | Cross-tenant isolation |
| `IMP-009` | ORG-005 | `IMP-009_creation_prairie.csv` | creation | complete | 3 | 3 | 0 | USR-030 | Bulk grain intake |
| `IMP-010` | ORG-005 | `IMP-010_transformation_prairie_errors.csv` | transformation | failed | 2 | 0 | 1 | USR-030 | Group has no output row |

### 2.1 Status definitions

| Status | UI label | Meaning |
|---|---|---|
| `pending` | Pending | Row inserted, job queued, worker has not started |
| `processing` | Processing | Worker started, spinner |
| `complete` | Complete | All rows valid, no errors |
| `complete_with_errors` | Partial | At least one row group committed, at least one error |
| `failed` | Failed | No group committed, or empty file, or infrastructure failure |

UI mapping: `ImportPage.jsx:24-30,35-46`.

---

## 3. Screen: `/imports`

Header `Bulk Import`; subtitle `Upload CSV files to create traceability events in bulk across all CTE types.` (`ImportPage.jsx:291-294`).

### 3.1 Upload card

Card title `Upload CSV`; description `Select event type and upload your data file.` (`ImportPage.jsx:299-306`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Event Type | `cte_type` | `Receiving` | Select; default `Receiving`; options Creation, Receiving, Transformation, Shipping | Accepted |
| CSV File | `file` | `receiving_valid.csv` | Drag-and-drop or browse; `accept=".csv"` | Accepted; filename and size shown |
| Remove file | — | click X | Icon button | Clears selection |
| Upload & Process | — | click | Button, disabled until a file is selected | `201`, toast `Import queued`; job appears in Recent Imports |
| Uploading... | — | — | Button busy state | No duplicate submit |

Client-side file checks (`ImportPage.jsx:240-257`):

| Check | Message |
|---|---|
| Extension not `.csv` | `Only CSV files are accepted` |
| Size >10 MiB | `File exceeds 10 MB limit` |
| Size 0 | `File is empty` |

The upload zone text is `Drop CSV file here or browse` and `Max 10 MB · .csv only` (`ImportPage.jsx:121-124`).

### 3.2 Template card

Card title `CSV Templates`; one button per CTE type (`ImportPage.jsx:362-381`). Each downloads `<type>_import_template.csv` via `GET /imports/template/<type>` (`imports/api.js:80-93`).

### 3.3 Recent Imports card

Title `Recent Imports`; auto-refresh every 5 seconds while any import is `pending` or `processing` (`ImportPage.jsx:223-236,386-405`). The list is fixed to `page=1, limit=50`; there is no visible pager (`ImportPage.jsx:225-231`).

| UI Element | API Field | Display | Citation |
|---|---|---|---|
| Filename | `filename` | File icon plus name | `ImportPage.jsx:433-437` |
| CTE type | `cte_type` | Outline badge, capitalized | `ImportPage.jsx:439-441` |
| Relative time | `created_at` | `formatDistanceToNow` | `ImportPage.jsx:442` |
| Creator | `created_by_name` | `by <name>` | `ImportPage.jsx:443` |
| Imported count | `valid_rows` | `<n> imported` in green | `ImportPage.jsx:448-452` |
| Error link | `error_rows` | `<n> errors →`, opens dialog | `ImportPage.jsx:453-459` |
| Total count | `total_rows` | `<n> total` | `ImportPage.jsx:460` |
| Status | `status` | Pending/Processing/Complete/Partial/Failed badge | `ImportPage.jsx:465-466` |

Empty state: `No imports yet` / `Upload a CSV file to get started.` (`ImportPage.jsx:418-424`).

There is no status or CTE filter in the UI, no cancel button, no retry button, and no import detail page. The single-import endpoint is unused by the web app.

### 3.4 Error dialog

Title `Import Errors`; table columns `Row`, `Error`; empty text `No errors found.` (`ImportPage.jsx:129-214`).

| UI Element | API Field | Display |
|---|---|---|
| Row | `row` | Number, monospace |
| Error | `message` | Red text |
| Pager | `pagination` | Previous/Next, 50 per page; `Showing N of M errors` |

The dialog calls `GET /imports/:id/errors?page=N&limit=50`.

---

## 4. CSV templates

Templates are generated in code. Header order is exact. Example rows use fake values from `imports/service.js:57-143`.

### Creation

```csv
transaction_id,event_datetime,location_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-001,2024-06-15T08:00:00.000Z,Main Farm,Morning harvest,LOT-2024-001,Organic Spinach,500,kg
TRX-001,2024-06-15T08:00:00.000Z,Main Farm,Morning harvest,LOT-2024-002,Organic Kale,300,kg
```

### Receiving

```csv
transaction_id,event_datetime,location_name,counterparty_name,notes,traceability_lot_code,product_name,quantity,uom,counterparty_lot_code
TRX-002,2024-06-16T10:30:00.000Z,Processing Plant,Green Farms LLC,Received via refrigerated truck,LOT-2024-003,Organic Spinach,480,kg,GF-LOT-887
```

### Shipping

```csv
transaction_id,event_datetime,location_name,counterparty_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-003,2024-06-17T14:00:00.000Z,Distribution Center,FreshMart Stores,Shipped to East region,LOT-2024-004,Bagged Spinach 1lb,200,units
```

### Transformation

```csv
transaction_id,event_datetime,location_name,notes,direction,traceability_lot_code,product_name,quantity,uom
TRX-004,2024-06-16T15:00:00.000Z,Processing Plant,Washed and packaged,input,LOT-2024-001,Organic Spinach,250,kg
TRX-004,2024-06-16T15:00:00.000Z,Processing Plant,Washed and packaged,input,LOT-2024-002,Organic Kale,100,kg
TRX-004,2024-06-16T15:00:00.000Z,Processing Plant,Washed and packaged,output,LOT-2024-005,Mixed Greens 1lb,150,units
```

Column sources: `TEMPLATE_COLUMNS` at `imports/service.js:10-55`; examples at `imports/service.js:58-143`.

**Required columns in the worker differ from the template.** The worker requires these only (`import-processor.js:21-26`):

| CTE type | Required columns |
|---|---|
| creation | `transaction_id`, `traceability_lot_code`, `product_name`, `quantity`, `uom`, `location_name`, `event_datetime` |
| receiving | same as creation |
| shipping | same as creation |
| transformation | creation columns plus `direction` |

`counterparty_name` and `counterparty_lot_code` are optional. `notes` is optional. A template with those columns blank still imports.

---

## 5. Processing rules

### 5.1 Row validation

Worker errors are exact strings (`import-processor.js:32-70`):

| Condition | Exact error |
|---|---|
| Required cell empty | `Row N: Missing required field '<column>'` |
| Quantity not numeric | `Row N: 'quantity' must be a number, got '<value>'` |
| Quantity <=0 | `Row N: 'quantity' must be positive` |
| Bad datetime | `Row N: 'event_datetime' is not a valid ISO date, got '<value>'` |
| Bad direction | `Row N: 'direction' must be 'input' or 'output', got '<value>'` |

`N` is the file line number: data row index + 2 (header is line 1) (`import-processor.js:149`). A missing required field produces one error per missing column. A row can produce several errors.

### 5.2 Grouping

Rows group by `transaction_id`. One transaction group becomes one event. For `transformation`, every group must contain at least one `input` and one `output`; otherwise the whole group is dropped and one error is added (`import-processor.js:162-175`):

```text
Transaction <id> must have at least one 'input' row and one 'output' row for Transformation.
```

The row number in that error is the first row of the group.

### 5.3 Lookups and lot creation

- Location names are matched case-insensitively after trim against **active** locations (`import-processor.js:75-93`).
- Product names are matched the same way against **active** products.
- A missing location aborts the group: `Transaction <id> Failed: Location '<name>' not found for transaction <id>`.
- A missing product aborts the group: `Transaction <id> Failed: Product '<name>' not found in transaction <id>`.
- An existing lot is reused when `organization_id`, `product_id`, and `traceability_lot_code` match and status is not `void` (`import-event.js:54-62`).
- A new lot is created with the row's quantity and UOM when no match exists (`import-event.js:64-73`).
- An inactive location or product cannot be resolved even if it exists in the database.

### 5.4 Link directions

| CTE type | Direction |
|---|---|
| creation | `output` |
| receiving | `input` |
| shipping | `input` |
| transformation | per row: `input` or `output` |

Source: `import-direction.js:6-33`. Shipping has no output lot; this matches manual event validation.

### 5.5 Compliance gaps on import

Import events always set `kde_payload = {}` and never read KDE columns (`import-event.js:98-106,119`). Every imported event whose product has a required custom KDE gets a compliance gap.

| Product | Required KDE | Imported event result |
|---|---|---|
| PRD-001 | `harvest_date` | gap |
| PRD-003 | `harvest_date` | gap |
| PRD-005 | `bunch_count` | gap |
| PRD-012 | `catch_area` | gap |
| PRD-015 | `moisture_pct` | no gap; field is optional |

This is a product/import interaction finding for `99_discrepancies_and_findings.md`.

### 5.6 Re-upload and idempotency

The worker builds `idempotency_key = import_<organizationId>_<transaction_id>` and skips an existing event with that key (`import-event.js:17-27`). Consequences:

- Re-uploading the same file does not duplicate events.
- Reused transaction IDs silently reuse the first event; there is no warning.
- `valid_rows` still counts the skipped rows, so a re-upload shows `complete` with the same counts although no new events were created.
- The unique constraint is `(organization_id, idempotency_key)` (`20240101000007_create_events.js:40`).

---

## 6. Status and notification behavior

| Outcome | Condition | Status | Notification |
|---|---|---|---|
| All rows valid | `errorCount = 0`, `validGroupsCount > 0` | `complete` | `import_complete`, `Import completed successfully` |
| Some groups valid, some errors | `errorCount > 0`, `validGroupsCount > 0` | `complete_with_errors` | `Import completed with errors` |
| No valid groups, errors present | `validGroupsCount = 0`, `errorCount > 0` | `failed` | `Import failed` |
| Header-only CSV | `rows.length = 0` | `failed` | **No notification**; early return (`import-processor.js:130-139`) |
| Unhandled worker error | exception | `failed` | No notification in the catch block (`import-processor.js:271-276`) |

Notification fields (`import-processor.js:247-263`):

| Field | Value |
|---|---|
| `type` | `import_complete` |
| `title` | `Import <completed successfully\|completed with errors\|failed>` |
| `message` | `Your <cte_type> CSV import "<filename>" <status>. <validRows> rows imported, <errorCount> errors.` The worker uses the storage basename, which is `<epoch_ms>_<original filename>` (`imports/controller.js:30`; `import-processor.js:257-259`) |
| `link` | `/imports` |
| `entity_type` | `import` |
| `entity_id` | import id |

---

## 7. API reference

### 7.1 Create import

`POST /api/v1/imports` with `multipart/form-data`:

| Part | Value |
|---|---|
| `file` | CSV binary |
| `cte_type` | `creation`, `receiving`, `transformation`, or `shipping` |

Headers: bearer token. Do not set `Content-Type` manually with a boundary mismatch; let the client set it.

Success `201`:

```json
{
  "success": true,
  "message": "Import created and queued for processing",
  "data": {
    "id": "<uuid>",
    "organization_id": "<uuid>",
    "filename": "receiving_valid.csv",
    "storage_key": "imports/org_<uuid>/<timestamp>_receiving_valid.csv",
    "cte_type": "receiving",
    "status": "pending",
    "total_rows": null,
    "valid_rows": null,
    "error_rows": null,
    "error_report_key": null,
    "job_id": "1",
    "created_by": "<uuid>",
    "started_at": null,
    "completed_at": null,
    "created_at": "2026-06-28T10:00:00.000Z"
  }
}
```

### 7.2 List imports

`GET /imports?page=1&limit=20&status=complete&cteType=receiving`

| Query | Values | Default |
|---|---|---|
| `page` | >=1 | 1 |
| `limit` | 1–100 | 20 |
| `status` | five statuses | none |
| `cteType` | four CTE types | none |

Response rows are raw snake_case imports plus `created_by_name`, ordered `created_at desc` (`imports/service.js:181-199`).

### 7.3 Get one

`GET /imports/:id` returns `200` with `data` or `404 Import not found`. The route has no UUID validation; a malformed id may produce a database error `[UNVERIFIED-RUNTIME]`.

### 7.4 Errors

`GET /imports/:importId/errors?page=1&limit=50`

| Case | Response |
|---|---|
| Import exists, no error report | `200`, `data: []`, pagination total 0 |
| Import exists with errors | `200`, slices the JSON array |
| Import missing or cross-tenant | `404 Import not found` |

The error report is a JSON array: `[{ "row": 3, "message": "Row 3: Missing required field 'quantity'" }]`. Despite the column comment saying CSV (`20240101000011_create_imports.js:16`), the worker writes JSON (`import-processor.js:216-221`).

### 7.5 Templates

`GET /imports/template/:cteType` returns `text/csv` with `Content-Disposition: attachment; filename="<type>_import_template.csv"` (`imports/controller.js:92-100`).

| Case | Response |
|---|---|
| Valid type | `200` CSV |
| `harvest` | `422`, field `cteType`, message `Invalid CTE type` |
| No auth | `401` |

Any authenticated role can download templates, including `auditor`.

---

## 8. Negative cases

| ID | Case | Expected |
|---|---|---|
| `NEG-IMP-01` | Upload without a file | `422`, message `CSV file is required`, code `VALIDATION_ERROR` |
| `NEG-IMP-02` | Upload `.txt` | Multer error `Only CSV files are allowed`; global handler returns `500` with that message `[UNVERIFIED-RUNTIME]` |
| `NEG-IMP-03` | Upload a file with `.csv` but MIME `application/pdf` | Accepted by filename fallback (`imports/routes.js:16-18`) |
| `NEG-IMP-04` | Upload 11 MiB | Multer `LIMIT_FILE_SIZE`; `500 File too large` `[UNVERIFIED-RUNTIME]`; UI blocks with `File exceeds 10 MB limit` |
| `NEG-IMP-05` | Upload 0-byte file | `422`, message `Uploaded file is empty`, code `IMPORT_INVALID_FORMAT`; **no import row is created** (`imports/controller.js:24-27`) |
| `NEG-IMP-06` | Missing `cte_type` | `422`, field `cte_type`, enum/message |
| `NEG-IMP-07` | `cte_type=harvest` | `422`, field `cte_type`, message `cte_type must be one of: creation, receiving, transformation, shipping` |
| `NEG-IMP-08` | Auditor uploads | `403`, message `Insufficient permissions to access this resource` |
| `NEG-IMP-09` | Auditor lists imports | `200`; allowed |
| `NEG-IMP-10` | Cross-tenant import id | `404 Import not found` |
| `NEG-IMP-11` | Cross-tenant error report | `404 Import not found` |
| `NEG-IMP-12` | `status=partial` | `422`, field `status`, enum message; use `complete_with_errors` |
| `NEG-IMP-13` | `limit=101` | `422`, field `limit`, max 100 |
| `NEG-IMP-14` | CSV with only a header | Worker sees 0 rows, status `failed`, `total_rows=0`, no error report |
| `NEG-IMP-15` | CSV with no header | First data row is treated as column names; required fields missing for all rows |
| `NEG-IMP-16` | CSV with BOM | Parsed correctly; parser has `bom: true` (`import-processor.js:118-124`) |
| `NEG-IMP-17` | Extra column | Ignored; `relax_column_count: true` |
| `NEG-IMP-18` | Quoted commas | Parsed by `csv-parse`; test with a product name containing a comma |
| `NEG-IMP-19` | CRLF line endings | Parsed; test |
| `NEG-IMP-20` | Duplicate `transaction_id` in one file | Rows combine into one event; check link count |
| `NEG-IMP-21` | Duplicate `transaction_id` across files | Second file skips the group silently; counts still report imported |
| `NEG-IMP-22` | `event_datetime` in local time with no zone | `new Date("2026-06-01T08:00:00")` is accepted and interpreted in server local time; no error |
| `NEG-IMP-23` | `event_datetime` impossible date `2026-02-30` | JavaScript normalizes to March 2; no error `[VERIFIED-CODE]` |
| `NEG-IMP-24` | Quantity `1,000` | `Number("1,000")` is `NaN`; error `'quantity' must be a number, got '1,000'` |
| `NEG-IMP-25` | Quantity `1e3` | `Number` accepts 1000; imported |
| `NEG-IMP-26` | Quantity `0` | `Row N: 'quantity' must be positive` |
| `NEG-IMP-27` | Negative quantity | Same message |
| `NEG-IMP-28` | Unknown location name | Group error `Transaction ... Failed: Location 'X' not found for transaction ...` |
| `NEG-IMP-29` | Inactive location name | Same as unknown; cache includes active only |
| `NEG-IMP-30` | Unknown product name | Group error `Transaction ... Failed: Product 'X' not found in transaction ...` |
| `NEG-IMP-31` | Direction uppercase `INPUT` | Accepted; worker lowercases (`import-processor.js:63-65`) |
| `NEG-IMP-32` | Direction `consume` | `Row N: 'direction' must be 'input' or 'output', got 'consume'` |
| `NEG-IMP-33` | Transformation group with only inputs | `Transaction <id> must have at least one 'input' row and one 'output' row for Transformation.` |
| `NEG-IMP-34` | Import event for product with required KDE | Event created with `compliance_gaps`; no way to supply KDE in CSV |
| `NEG-IMP-35` | Re-upload same file | No new events; counts still show imported; notification says completed |
| `NEG-IMP-36` | Upload while worker rate-limited | Status stays `pending`; UI auto-refresh; no error |

---

## 9. Error report examples

`IMP-002` (`IMP-002_creation_errors.csv`) expected error report:

```json
[
  { "row": 2, "message": "Row 2: Missing required field 'traceability_lot_code'" },
  { "row": 3, "message": "Row 3: 'quantity' must be a number, got 'abc'" },
  { "row": 4, "message": "Row 4: 'quantity' must be positive" }
]
```

`IMP-004` (`IMP-004_shipping_errors.csv`) expected:

```json
[
  { "row": 2, "message": "Row 2: Missing required field 'location_name'" },
  { "row": 3, "message": "Row 3: 'event_datetime' is not a valid ISO date, got 'not-a-date'" },
  { "row": 4, "message": "Row 4: Missing required field 'uom'" }
]
```

`IMP-007` (`transformation_group_error.csv`) expected:

```json
[
  { "row": 2, "message": "Transaction TRX-T7 must have at least one 'input' row and one 'output' row for Transformation." }
]
```

`IMP-010` expected the same group error for `TRX-T10`.

Exact row numbers depend on the fixture files in `imports/`. Verify against `40_import_files.md` before asserting.

---

## 10. Operational tests

| ID | Action | Expected |
|---|---|---|
| `OPS-IMP-01` | Upload `receiving_valid.csv` as USR-007 | `201`; row Pending; within seconds Processing then Complete; notification |
| `OPS-IMP-02` | Open `2 errors →` on a partial import | Dialog lists rows; pager when >50 |
| `OPS-IMP-03` | Leave page while Pending | Job continues; notification on completion |
| `OPS-IMP-04` | Stop Redis, upload | `503 Export queue unavailable`? No: import enqueue throws; controller/global handler returns `500` `[UNVERIFIED-RUNTIME]`; import row may remain `pending` with no job |
| `OPS-IMP-05` | Stop worker, upload | Status stays `pending`; no failure |
| `OPS-IMP-06` | Upload 6 files quickly | First 5 process in a minute; sixth waits Pending |
| `OPS-IMP-07` | Download each template | Header order matches §4 |
| `OPS-IMP-08` | Upload a template unchanged | Creation template uses product names `Organic Spinach`, `Organic Kale`; ORG-001 has `Organic Baby Spinach` and `Organic Kale`, so spinach row fails, kale row may succeed; expect partial or failed |
| `OPS-IMP-09` | Check audit log after upload | `import.post` row from `auditLogger('import')`; verify exact action (`imports/routes.js:53`; `auditLogger.js:21`) |
| `OPS-IMP-10` | Check event source after import | `source='import'`; event detail shows `Import` |

---

## 11. Limits and known gaps

| Gap | Detail | Citation |
|---|---|---|
| No retry or cancel endpoint | A failed import must be re-uploaded | `imports/routes.js` |
| No import detail screen | Single-import endpoint is unused by UI | `imports/api.js` lacks `useGetImport` usage |
| No UI status filter | API supports `status`/`cteType`; page always requests all | `ImportPage.jsx:225-228` |
| No UI pagination | `limit=50`, page 1 only | `ImportPage.jsx:225-228` |
| Empty file has no notification | Early return skips notification block | `import-processor.js:130-139` |
| `error_rows` counts messages | Can exceed `total_rows` | `import-processor.js:225,242` |
| Status comment stale | Migration comment omits `complete_with_errors` | `20240101000011_create_imports.js:12` |
| KDE columns absent | Imported events always gap on required KDEs | `import-event.js:98-106` |
| Counterparty not required | Worker required columns omit it | `import-processor.js:21-26` |
| Template uses different products | Template examples are generic, not this pack's data | `imports/service.js:58-143` |

---

## 12. Cleanup

Imports cannot be deleted. Imported events and lots remain. To reset, truncate the database or run the reset procedure. Delete object-storage keys under `imports/org_<org>/` only in a disposable environment.
