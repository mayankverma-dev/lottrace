# 12 — Locations

> Entity: `locations`. Screens: `/locations` (list + create dialog), `/locations/:locationId` (detail + edit).
> API: `GET/POST /locations`, `GET/PATCH /locations/:locationId`, `POST /locations/:locationId/deactivate`.

---

## 1. Purpose and prerequisites

Create locations before products, lots, and events. Events need a location for `receiving`, and every event stores one optional `locationId`.

| Rule | Value | Citation |
|---|---|---|
| Types | `farm`, `plant`, `warehouse`, `distributor`, `retailer`, `other` | `locations.validation.js:4` |
| Default list | Active only | `locations.service.js:82-87` |
| Default list sort | `created_at desc` | `locations.service.js:74` |
| Search fields | `name`, `city`, `gln`, case-insensitive | `locations.service.js:88-94` |
| Create roles | `org_admin`, `compliance_manager`, `operator` | `locations.routes.js:21-25` |
| Update roles | `org_admin`, `compliance_manager` | `locations.routes.js:31-35` |
| Deactivate role | `org_admin` | `locations.routes.js:38-41` |
| Deactivate behavior | Soft: `is_active=false`; historical events unchanged | `locations.service.js:193-204` |
| No delete route | — | `locations.routes.js` |

---

## 2. Record set

All addresses and GLNs are fictional. GLNs are 13 digits and do not need a valid GS1 check digit (no checksum in code).

| ID | Org | Name | Type | External | Address | City | State | Zip | Country | GLN | Timezone | Active |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `LOC-001` | ORG-001 | `Main Farm` | farm | false | `1200 Valley Road` | `Salinas` | `CA` | `93901` | `US` | `0012345678901` | `America/Los_Angeles` | yes |
| `LOC-002` | ORG-001 | `Packing House` | plant | false | `88 Packhouse Lane` | `Salinas` | `CA` | `93902` | `US` | `0012345678902` | `America/Los_Angeles` | yes |
| `LOC-003` | ORG-001 | `Sacramento DC` | warehouse | false | `4500 Distribution Way` | `Sacramento` | `CA` | `95814` | `US` | `0012345678903` | `America/Los_Angeles` | yes |
| `LOC-004` | ORG-001 | `Bay Area Retail Depot` | distributor | true | `700 Market Street` | `Oakland` | `CA` | `94607` | `US` | `0012345678904` | `America/Los_Angeles` | yes |
| `LOC-005` | ORG-001 | `Cold Storage Annex` | warehouse | false | `19 Icehouse Court` | `Salinas` | `CA` | `93905` | `US` | `0012345678905` | `America/Los_Angeles` | **no** |
| `LOC-006` | ORG-001 | `Riverside Partner Farm` | farm | true | `3300 Riverbend Road` | `Fresno` | `CA` | `93706` | `US` | `0012345678906` | `America/Los_Angeles` | yes |
| `LOC-007` | ORG-002 | `Reno Cold Store` | warehouse | false | `900 Sierra Industrial Drive` | `Reno` | `NV` | `89502` | `US` | `0023456789011` | `America/Denver` | yes |
| `LOC-008` | ORG-002 | `Truck Yard` | other | true | `45 Freight Loop` | `Sparks` | `NV` | `89431` | `US` | `0023456789012` | `America/Denver` | yes |
| `LOC-009` | ORG-002 | `Boise Transfer` | warehouse | false | `210 Depot Avenue` | `Boise` | `ID` | `83702` | `US` | `0023456789013` | `America/Denver` | **no** |
| `LOC-010` | ORG-003 | `Dairy Plant` | plant | false | `1400 Creamery Road` | `Madison` | `WI` | `53703` | `US` | `0034567890121` | `America/Chicago` | yes |
| `LOC-011` | ORG-003 | `Dairy Farm` | farm | false | `76 Pasture Lane` | `Sun Prairie` | `WI` | `53590` | `US` | `0034567890122` | `America/Chicago` | yes |
| `LOC-012` | ORG-003 | `Milk Run Transfer` | distributor | true | `22 Route 19 South` | `DeForest` | `WI` | `53532` | `US` | `0034567890123` | `America/Chicago` | yes |
| `LOC-013` | ORG-004 | `Processing Plant` | plant | false | `880 Harbor Way` | `Seattle` | `WA` | `98104` | `US` | `0045678901231` | `America/Los_Angeles` | yes |
| `LOC-014` | ORG-004 | `Fishing Dock` | other | false | `Pier 14, Dock C` | `Seattle` | `WA` | `98121` | `US` | `0045678901232` | `America/Los_Angeles` | yes |
| `LOC-015` | ORG-004 | `Seattle Cold Partner` | warehouse | true | `500 Coldchain Boulevard` | `Tacoma` | `WA` | `98402` | `US` | `0045678901233` | `America/Los_Angeles` | yes |
| `LOC-016` | ORG-005 | `Grain Elevator` | warehouse | false | `1 Prairie Rail Road` | `Lincoln` | `NE` | `68508` | `US` | `0056789012341` | `America/Chicago` | yes |
| `LOC-017` | ORG-005 | `Grain Mill` | plant | false | `300 Millstone Drive` | `Omaha` | `NE` | `68102` | `US` | `0056789012342` | `America/Chicago` | yes |

