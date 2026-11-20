# 50 — Search, Filter, Sort, and Pagination

> Every list control in the web app and every query parameter in the API, with fixture-level expected results.
> All queries are tenant-scoped. Results never include another organization.

---

## 1. Two pagination models

| Model | Endpoints | Response `pagination` | UI |
|---|---|---|---|
| Offset | locations, products, lots, users, imports, audit, notifications, recall, compliance gaps, import errors | `total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPrevPage` | Numbered pager in `DataTable` |
| Keyset | events only | `limit`, `hasNextPage`, `nextCursor` | Previous / Next buttons, `Page N` label |

Offset defaults: `page=1`, `limit=20`, both coerced numbers, `limit` 1–100 (`utils/pagination.js:3-6`). The helper clamps again to 1–100 (`pagination.js:39-43`), but invalid values are rejected by Zod before the helper runs.

Keyset defaults: `limit=20`, `cursor` optional (`events.validation.js:72-82`). It fetches `limit + 1` rows to compute `hasNextPage` (`events.service.js:258-270`). Sort is fixed to `created_at desc, chain_seq desc` (`events.service.js:254-257`).

Test items | Expected
---|---
`GET /lots?page=2&limit=20` with 11 lots | `data: []`, `total: 11`, `totalPages: 1`, `hasPrevPage: true`
`GET /lots?limit=100` | Accepted
`GET /lots?limit=101` | `422`, field `limit`, `Number must be less than or equal to 100`
`GET /lots?limit=0` | `422`, field `limit`, `Number must be greater than or equal to 1`
`GET /lots?page=0` | `422`, field `page`, `Number must be greater than or equal to 1`
`GET /lots?page=abc` | `422`, field `page`, `Expected number, received nan`
`GET /events?page=1` | `422`, root, `Unrecognized key(s) in object: 'page'` (strict schema)
`GET /events?limit=5` with 12 events | 5 rows, `hasNextPage: true`, opaque `nextCursor`
`GET /events?cursor=abc` | `422`, field `cursor`, `Invalid cursor`
`GET /events?cursor=<valid>` | Next page; no duplicates across the boundary
`GET /events?limit=1` | Works; 12 pages for ORG-001

Keyset cursor is base64url JSON `{t,s}` and validates the timestamp as exactly 6 fractional digits plus a positive bigint (`utils/cursor.js:3-68`). Editing either field returns `422 Invalid cursor`, not an empty page.

The UI does not pass `page` to `/events`; it keeps a cursor stack in memory (`EventsListPage.jsx:36-38`). Changing a filter is not possible in the UI because the Events page has no filter controls.

---

## 2. Controls visible in the UI

| Screen | Controls | Not exposed in UI but supported by API |
|---|---|---|
| `/locations` | `Search locations...`; `All types`; pager | `isExternal`, `isActive`, `sort`, `order` |
| `/products` | `Search products...`; pager | `category`, `isFtl`, `isActive`, `sort`, `order` |
| `/lots` | `Search lot code or product...`; pager | `productId`, `status`, `traceabilityLotCode`, `sort`, `order` |
| `/events` | Pager only | `eventType`, `status`, `source`, `locationId`, `lotId`, `dateFrom`, `dateTo`, `limit`, `cursor` |
| `/trace` | Lot select with in-dropdown `Search lots...`; direction | — |
| `/imports` | None; fixed `page=1, limit=50` | `status`, `cteType`, pager |
| `/settings/users` | Pager only; fixed `limit=10` | `search`, `status`, `role`, `sort`, `order` |
| `/audit` | `Filter by action`; pager | `entityType`, `entityId`, `actorId` |
| `/notifications` (bell) | Unread badge only | `unreadOnly`, pager |
| `/recall` | None; fixed `limit=10` | pager |
| `/reports/compliance-gaps` | Pager | `page`, `limit` only |
| `/reports/exports/:id` | None | — |

