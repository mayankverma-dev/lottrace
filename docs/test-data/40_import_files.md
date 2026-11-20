# 40 — Import Files and Upload Fixtures

> Companion to `17_imports.md`. This file defines the 10 baseline CSV files plus one optional file, their exact bytes, expected worker output, and the order to upload them.
> Fixture directory: `docs/test-data/imports/`.

---

## 1. Fixture state protocol

Imports create events and lots. They change every dashboard count and every export row count. Run the import suite **after** capturing the baseline screens, or reload the fixtures and restart.

| State | Meaning | Expected ORG-001 counts |
|---|---|---|
| `B0` | Baseline events from `15_events.md`; no imports | events 12, lots 11, dashboard activeLots 9, gaps 1 |
| `B1` | `B0` plus baseline imports that touch ORG-001 (`IMP-001`…`IMP-007`) | events 18, lots 19, dashboard activeLots 17, gaps 1 |
| `B2` | `B1` plus the optional KDE-gap import | events 19, lots 20, dashboard activeLots 18, gaps 2 |

`18_reports_audit.md` values are `B0` values. `EXP-001` and `EXP-002` both captured `12` rows because they were generated at `B0`. Re-exporting events after the import suite produces `18` rows.

To return to `B0`, reset the disposable database, reseed, and replay the API fixture creation order in `03_design_notes.md`. Imported S3 objects are not deleted by a database reset.

Import rows themselves are not deleted by any API. They persist until reset.

---

## 2. File summary

| File | Import | CTE | Rows | Expected status | valid_rows | error_rows | Notifications |
|---|---|---|---|---|---|---|---|
| `IMP-001_receiving_valid.csv` | `IMP-001` | receiving | 2 | `complete` | 2 | 0 | 1 `import_complete` |
| `IMP-002_creation_errors.csv` | `IMP-002` | creation | 4 | `complete_with_errors` | 1 | 3 | 1 |
| `IMP-003_transformation_valid.csv` | `IMP-003` | transformation | 5 | `complete` | 5 | 0 | 1 |
| `IMP-004_shipping_errors.csv` | `IMP-004` | shipping | 3 | `failed` | 0 | 3 | 1 |
| `IMP-005_header_only.csv` | `IMP-005` | creation | 0 | `failed` | 0 | 0 | **none** |
| `IMP-006_creation_valid.csv` | `IMP-006` | creation | 3 | `complete` | 3 | 0 | 1 |
| `IMP-007_transformation_group_error.csv` | `IMP-007` | transformation | 3 | `failed` | 0 | 1 | 1 |
| `IMP-008_receiving_northwind.csv` | `IMP-008` | receiving | 1 | `complete` | 1 | 0 | 1 |
| `IMP-009_creation_prairie.csv` | `IMP-009` | creation | 3 | `complete` | 3 | 0 | 1 |
| `IMP-010_transformation_prairie_errors.csv` | `IMP-010` | transformation | 2 | `failed` | 0 | 1 | 1 |
| `OPT-kde_gap_creation.csv` | optional | creation | 1 | `complete` | 1 | 0 | 1 |

Every status value above is asserted by the worker logic at `import-processor.js:224-245`. Notifications come from `import-processor.js:247-263`.

### 2.1 Upload order

1. `IMP-006` — creates `GV-ROM-0620-A/B/C`.
2. `IMP-001` — creates `GV-KAL-0621-A`, `GV-ROM-0621-A`.
3. `IMP-002` — creates `GV-KAL-0620-D`; produces the 3 baseline errors.
4. `IMP-003` — consumes lots created by steps 1–3.
5. `IMP-004`, `IMP-005`, `IMP-007` — failures; no dependency.
6. `IMP-008` — ORG-002 only.
7. `IMP-009` — ORG-005, creates wheat and oats lots.
8. `IMP-010` — ORG-005, depends on `IMP-009` lots only for row validation; the group fails before lot resolution.

Do not add a second valid group with the same `transaction_id` in another file. It is skipped silently by idempotency (`import-event.js:17-27`).

---

## 3. Exact file contents

Line 1 is the header. Data row `n` in the file is reported as `Row n` because the parser row index starts at 0 and adds 2 (`import-processor.js:149`).

### 3.1 `IMP-001_receiving_valid.csv`