`LOC-005` and `LOC-009` are deliberately inactive. They cannot be selected in the event location dropdown. `LOC-006`, `LOC-008`, `LOC-012`, `LOC-015` are external partner sites.

---

## 3. Screen: `/locations` — list

Header: `Locations`; subtitle `Manage facilities, warehouses, and partner locations`. Button `Add Location` (`LocationsListPage.jsx:202-212`).

### 3.1 Table columns

| UI Label | API Field | Display rule | Citation |
|---|---|---|---|
| Name | `name` | Link to detail | `LocationsListPage.jsx:81-90` |
| Type | `type` | Badge with label `Farm`, `Plant`, `Warehouse`, `Distributor`, `Retailer`, `Other` | `LocationsListPage.jsx:33-40,91-97` |
| Location | `city`, `state`, `country` | Joined with `, `; `—` if all empty | `LocationsListPage.jsx:98-106` |
| GLN | `gln` | Text or `—` | `LocationsListPage.jsx:107-111` |
| External | `is_external` | Badge `Partner` when true, otherwise blank | `LocationsListPage.jsx:112-122` |
| Status | `is_active` | `Active` or `Inactive` badge | `LocationsListPage.jsx:123-131` |
| Actions | — | `View details`; `Deactivate` only for active and admin | `LocationsListPage.jsx:132-171` |

**API shape warning:** location responses are raw snake_case rows (`locations.service.js:52,96,114,184,203`). The list reads `row.original.is_external` and `row.original.is_active`. If a refactor camelCases the response, these columns break. Record the raw response in evidence.

### 3.2 Filters

| Control | Query | Values | Expected |
|---|---|---|---|
| Search locations... | `search` | Free text, max 255 | Matches name, city, or GLN, case-insensitive; resets page to 1 |
| All types | `type` | `all`, six types | `all` removes filter; concrete value filters |
| Pagination | `page`, `limit` | Default `page=1`, `limit=20` | Standard pagination block |

There is no status filter in the UI. The API defaults to active only. To see inactive rows:

```http
GET /api/v1/locations?isActive=false
```

There is no `isActive=all`. A request with both active and inactive requires two calls `[VERIFIED-CODE]`.

### 3.3 Empty state

Title `No locations yet`; description `Add your first location to start recording supply chain events.`; action `Add Location` only for users with `locations.create` (`LocationsListPage.jsx:313-326`).

### 3.4 Create dialog fields