Citations: `LocationsListPage.jsx:56-62,290-310`; `ProductsListPage.jsx:45-50,298-305`; `LotsListPage.jsx:47-52,225-236`; `EventsListPage.jsx:36-41,198-220`; `ImportPage.jsx:225-231`; `UsersPage.jsx:163-169`; `AuditLogPage.jsx:143-149`; `RecallSimulationsPage.jsx:37`; `NotificationBell.jsx:41-47`.

The UI has fewer filters than the API in six modules. A tester who only clicks the UI will miss most query behavior. Use the API for the matrices below.

---

## 3. Search semantics

All text search uses PostgreSQL `ILIKE '%term%'` on a fixed set of columns. There is no full-text search, no ranking, no fuzzy match, and no escaping of `%` or `_`. No debounce exists on list pages, so every keystroke fires a request (`LocationsListPage.jsx:293-296`).

| Property | Behavior |
|---|---|
| Case | Insensitive |
| Match | Substring, both sides wildcarded |
| Leading/trailing spaces | Part of the pattern; not trimmed |
| Empty `search=` | Ignored (falsy check), returns all |
| `%` in term | Wildcard; `%` returns every row |
| `_` in term | Single-character wildcard |
| Max length | 255 for locations/products/lots; 100 for users; 200 for audit action |
| Fields searched | Module-specific, see below |
| Cross-tenant | Never; `organization_id` predicate is applied first |

Search terms to try on every module: a valid substring, uppercase, a partial code, a term with `%`, a term with `_`, a single space, 255/256 characters, and a cross-tenant name.

### 3.1 Locations

Fields: `name`, `city`, `gln` (`locations.service.js:88-94`). Type is a separate exact filter. Default list excludes inactive rows unless `isActive` is supplied (`locations.service.js:82-87`).

| Query | Expected ORG-001 results |
|---|---|
| `search=farm` | LOC-001 `Main Farm`, LOC-006 `Riverside Partner Farm` |
| `search=FARM` | Same two |
| `search=salinas` | LOC-001, LOC-002 (LOC-005 inactive excluded) |
| `search=93905` | 0 — postal code is not searched |
| `search=0012345678902` | LOC-002 by GLN |
| `search=partner` | LOC-006 only |
| `type=farm` | LOC-001, LOC-006 |
| `type=warehouse` | LOC-003 (LOC-005 inactive excluded) |
| `isExternal=true` | LOC-004, LOC-006 |
| `isActive=false` | LOC-005 only |
| `isActive=true` | 5 rows |
| no `isActive` | 5 rows |
| `sort=name&order=asc` | Bay Area Retail Depot, Main Farm, Packing House, Riverside Partner Farm, Sacramento DC |
| `sort=city&order=asc` | Fresno, Oakland, Salinas ×2, Sacramento |
| `sort=bogus` | `422`, field `sort`, enum message |

### 3.2 Products

Fields: `name`, `sku`, `gtin` (`products.service.js:79-86`). Category filter is exact and case-sensitive at the database level.

| Query | Expected ORG-001 results |
|---|---|
| `search=spinach` | PRD-001 only |
| `search=SPINACH` | PRD-001 only |
| `search=GV-` | All 6 products |
| `search=greens` | 0 — category is not searched |
| `search=00012345678905` | PRD-005 by GTIN |
| `search=romaine` | PRD-004 |
| `category=Leafy Greens` | PRD-001, PRD-002, PRD-003, PRD-004 |
| `category=leafy greens` | 0 — exact case-sensitive match |
| `isFtl=true` | PRD-001…PRD-004 |
| `isFtl=false` | PRD-005, PRD-006 |
| `isActive=false` | 0 — no product is deactivated |
| `sort=sku&order=asc` | GV-CIL-005, GV-KAL-002, GV-MIX-003, GV-ROM-004, GV-SPN-001, GV-STR-006 |

`PRD-008` in ORG-002 also matches `search=spinach` but must never appear in ORG-001 results. That is the cross-tenant search check.