```csv
transaction_id,event_datetime,location_name,counterparty_name,notes,traceability_lot_code,product_name,quantity,uom,counterparty_lot_code
TRX-R1,2026-06-21T08:00:00.000Z,Packing House,Riverside Partner Farm,"Received pallet 1, chilled",GV-KAL-0621-A,Organic Kale,240,kg,RPF-KAL-118
TRX-R1B,2026-06-21T08:30:00.000Z,Packing House,Riverside Partner Farm,Received pallet 2,GV-ROM-0621-A,Romaine Hearts,180,kg,RPF-ROM-119
```

Expected: 2 events, 2 lots created, 2 valid rows. Row 2 exercises a quoted comma (`NEG-IMP-18`).

### 3.2 `IMP-002_creation_errors.csv`

```csv
transaction_id,event_datetime,location_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-C2-1,2026-06-20T10:00:00.000Z,Main Farm,Missing lot code,,Organic Kale,100,kg
TRX-C2-2,2026-06-20T10:05:00.000Z,Main Farm,Bad quantity,GV-KAL-0620-B,Organic Kale,abc,kg
TRX-C2-3,2026-06-20T10:10:00.000Z,Main Farm,Zero quantity,GV-KAL-0620-C,Organic Kale,0,kg
TRX-C2-4,2026-06-20T10:15:00.000Z,Main Farm,Valid row,GV-KAL-0620-D,Organic Kale,80,kg
```

Expected error report:

```json
[
  { "row": 2, "message": "Row 2: Missing required field 'traceability_lot_code'" },
  { "row": 3, "message": "Row 3: 'quantity' must be a number, got 'abc'" },
  { "row": 4, "message": "Row 4: 'quantity' must be positive" }
]
```

Only `TRX-C2-4` commits. Status `complete_with_errors`, `total_rows=4`, `valid_rows=1`, `error_rows=3`.

### 3.3 `IMP-003_transformation_valid.csv`

```csv
transaction_id,event_datetime,location_name,notes,direction,traceability_lot_code,product_name,quantity,uom
TRX-T3A,2026-06-23T07:00:00.000Z,Packing House,Repack washed kale,input,GV-KAL-0621-A,Organic Kale,120,kg
TRX-T3A,2026-06-23T07:00:00.000Z,Packing House,Repack washed kale,input,GV-KAL-0620-D,Organic Kale,60,kg
TRX-T3A,2026-06-23T07:00:00.000Z,Packing House,Repack washed kale,output,GV-KAL-0623-A,Organic Kale,170,kg
TRX-T3B,2026-06-23T08:00:00.000Z,Packing House,Retrim romaine,input,GV-ROM-0621-A,Romaine Hearts,90,kg
TRX-T3B,2026-06-23T08:00:00.000Z,Packing House,Retrim romaine,output,GV-ROM-0623-A,Romaine Hearts,85,kg
```

Expected: 2 transformation events, 2 new lots, 5 valid rows, 0 errors. `direction` is lowercase here; submit `INPUT` once manually to test `NEG-IMP-31`.

### 3.4 `IMP-004_shipping_errors.csv`

```csv
transaction_id,event_datetime,location_name,counterparty_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-S4-1,2026-06-24T09:00:00.000Z,,Bay Area Retail Depot,Missing location,GV-KAL-0621-A,Organic Kale,50,kg
TRX-S4-2,not-a-date,Sacramento DC,Bay Area Retail Depot,Bad date,GV-ROM-0621-A,Romaine Hearts,40,kg
TRX-S4-3,2026-06-24T09:30:00.000Z,Sacramento DC,Bay Area Retail Depot,Missing uom,GV-ROM-0621-A,Romaine Hearts,30,
```

Expected error report:

```json
[
  { "row": 2, "message": "Row 2: Missing required field 'location_name'" },
  { "row": 3, "message": "Row 3: 'event_datetime' is not a valid ISO date, got 'not-a-date'" },
  { "row": 4, "message": "Row 4: Missing required field 'uom'" }
]
```

All 3 rows fail. No event or lot is created.

### 3.5 `IMP-005_header_only.csv`

```csv
transaction_id,event_datetime,location_name,notes,traceability_lot_code,product_name,quantity,uom
```

The parser yields 0 rows. The worker early-returns `failed` with `total_rows=0`, no error report, and **no notification** (`import-processor.js:130-139`).