Dialog title `Add Location`; submit button `Create` / `Creating...` (`LocationsListPage.jsx:216-279`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Name * | `name` | `Main Farm` | Text, required | Accepted |
| Type * | `type` | `Farm` | Select, default `Warehouse` | Accepted; stored `farm` |
| Country | `country` | `US` | Text, default `US`, max 2 | Accepted |
| Address | `addressLine1` | `1200 Valley Road` | Text, max 500 | Accepted |
| City | `city` | `Salinas` | Text, max 255 | Accepted |
| State | `state` | `CA` | Text, max 255 | Accepted |
| Zip | `postalCode` | `93901` | Text, max 20 | Accepted |
| GLN | `gln` | `0012345678901` | Text, max 13 | Accepted |
| Timezone | `timezone` | `America/Los_Angeles` | Text, max 100 | Accepted |
| External partner location | `isExternal` | checked for partners | Checkbox, default off | Stored true |
| Cancel | — | click | Button | Closes, resets |
| Create | — | click | Button | `201`, message `Location created successfully`, toast, list refresh |

Fields in the database but not in the UI create dialog: `addressLine2`. It can be set only with `POST /locations` or `PATCH`. `is_active` is not accepted by validation; only the deactivate route changes it.

---

## 4. Screen: `/locations/:locationId` — detail and edit

Header shows name, type badge, `Partner` badge if external, and status badge (`LocationDetailPage.jsx:115-133`). Buttons `Edit`, `Deactivate` based on permission and active status.

### 4.1 Read-only cards

| Card | Label | API Field | Display | Citation |
|---|---|---|---|---|
| Address | address lines | `address_line1`, `address_line2` | Each line if present | `LocationDetailPage.jsx:255-271` |
| Address | city/state/zip | `city`, `state`, `postal_code` | Joined with `, ` | `LocationDetailPage.jsx:263-265` |
| Address | country | `country` | Text | `LocationDetailPage.jsx:266` |
| Address | fallback | — | `No address provided` if no address line 1 and no city | `LocationDetailPage.jsx:267-269` |
| Details | GLN | `gln` | Text or `—` | `LocationDetailPage.jsx:278-281` |
| Details | Timezone | `timezone` | Text or `Org default` | `LocationDetailPage.jsx:282-285` |
| Details | Created | `created_at` | Locale date | `LocationDetailPage.jsx:286-289` |

### 4.2 Edit form

Card title `Edit Location`; save button `Save Changes` / `Saving...` (`LocationDetailPage.jsx:170-250`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Name * | `name` | `Main Farm — North Block` | Text, required | Accepted; duplicate rules apply |
| Type * | `type` | `Farm` | Select | Accepted |
| Address | `addressLine1` | `1200 Valley Road` | Text | Accepted |
| City | `city` | `Salinas` | Text | Accepted |
| State | `state` | `CA` | Text | Accepted |
| Zip | `postalCode` | `93901` | Text | Accepted |
| Country | `country` | `US` | Text, max 2 | Accepted |
| GLN | `gln` | `0012345678901` | Text, max 13 | Accepted |
| Timezone | `timezone` | `America/Los_Angeles` | Text | Accepted |
| External Location | `isExternal` | on/off | Switch | Accepted |
| Cancel | — | click | Button | Returns to read view without saving |
| Save Changes | — | click | Button | `200`; toast; read view shows new values |

`addressLine2` is not editable in the UI and is not sent by the edit form. Existing values are preserved because `PATCH` only updates provided keys (`locations.service.js:124-137`).

---

## 5. Business rules and negative cases

### 5.1 Duplicate name rule

On create, if another location in the same organization has the same name:

1. If the new record has no `gln`, no `addressLine1`, and no `city`, return `409 VALIDATION_ERROR` with `A location with this name already exists. Please provide a GLN, Address Line 1, or City to differentiate them.` (`locations.service.js:17-20`).
2. If the new record has any differentiator but matches an existing record on all three of `gln`, `addressLine1`, and `city`, return `409` with `A location with this exact name, GLN, Address, and City already exists.` (`locations.service.js:22-30`).
3. Otherwise the create succeeds.

On update, the same comparison runs against all other rows in the org (`locations.service.js:143-171`). Unlike create, the update check runs only when `name`, `gln`, `addressLine1`, or `city` is present in the body.

| ID | Case | Expected |
|---|---|---|
| `NEG-LOC-01` | Create `Main Farm` with no GLN, address, or city | `409`, message `A location with this name already exists. Please provide a GLN, Address Line 1, or City to differentiate them.` |
| `NEG-LOC-02` | Create `Main Farm` with GLN `0012345678901` and the same address/city as `LOC-001` | `409`, message `A location with this exact name, GLN, Address, and City already exists.` |
| `NEG-LOC-03` | Create `Main Farm` with a new GLN and new address | `201`; duplicate name allowed |
| `NEG-LOC-04` | Rename `LOC-002` to `Main Farm` with no differentiators | `409`, first duplicate message |
| `NEG-LOC-05` | Rename `LOC-002` to `Main Farm` with distinct GLN/address/city | `200` |
| `NEG-LOC-06` | Create with name empty | Client `Name is required`; API `422`, message `Too small: expected string to have >=1 characters` |
| `NEG-LOC-07` | Create with name 256 chars | `422`, field `name`, Zod max message |
| `NEG-LOC-08` | Create with `type: "cold_storage"` | `422`, field `type`, message `Type must be one of: farm, plant, warehouse, distributor, retailer, other` |
| `NEG-LOC-09` | Create with `country: "USA"` | `422`, field `country`, Zod max 2 message |
| `NEG-LOC-10` | Create with `gln` 14 digits | `422`, field `gln`, Zod max 13 message |
| `NEG-LOC-11` | Create with `postalCode` 21 chars | `422`, field `postalCode`, Zod max 20 message |
| `NEG-LOC-12` | Negative `page` or `limit` | `422` from pagination schema |
| `NEG-LOC-13` | `limit=101` | `422`, field `limit`, Zod max message |
| `NEG-LOC-14` | `type=all` via API | `422`, field `type`, enum message. The UI translates `all` to no parameter. |
| `NEG-LOC-15` | `isActive=maybe` | `422`, field `isActive`, enum `true,false` message |
| `NEG-LOC-16` | Search 256 chars | `422`, field `search`, max 255 message |
| `NEG-LOC-17` | Operator creates location | `201`; allowed (`locations.routes.js:21-25`) |
| `NEG-LOC-18` | Operator updates location | `403 AUTH_FORBIDDEN`, message `Insufficient permissions` |
| `NEG-LOC-19` | Compliance manager deactivates | `403 AUTH_FORBIDDEN`; only `org_admin` |
| `NEG-LOC-20` | Auditor creates location | `403 AUTH_FORBIDDEN` |
| `NEG-LOC-21` | Deactivate already inactive `LOC-005` | `404 NOT_FOUND`, message `Location not found or already deactivated` (`locations.service.js:199-201`) |
| `NEG-LOC-22` | Get cross-tenant location UUID | `404 NOT_FOUND`, message `Location not found` |
| `NEG-LOC-23` | Update cross-tenant location | `404 NOT_FOUND` |
| `NEG-LOC-24` | Deactivate `LOC-001` while events reference it | `200`; events keep `location_id`; location disappears from dropdowns (`LOC-005` proof) |
| `NEG-LOC-25` | Use inactive location in new event | API accepts the UUID because event validation does not check `is_active`. UI dropdown hides it. `[VERIFIED-CODE]` This is a finding for `99_discrepancies_and_findings.md`. |

### 5.2 Exact API error shape

```json
{
  "success": false,
  "message": "A location with this name already exists. Please provide a GLN, Address Line 1, or City to differentiate them.",
  "error": {
    "code": "VALIDATION_ERROR"
  }
}
```

`AppError` sets `code` from the second argument (`locations.service.js:19`). Conflict responses from services do not include a `details` array unless the throw supplies one.

---

## 6. Filters, search, and pagination test matrix

Use ORG-001 locations.

| ID | Request | Expected count | Expected rows |
|---|---|---|---|
| `F-LOC-01` | `GET /locations` | 5 | All active ORG-001; excludes `LOC-005` |
| `F-LOC-02` | `?type=farm` | 2 | `Main Farm`, `Riverside Partner Farm` |
| `F-LOC-03` | `?type=warehouse` | 1 | `Sacramento DC`; excludes inactive `Cold Storage Annex` |
| `F-LOC-04` | `?isExternal=true` | 2 | `Bay Area Retail Depot`, `Riverside Partner Farm` |
| `F-LOC-05` | `?isExternal=false` | 3 | `Main Farm`, `Packing House`, `Sacramento DC` |
| `F-LOC-06` | `?isActive=false` | 1 | `Cold Storage Annex` |
| `F-LOC-07` | `?search=Farm` | 2 | `Main Farm`, `Riverside Partner Farm` |
| `F-LOC-08` | `?search=93901` | 1 | `Main Farm` (city is Salinas, but GLN contains 93901? No: GLN is `0012345678901`; zip is not searched.) **Expected 0.** Use `?search=Salinas` for city. |
| `F-LOC-09` | `?search=Salinas` | 3 | `Main Farm`, `Packing House`, `Cold Storage Annex` (inactive excluded by default, so 2: `Main Farm`, `Packing House`) |
| `F-LOC-10` | `?search=0012345678904` | 1 | `Bay Area Retail Depot` |
| `F-LOC-11` | `?sort=name&order=asc` | 5 | `Bay Area Retail Depot`, `Main Farm`, `Packing House`, `Riverside Partner Farm`, `Sacramento DC` |
| `F-LOC-12` | `?sort=city&order=desc` | 5 | Fresno, Salinas, Salinas, Salinas, Oakland |
| `F-LOC-13` | `?page=2&limit=2` | 2 rows on page 2 of 3 | Pagination block total 5, totalPages 3 |
| `F-LOC-14` | `?limit=100` | 5 | Max allowed limit |
| `F-LOC-15` | ORG-001 token `?search=Main Farm` | 1 | Only ORG-001; ORG-002 has no such name |

`F-LOC-08` is intentionally a negative search: zip and address line 1 are not in the search clause (`locations.service.js:88-94`).

---

## 7. Deactivation

| Step | Action | Expected |
|---|---|---|
| 1 | As `USR-001`, open `LOC-005` detail | Status `Inactive`; `Edit` and `Deactivate` buttons hidden (`LocationDetailPage.jsx:137-163`) |
| 2 | As `USR-001`, deactivate `LOC-001` | Confirmation `Deactivate "Main Farm"?`; on confirm `200`, redirect to `/locations` |
| 3 | List locations | `Main Farm` disappears (default active filter) |
| 4 | `GET /locations?isActive=false` | `Main Farm` appears with status inactive |
| 5 | Record new receiving event | `Main Farm` absent from location dropdown |
| 6 | `GET /events?locationId=<LOC-001 uuid>` | Historical events still returned |
| 7 | Reactivate | No route; no UI. Use SQL fixture `UPDATE locations SET is_active=true` or reseed `[DB-FIXTURE]` |

There is no reactivate endpoint. This is a real gap for manual testing `[VERIFIED-CODE]`.

---

## 8. Payload reference

### Create request

```json
{
  "name": "Main Farm",
  "type": "farm",
  "isExternal": false,
  "addressLine1": "1200 Valley Road",
  "addressLine2": null,
  "city": "Salinas",
  "state": "CA",
  "postalCode": "93901",
  "country": "US",
  "gln": "0012345678901",
  "timezone": "America/Los_Angeles"
}
```

### Create response (raw row, snake_case)

```json
{
  "success": true,
  "message": "Location created successfully",
  "data": {
    "id": "<uuid>",
    "organization_id": "<org-uuid>",
    "name": "Main Farm",
    "type": "farm",
    "is_external": false,
    "address_line1": "1200 Valley Road",
    "address_line2": null,
    "city": "Salinas",
    "state": "CA",
    "postal_code": "93901",
    "country": "US",
    "gln": "0012345678901",
    "timezone": "America/Los_Angeles",
    "is_active": true,
    "created_by": "<user-uuid>",
    "created_at": "2026-06-01T00:00:00.000Z",
    "updated_at": "2026-06-01T00:00:00.000Z"
  }
}
```

Audit action for create/update/deactivate must be captured from `audit_log`; the locations routes do not attach `auditLogger`, so audit rows may be absent. Confirm and record in `99_discrepancies_and_findings.md` `[UNVERIFIED-RUNTIME]`.