### 3.3 Lots

Fields: TLC and product name (`lots.service.js:123-128`). `traceabilityLotCode` is an **exact** filter, not a search.

| Query | Expected ORG-001 results |
|---|---|
| `search=spinach` | LOT-001, LOT-002, LOT-024 (product name) |
| `search=SPN` | LOT-001, LOT-002 |
| `search=2026-0001` | LOT-001, LOT-003, LOT-004, LOT-006, LOT-010 |
| `search=mix` | LOT-004, LOT-005 |
| `productId=<PRD-001>` | LOT-001, LOT-002, LOT-024 |
| `status=active` | 9 rows |
| `status=void` | LOT-007 |
| `status=recalled` | LOT-005 |
| `traceabilityLotCode=MIX-2026-0002` | LOT-005 exactly |
| `traceabilityLotCode=mix-2026-0002` | 0 — exact match is case-sensitive |
| `traceabilityLotCode=` (empty) | `422`, field `traceabilityLotCode`, `Cannot be empty` |
| `sort=quantity&order=asc` | First row LOT-010 (0.0001) |
| `sort=quantity&order=desc` | First ORG-001 row LOT-001 (500); second LOT-002 (320) |
| `sort=status` | Groups by enum text order; not a workflow order |

### 3.4 Events

No text search at all. Exact filters only (`events.service.js:207-237`).

| Query | Expected ORG-001 rows |
|---|---|
| none | 12 |
| `eventType=creation` | 7: EVT-001, 005, 006, 008, 009, 010, 011 |
| `eventType=receiving` | 2: EVT-002, EVT-013 |
| `eventType=transformation` | 1: EVT-003 |
| `eventType=shipping` | 2: EVT-004, EVT-007 |
| `status=active` | 10 |
| `status=amended` | EVT-001 |
| `status=void` | EVT-007 |
| `source=manual` | 12 |
| `source=import` | 0 at `B0`; 6 at `B1` |
| `locationId=<LOC-001>` | 6: EVT-001, 005, 006, 008, 010, 011 |
| `locationId=<LOC-002>` | 4: EVT-002, EVT-003, EVT-009, EVT-013 |
| `lotId=<LOT-001>` | 4: EVT-001, EVT-002, EVT-003, EVT-011 |
| `lotId=<LOT-004>` | 2: EVT-003, EVT-004 |
| `eventType=receiving&dateFrom=2026-06-05T00:00:00.000Z` | EVT-013 only |
| `dateTo=2026-06-01T23:59:59.000Z` | EVT-001, EVT-005, EVT-006, EVT-008, EVT-010, EVT-011 |
| `dateFrom=2026-06-02T09:15:00.000Z&dateTo=2026-06-02T09:15:00.000Z` | EVT-002 and EVT-003 (inclusive both ends) |
| `dateFrom` without timezone `2026-06-05` | `422`, field `dateFrom`, datetime message |
| `eventType=harvest` | `422`, enum message |
| `eventType=creation&limit=5` | 5 rows, cursor; next page continues the same filter |

`dateFrom`/`dateTo` compare against `event_datetime`, not `created_at` (`events.service.js:224-225`). The cursor compares `created_at` and `chain_seq` (`events.service.js:228-234`). A new event inserted between page loads can appear or be skipped because keyset is on creation time, not event time.

### 3.5 Audit log

Exact filters, no search (`audit.service.js:13-32`).

| Query | Expected ORG-001 at `B0` |
|---|---|
| `action=event.void` | 1 row, entity EVT-007 |
| `action=event.amend` | 1 row, entity = replacement of EVT-001 |
| `action=lot.void` | One row per lot voided through the API (LOT-007, and LOT-016 is ORG-003) |
| `action=user.role_change` | **0** — the real action is `user.patch` |
| `action=user.patch` | One row per user update |
| `entityType=event` | event.void and event.amend rows only |
| `entityId=<EVT-007>` | 1 row |
| `actorId=<USR-004>` | Rows performed by USR-004: event.amend plus any lot/event actions |
| `action=nonexistent` | `200`, empty array, total 0 |
| `entityId=abc` | `422`, field `entityId`, uuid message |
| `entityType=` (empty) | `422`, field `entityType`, `String must contain at least 1 character(s)` |