A real 0-byte file never reaches the worker: the controller returns `422 Uploaded file is empty` and creates no import row (`imports/controller.js:24-27`). Test both cases separately.

### 3.6 `IMP-006_creation_valid.csv`

```csv
transaction_id,event_datetime,location_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-C6,2026-06-20T09:00:00.000Z,Main Farm,Third romaine planting block A,GV-ROM-0620-A,Romaine Hearts,120,kg
TRX-C6,2026-06-20T09:00:00.000Z,Main Farm,Third romaine planting block A,GV-ROM-0620-B,Romaine Hearts,110,kg
TRX-C6,2026-06-20T09:00:00.000Z,Main Farm,Third romaine planting block A,GV-ROM-0620-C,Romaine Hearts,95,kg
```

Expected: **one** creation event with three output links, 3 valid rows. This is the clearest check that `valid_rows` counts CSV rows, not events (`import-processor.js:201,242`).

### 3.7 `IMP-007_transformation_group_error.csv`

```csv
transaction_id,event_datetime,location_name,notes,direction,traceability_lot_code,product_name,quantity,uom
TRX-T7,2026-06-23T10:00:00.000Z,Packing House,No output row,input,GV-KAL-0623-A,Organic Kale,60,kg
TRX-T7,2026-06-23T10:00:00.000Z,Packing House,No output row,input,GV-ROM-0623-A,Romaine Hearts,40,kg
TRX-T7,2026-06-23T10:00:00.000Z,Packing House,No output row,input,GV-ROM-0620-A,Romaine Hearts,30,kg
```

Expected error report, one entry at the first row of the group:

```json
[
  { "row": 2, "message": "Transaction TRX-T7 must have at least one 'input' row and one 'output' row for Transformation." }
]
```

Status `failed` with `total_rows=3`, `valid_rows=0`, `error_rows=1`.

### 3.8 `IMP-008_receiving_northwind.csv`

```csv
transaction_id,event_datetime,location_name,counterparty_name,notes,traceability_lot_code,product_name,quantity,uom,counterparty_lot_code
TRX-N8,2026-06-25T07:45:00.000Z,Reno Cold Store,Northwind Berry Co,Received frozen pallet,NW-FRB-0625-A,Frozen Berry Blend,900,kg,NWB-4471
```

Expected: ORG-002 only. 1 event, 1 lot. Verifies tenant isolation: with an ORG-001 token the same file fails on location lookup.

### 3.9 `IMP-009_creation_prairie.csv`

```csv
transaction_id,event_datetime,location_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-P9,2026-06-24T06:00:00.000Z,Grain Elevator,Bulk wheat intake,PG-WHT-0624-A,Hard Red Wheat,12000,kg
TRX-P9,2026-06-24T06:00:00.000Z,Grain Elevator,Bulk wheat intake,PG-WHT-0624-B,Hard Red Wheat,11500,kg
TRX-P9,2026-06-24T06:00:00.000Z,Grain Elevator,Bulk oats intake,PG-OAT-0624-A,Rolled Oats,4000,kg
```

Expected: 1 event with 3 outputs, 3 new lots, no gaps. `PRD-015` requires `moisture_pct` but it is optional, so `kde_payload {}` produces no gap (`13_products.md`).

### 3.10 `IMP-010_transformation_prairie_errors.csv`

```csv
transaction_id,event_datetime,location_name,notes,direction,traceability_lot_code,product_name,quantity,uom
TRX-T10,2026-06-26T08:00:00.000Z,Grain Mill,Milling run with no output,input,PG-WHT-0624-A,Hard Red Wheat,6000,kg
TRX-T10,2026-06-26T08:00:00.000Z,Grain Mill,Milling run with no output,input,PG-WHT-0624-B,Hard Red Wheat,5000,kg
```

Expected: one group error at row 2, status `failed`, `total_rows=2`, `valid_rows=0`, `error_rows=1`. Notification message contains `0 rows imported, 1 errors.` — the plural bug is real (`import-processor.js:259`).

### 3.11 `OPT-kde_gap_creation.csv` (optional)

```csv
transaction_id,event_datetime,location_name,notes,traceability_lot_code,product_name,quantity,uom
TRX-KDE1,2026-06-27T06:00:00.000Z,Main Farm,Cilantro with required bunch_count omitted,GV-CIL-0627-A,Cilantro Bunch,300,units
```

Expected: `complete`, 1 event, and a compliance gap because import never supplies KDEs (`import-event.js:98-106`). Raises dashboard `openComplianceGaps` from 1 to 2 and adds `Cilantro Bunch` to the gaps page.

---

## 4. Upload through the UI

| Step | Action | Expected |
|---|---|---|
| 1 | Open `/imports` as USR-007 | Upload card shows `Receiving` selected by default |
| 2 | Drag the file onto the drop zone | Filename and size appear; `Upload & Process` enabled |
| 3 | Select the matching **Event Type** | Must equal the file's CTE type; the worker never reads a type column |
| 4 | Click `Upload & Process` | Toast `Import queued`; row appears as `Pending` |
| 5 | Wait | `Processing` then the final badge; list refreshes every 5 s |
| 6 | Click `<n> errors →` on a partial/failed row | Dialog lists `Row` and `Error` |

A wrong Event Type is the most common tester error: a creation file uploaded as `receiving` turns every output link into an input link, creates no lots for new TLCs, and produces different trace results. The worker does not inspect header names to infer the type.

---

## 5. Upload through curl

```bash
API=http://localhost:3000/api/v1
TOKEN='<USR-007 access token>'
DIR=docs/test-data/imports

curl -sS -X POST "$API/imports" \
  -H "Authorization: Bearer $TOKEN" \
  -F "cte_type=creation" \
  -F "file=@$DIR/IMP-006_creation_valid.csv;type=text/csv"
```

Expected `201` with `status: "pending"` and a `job_id`. Poll `GET /imports?limit=5` until the row leaves `pending`.

To fetch the import error report through the API:

```bash
curl -sS "$API/imports/<import-id>/errors?page=1&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 6. Worker behavior by row

| Check | Result | Citation |
|---|---|---|
| Header order differs | Ignored; columns are read by name | `import-processor.js:118-124` |
| Missing optional column | Treated as empty | `import-processor.js:36-41` |
| Extra column | Ignored; `relax_column_count: true` | `import-processor.js:123` |
| Quoted comma | Parsed as one cell | `csv-parse` |
| BOM | Stripped | `import-processor.js:122` |
| CRLF | Accepted | `csv-parse` |
| Whitespace around cells | Trimmed | `import-processor.js:121` |
| Duplicate `transaction_id` in one file | One event; all rows become links | `import-processor.js:154-159` |
| Same `transaction_id` in a later file | Skipped; counts still rise | `import-event.js:17-27` |
| `direction` uppercase | Accepted | `import-processor.js:63` |
| `quantity=1e3` | Accepted as 1000 | `Number()` |
| `quantity=1,000` | Error | `Number()` |
| `2026-02-30` | Normalized to March 2, no error | JS `Date` |
| Location not found | Whole group fails | `import-event.js:32-33` |
| Product not found | Whole group fails | `import-event.js:47-48` |
| Existing active lot with same product + TLC | Reused, quantity unchanged | `import-event.js:54-74` |
| Existing void lot with same product + TLC | New lot created | `import-event.js:61` |
| Lot belongs to another org | Impossible; lookup is org-scoped | `import-event.js:56-61` |

Lot quantity is taken from the **first creation row only** when the lot is created; later rows in the same group do not update it (`import-event.js:64-73`). A creation group with three outputs creates three lots, each with its own row quantity.

---

## 7. Expected database effects (ORG-001)

At `B1`, the following rows must exist in addition to the `B0` fixtures:

| Import | New events | New lots | Event source |
|---|---|---|---|
| `IMP-006` | 1 (creation) | `GV-ROM-0620-A/B/C` | `import` |
| `IMP-001` | 2 (receiving) | `GV-KAL-0621-A`, `GV-ROM-0621-A` | `import` |
| `IMP-002` | 1 (creation) | `GV-KAL-0620-D` | `import` |
| `IMP-003` | 2 (transformation) | `GV-KAL-0623-A`, `GV-ROM-0623-A` | `import` |
| `IMP-004` | 0 | 0 | — |
| `IMP-005` | 0 | 0 | — |
| `IMP-007` | 0 | 0 | — |

Expected totals for ORG-001 at `B1`: events 18, lots 19, active lots 17, locations 6 (5 active), products 6, gaps 1. Notification count grows by 6 (one per non-empty import).

SQL spot-check:

```sql
SELECT source, count(*) FROM events
WHERE organization_id = '<ORG-001 uuid>' GROUP BY source;
-- manual: 12, import: 6