Audit has no free-text search in UI or API. The `Search` icon import in `AuditLogPage.jsx:3` is unused.

### 3.6 Users

Fields: first name, last name, email (`users.service.js:44-52`). Exact filters `status`, `role`.

| Query | Expected ORG-001 |
|---|---|
| `search=ava` | USR-001 |
| `search=thompson` | USR-001 |
| `search=greenvalley` | 10 rows (all emails share the domain) |
| `search=GREENVALLEY` | 10 rows |
| `status=active` | 8 |
| `status=invited` | USR-009 |
| `status=deactivated` | USR-010 |
| `role=org_admin` | USR-001, USR-002 |
| `role=auditor&status=active` | USR-008 |
| `sort=lastName&order=asc` | Alvarez, Carter, Grant, Lin, Nair, Okafor, Reed, Rossi, Schmidt, Thompson |
| `search=<256 chars>` | `422`, field `search`, max 100 |

### 3.7 Imports

Exact filters only (`imports/service.js:181-199`). No text search.

| Query at `B1` | Expected ORG-001 |
|---|---|
| none | 7 ORG-001 imports |
| `status=complete` | IMP-001, IMP-003, IMP-006 |
| `status=complete_with_errors` | IMP-002 |
| `status=failed` | IMP-004, IMP-005, IMP-007 |
| `cteType=creation` | IMP-002, IMP-005, IMP-006 |
| `cteType=receiving` | IMP-001 |
| `status=partial` | `422`, enum message; use `complete_with_errors` |
| `limit=50&page=2` | Empty page; total 7 |

The UI always sends `page=1&limit=50` and ignores the two supported filters (`ImportPage.jsx:225-231`).

### 3.8 Recall simulations

No filters. Sort fixed `run_at desc`; UI requests `limit=10` (`RecallSimulationsPage.jsx:37`). ORG-001 has 2 rows, so paging requires more simulations; create 11 or use the API with `limit=1`.

The triggering-lot picker loads only the first 50 active? lots — it calls `useGetLots({ limit: 50 })` with no status filter (`RecallSimulationsPage.jsx:39`), so the first 50 by `created_at desc` include void/recalled lots. A lot beyond the first 50 cannot be selected.

### 3.9 Notifications

| Query | Expected |
|---|---|
| none | Own plus org-wide rows, newest first |
| `unreadOnly=true` | Unread only |
| `unreadOnly=false` | Same as none |
| `unreadOnly=yes` | `422`, field `unreadOnly`, enum message |
| `limit=10` | Badge count still uses `pagination.total`, which can exceed 10 |

Baseline unread for USR-001: NTF-004 and NTF-008. USR-007: NTF-001 plus flow-generated rows.

### 3.10 Compliance gaps

Only `page` and `limit`. No event type, date, location, or product filter (`reports/reports.service.js:43-56`). At `B0` ORG-001 returns exactly 1 row (EVT-013). Raising `limit` cannot change the set.

### 3.11 Trace lot picker

Server-side search over lots, fixed `limit=100`, term typed into the dropdown (`TracePage.jsx:56,182-196`). Search uses the lots endpoint, so it matches TLC or product name. Only the first 100 matches are selectable. Typing a term does not change the trace request until a lot is selected.

---

## 4. Sort rules