SELECT count(*) FROM lots WHERE organization_id = '<ORG-001 uuid>';
-- 19
```

---

## 8. Negative upload matrix

Run these against a disposable environment. Each row is independent.

| ID | File / input | Expected |
|---|---|---|
| `NEG-IMP-37` | `IMP-006` uploaded with `cte_type=receiving` | `complete`; 3 link inputs, no new lots for the three TLCs; trace changes |
| `NEG-IMP-38` | `IMP-001` uploaded with `cte_type=creation` | `complete`; 2 new output lots, no inputs; receiving trace broken |
| `NEG-IMP-39` | `IMP-001` as ORG-002 | `failed`; error `Transaction TRX-R1 Failed: Location 'Packing House' not found for transaction TRX-R1` |
| `NEG-IMP-40` | `IMP-009` as ORG-004 | `failed`; location `Grain Elevator` not found |
| `NEG-IMP-41` | Rename `IMP-002` rows to an existing `transaction_id` from `IMP-006` | Rows silently skipped; `valid_rows=1` still reported for the valid row; no new event |
| `NEG-IMP-42` | Upload `IMP-004` twice | Second upload `failed` with the same 3 errors; no partial events |
| `NEG-IMP-43` | Product name with trailing space | Matched after `trim()` (`import-processor.js:47,86`) |
| `NEG-IMP-44` | Location name `packing house` lowercase | Matched (`import-processor.js:89`) |
| `NEG-IMP-45` | Product `Organic Baby Spinach` in ORG-001 CSV | Group fails with a compliance gap if it commits; required `harvest_date` absent |
| `NEG-IMP-46` | Import to inactive `Cold Storage Annex` | Failed: location not in active cache |
| `NEG-IMP-47` | Import product with `uom` blank | Row error `Missing required field 'uom'` even though the product has a default UOM |
| `NEG-IMP-48` | Event datetime with timezone offset `2026-06-24T06:00:00-05:00` | Accepted; stored as UTC |
| `NEG-IMP-49` | 10 MiB + 1 byte file | Multer `LIMIT_FILE_SIZE`; global error `[UNVERIFIED-RUNTIME]` |
| `NEG-IMP-50` | Filename `IMPORT.CSV` | Accepted; extension check is case-insensitive (`imports/controller.js:20`) |

---

## 9. Template drift

The downloaded templates include `notes`, `counterparty_name`, and `counterparty_lot_code`, but the worker does not require them. The worker requires only the columns in `REQUIRED_COLS` (`import-processor.js:21-26`).

The creation template example uses `Organic Spinach`, which does not exist in ORG-001 (the fixture name is `Organic Baby Spinach`). Uploading the template unchanged produces a product-not-found group failure for the spinach row and a valid `Organic Kale` row. This is a real test of `OPS-IMP-08`, not a defect in the fixture.

---

## 10. Checks after the suite

| ID | Check | Expected |
|---|---|---|
| `CHK-IMP-01` | `GET /imports?limit=50` as USR-007 | 10 ORG-001 rows, newest first, statuses as in §2 |
| `CHK-IMP-02` | Open the `IMP-002` error dialog | 3 rows match §3.2 exactly |
| `CHK-IMP-03` | Open the `IMP-005` row | No `errors →` link; status `Failed`; total `0` |
| `CHK-IMP-04` | Bell for USR-007 | 4 notifications: IMP-001, IMP-002, IMP-005 (none), IMP-006 → exactly 3 for this user |
| `CHK-IMP-05` | Audit log as USR-001 | One `import.post` per upload, newest first |
| `CHK-IMP-06` | Event detail of an imported event | Badge `Import`; KDE payload `{}`; hash chain intact |
| `CHK-IMP-07` | Trace from `GV-ROM-0620-A` | Forward to the `IMP-006` event; no downstream output because the event is creation |
| `CHK-IMP-08` | Export events after `B1` | `rowCount=18` for ORG-001 |
| `CHK-IMP-09` | Reload `/imports` | No duplicate notifications; counts unchanged |
| `CHK-IMP-10` | `GET /imports?status=complete_with_errors` | Exactly `IMP-002` |