| Module | Whitelist | Default | Notes |
|---|---|---|---|
| Locations | `name`, `createdAt`, `city`, `type` | `createdAt desc` | `created_at` is rejected |
| Products | `name`, `createdAt`, `category`, `sku` | `createdAt desc` | — |
| Lots | `traceabilityLotCode`, `createdAt`, `quantity`, `status` | `createdAt desc` | Status sorts alphabetically (`active`, `recalled`, `void`) |
| Users | `createdAt`, `firstName`, `lastName`, `email`, `role`, `status` | `createdAt desc` | UI does not expose it |
| Events | fixed | `created_at desc, chain_seq desc` | `sort` is a 422 unknown key |
| Audit | fixed | `created_at desc` | — |
| Imports | fixed | `created_at desc` | — |
| Recall | fixed | `run_at desc` | — |
| Notifications | fixed | `created_at desc` | — |
| Gaps | fixed | `event_datetime desc` | No user-controlled sort |

`order` accepts only `asc`/`desc` (`paginationSchema` does not define it; each module's schema does). `order=ASC` returns `422`.

---

## 5. Combined filter tests

| ID | Query | Expected |
|---|---|---|
| `FLT-01` | `/lots?status=active&search=spinach&sort=quantity&order=desc` | LOT-001, LOT-002, LOT-024 |
| `FLT-02` | `/locations?type=farm&isExternal=true` | LOC-006 only |
| `FLT-03` | `/products?category=Leafy%20Greens&isFtl=true` | PRD-001…PRD-004 |
| `FLT-04` | `/events?eventType=creation&status=active&locationId=<LOC-001>` | EVT-005, EVT-006, EVT-008, EVT-010, EVT-011 |
| `FLT-05` | `/audit?action=event.amend&entityType=event` | 1 row |
| `FLT-06` | `/users?role=operator&status=invited` | USR-009 |
| `FLT-07` | `/imports?status=failed&cteType=transformation` | IMP-007, IMP-010 (ORG-005 one excluded by tenant) |
| `FLT-08` | `/lots?productId=<PRD-999>&status=active` | Empty list, `total=0` |
| `FLT-09` | `/events?lotId=<LOT-001>&eventType=shipping` | Empty; LOT-001 is never shipped directly |
| `FLT-10` | `/events?status=amended&eventType=creation` | EVT-001 only |

Combined filters are ANDed. There is no OR syntax, no negation, no saved views, and no query-string persistence in the URL except the event cursor stack (memory only).

---

## 6. Invalid and hostile input

| ID | Input | Expected |
|---|---|---|
| `QRY-01` | `limit=-1` | `422`, min 1 |
| `QRY-02` | `limit=1.5` | `422`, integer message |
| `QRY-03` | `limit=1e2` | Accepted as `100` by `z.coerce.number()`; not a 422 |
| `QRY-04` | `page=999999999999999999999` | Accepted as `1e21`; offset exceeds bigint range, so expect a `500` `[UNVERIFIED-RUNTIME]` |
| `QRY-05` | duplicated `status=active&status=void` | `422`; array arrives where a string is expected |
| `QRY-06` | unknown key `foo=1` on events | `422`, unrecognized key |
| `QRY-07` | unknown key `foo=1` on lots | Ignored; lots schema is not strict |
| `QRY-08` | `sort=created_at` on lots | `422`; use `createdAt` |
| `QRY-09` | `search=%25` (`%`) | Every row in the tenant |
| `QRY-10` | `search=_` | Every row with at least one character |
| `QRY-11` | `search=` | All rows |
| `QRY-12` | `search=%20%20` (two spaces) | 0 unless a field contains two consecutive spaces |
| `QRY-13` | `search=<255 chars>` | Accepted; 0 rows |
| `QRY-14` | `search=<256 chars>` | `422`, max 255 |
| `QRY-15` | SQL metacharacters `' OR 1=1 --` | Treated as literal text; 0 rows |
| `QRY-16` | `cursor` truncated | `422 Invalid cursor` |
| `QRY-17` | `cursor` with negative `s` | `422 Invalid cursor` |
| `QRY-18` | `cursor` with `s=0` | `422 Invalid cursor` |
| `QRY-19` | `dateFrom` after `dateTo` | `200`, empty list |
| `QRY-20` | `dateFrom=2026-06-05T00:00:00Z` (no millis) | Accepted; `z.string().datetime()` does not require millis |
| `QRY-21` | `dateFrom=2026-06-05T00:00:00+00:00` | `422`; offsets are rejected, only `Z` is accepted |

`search=%25` and `search=_` are wildcard tests, not bugs, but document the result so a future escaping change is caught.

---

## 7. Pagination consistency checks

| ID | Action | Expected |
|---|---|---|
| `PAG-01` | Load `/locations` page 1, note total 5 | Page 2 empty; total stays 5 |
| `PAG-02` | Change `limit` from 20 to 5 | `page` is reset to 1 by the UI |
| `PAG-03` | Search while on page 3 | UI resets to page 1 (`LocationsListPage.jsx:293-296`) |
| `PAG-04` | Delete/deactivate a row while on the last page | Total drops; the page may become empty |
| `PAG-05` | Events: Next, Next, Previous | Same rows on return; no duplicates or gaps |
| `PAG-06` | Events: apply `eventType=creation` via API, page with cursor | Every row has `event_type=creation`; cursor is filter-agnostic but rows respect the filter |
| `PAG-07` | Create an event, then use a cursor captured before creation | New row is not on the later pages (it sorts above the cursor) |
| `PAG-08` | Use the same cursor twice | Same page both times; idempotent read |
| `PAG-09` | Events `limit=100` with 12 rows | 12 rows, `hasNextPage=false`, `nextCursor=null` |
| `PAG-10` | Import errors dialog with >50 errors | Pager appears; `Showing 50 of N errors` |

Keyset `nextCursor` is `null`, not omitted, on the last page (`events.service.js:263-270`). Offset pagination always returns all six fields even when the list is empty.

---

## 8. Tenant isolation in search

| ID | Query as ORG-001 | Expected |
|---|---|---|
| `ISO-01` | `/locations?search=Reno` | 0; LOC-007 belongs to ORG-002 |
| `ISO-02` | `/products?search=Frozen` | 0 |
| `ISO-03` | `/lots?search=FZN` | 0; LOT-011 belongs to ORG-002 |
| `ISO-04` | `/lots?search=FZN-2026-0100` | LOT-024 only; same TLC, different org |
| `ISO-05` | `/events?lotId=<LOT-011>` | 0 rows, `200`; no 404 because the filter is a query |
| `ISO-06` | `/events?locationId=<LOC-007>` | 0 rows |
| `ISO-07` | `/users?search=northwind` | 0 |
| `ISO-08` | `/audit?entityId=<EVT-014>` | 0 rows |
| `ISO-09` | `/imports?status=complete` | ORG-001 only |
| `ISO-10` | `/notifications` | No ORG-002 rows |
| `ISO-11` | `/trace/<LOT-011>/full` | `404 Lot not found`; trace is a path id, not a filter |
| `ISO-12` | `/recall/<REC-003>` | `404 Simulation not found` |

An empty list is the correct cross-tenant answer for filters. A `404` is correct only for path IDs.

---

## 9. Quick fixture reference

| Entity | Count | IDs |
|---|---|---|
| ORG-001 active locations | 5 | LOC-001…LOC-004, LOC-006 |
| ORG-001 inactive location | 1 | LOC-005 |
| ORG-001 products | 6 | PRD-001…PRD-006 |
| ORG-001 lots | 11 | LOT-001…LOT-010, LOT-024 |
| ORG-001 events | 12 | EVT-001…EVT-011, EVT-013 |
| ORG-001 users | 10 | USR-001…USR-010 |
| ORG-001 imports at `B1` | 7 | IMP-001…IMP-007 |
| ORG-001 recalls | 2 | REC-001, REC-002 |
| ORG-001 exports | 3 | EXP-001…EXP-003 |
| ORG-001 gaps at `B0` | 1 | EVT-013 |

Filter counts in this file assume `B0` unless marked `B1`. Import tests change event, lot, and gap counts; see `40_import_files.md` §1.
