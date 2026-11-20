# 14 — Lots

> Entity: `lots`. Screens: `/lots` (list + create dialog), `/lots/:id` (detail, edit dialog, void dialog).
> API: `GET/POST /lots`, `GET/PATCH /lots/:lotId`, `POST /lots/:lotId/void`.

---

## 1. Purpose and prerequisites

A lot is one traceable batch of one product. Events link lots as inputs or outputs. Create lots after users and products.

| Rule | Value | Citation |
|---|---|---|
| TLC uniqueness | Unique per organization + product, excluding `void` lots | `20240101000006_create_lots.js:32-37` |
| Quantity | Positive number, decimal(15,4) | `lots.validation.js:7,14`; `...006:10` |
| Status | `active`, `recalled`, `void` | `...006:12` |
| Only API-written status | `active` on create, `void` on void | `lots.service.js:39-50,242-250` |
| `recalled` | No API writes it; DB fixture only | `[DB-FIXTURE]` |
| Create roles | `org_admin`, `compliance_manager`, `operator` | `lots.routes.js:20-25` |
| Update roles | `org_admin`, `compliance_manager`, `operator` | `lots.routes.js:30-35` |
| Void roles | `org_admin`, `compliance_manager` | `lots.routes.js:37-42` |
| Update blocked | `void` and `recalled` lots | `lots.service.js:182-183` |
| Version | Incremented on update and void; not used as a precondition | `lots.service.js:194,248` |
| Audit actions | `lot.create`, `lot.update`, `lot.void` | `lots.service.js:56,205,256` |

---

## 2. Record set

Quantity units follow the product. All lots are created through `POST /lots` unless marked `[DB-FIXTURE]`.

| ID | Org | Product | TLC | Quantity | UOM | Status | Notes | Purpose |
|---|---|---|---|---|---|---|---|---|
| `LOT-001` | ORG-001 | PRD-001 Spinach | `SPN-2026-0001` | 500.0000 | kg | active | `First spinach harvest` | Main trace source |
| `LOT-002` | ORG-001 | PRD-001 Spinach | `SPN-2026-0002` | 320.0000 | kg | active | `Second field block` | Gap event input |
| `LOT-003` | ORG-001 | PRD-002 Kale | `KAL-2026-0001` | 300.0000 | kg | active | `Kale lot` | Transformation input |
| `LOT-004` | ORG-001 | PRD-003 Spring Mix | `MIX-2026-0001` | 300.0000 | kg | active | `Transformation output` | Shipping input |
| `LOT-005` | ORG-001 | PRD-003 Spring Mix | `MIX-2026-0002` | 150.0000 | kg | recalled | `Mock recall fixture` | Recalled status, edit block `[DB-FIXTURE]` |
| `LOT-006` | ORG-001 | PRD-004 Romaine | `ROM-2026-0001` | 200.0000 | kg | active | `Romaine hearts` | Voided shipping event |
| `LOT-007` | ORG-001 | PRD-005 Cilantro | `CIL-2026-0003` | 50.0000 | units | void | `Duplicate entry` | Void then TLC reuse |
| `LOT-008` | ORG-001 | PRD-005 Cilantro | `CIL-2026-0003` | 50.0000 | units | active | `Recreated after void` | TLC reuse allowed |
| `LOT-009` | ORG-001 | PRD-005 Cilantro | `CIL-2026-0004` | 50.0000 | units | active | `Cilantro bunch lot` | Creation event output |
| `LOT-010` | ORG-001 | PRD-006 Strawberries | `STR-2026-0001` | 0.0001 | kg | active | `Minimum quantity boundary` | Positive decimal boundary |
| `LOT-011` | ORG-002 | PRD-007 Frozen Berry | `FZN-2026-0100` | 600.0000 | kg | active | `Cold store lot` | Cross-tenant TLC pair |
| `LOT-012` | ORG-002 | PRD-007 Frozen Berry | `FZN-2026-0101` | 250.0000 | kg | active | `Second cold store lot` | Creation output |
| `LOT-013` | ORG-003 | PRD-009 Whole Milk | `MILK-2026-0001` | 2000.0000 | liters | active | `Tanker 12` | Transformation input |
| `LOT-014` | ORG-003 | PRD-010 Cheddar | `CHD-2026-0001` | 400.0000 | kg | active | `Aged 60 days` | Transformation output |
| `LOT-015` | ORG-003 | PRD-011 Whey | `WHEY-2026-0001` | 50.0000 | kg | active | `By-product` | Second transformation output |
| `LOT-016` | ORG-003 | PRD-011 Whey | `WHEY-2026-0001` | 50.0000 | kg | void | `Duplicate entry` | Void then TLC reuse `[API]` |
| `LOT-017` | ORG-004 | PRD-012 Salmon | `SAL-2026-0001` | 600.0000 | kg | active | `Catch area 3` | Creation output |
| `LOT-018` | ORG-004 | PRD-013 Tuna | `TUN-2026-0001` | 900.0000 | kg | active | `Catch area 5` | Creation output |
| `LOT-019` | ORG-004 | PRD-014 Salmon Fillet | `FIL-2026-0001` | 380.0000 | kg | active | `Fillet output` | Transformation output |
| `LOT-020` | ORG-005 | PRD-015 Wheat | `WHT-2026-0001` | 25000.0000 | kg | active | `Elevator bin 4` | Bulk input |
| `LOT-021` | ORG-005 | PRD-016 Oats | `OAT-2026-0001` | 12000.0000 | kg | active | `Elevator bin 5` | Creation output |
| `LOT-022` | ORG-005 | PRD-017 Corn | `CRN-2026-0001` | 99999999999.9999 | kg | active | `Decimal(15,4) maximum` | Upper quantity boundary |
| `LOT-023` | ORG-005 | PRD-015 Wheat | `WHT-2026-0002` | 9000.0000 | kg | active | `Milled flour` | Transformation output |
| `LOT-024` | ORG-001 | PRD-001 Spinach | `FZN-2026-0100` | 10.0000 | kg | active | `Cross-org TLC reuse` | Same TLC as LOT-011, different org |
| `LOT-025` | ORG-004 | PRD-012 Salmon | `SAL-2026-0099` | 0.0001 | kg | active | `Minimum quantity boundary` | Positive decimal boundary |

Notes:

- `LOT-005` requires SQL because no API writes `recalled`: `UPDATE lots SET status='recalled' WHERE traceability_lot_code='MIX-2026-0002';`
- `LOT-016` must be created and then voided through the API. Use `USR-004` (`compliance_manager`) with curl because the UI hides Void Lot for that role. See §7.
- `LOT-022` is at the maximum for `decimal(15,4)`: 11 integer digits + 4 fractional digits. `100000000000` overflows and returns a database error, not a validation error.
- `LOT-010` and `LOT-025` prove that `0.0001` is accepted. `0` is rejected.

---

## 3. Screen: `/lots` — list

Header: `Lots`; subtitle `Manage inventory lots and traceability codes`; button `Create Lot` (`LotsListPage.jsx:158-169`).

### 3.1 Table columns

| UI Label | API Field | Display rule | Citation |
|---|---|---|---|
| Lot Code | `traceabilityLotCode` | Link with layers icon | `LotsListPage.jsx:81-94` |
| Product | `productName` | Name plus `SKU: <sku>` if present | `LotsListPage.jsx:95-106` |
| Quantity | `quantity`, `uom` | `Number(...).toLocaleString()` plus UOM | `LotsListPage.jsx:107-115` |
| Status | `status` | `Active` green, `Recalled` destructive, `Void` secondary | `LotsListPage.jsx:33-44,116-120` |
| Created | `createdAt` | Locale date only | `LotsListPage.jsx:121-129` |

Lot responses are camelCase (`lots.service.js:97-111`). Product name is joined from `products.name`.

### 3.2 Search and empty state

Only one filter control: `Search lot code or product...`. It sends `search`, resets page to 1, and matches TLC or product name (`LotsListPage.jsx:225-236`; `lots.service.js:123-128`).

Empty state: `No lots found`; `Lots represent specific batches of products in your supply chain.`; action `Create Lot` when `can('events.create')` (`LotsListPage.jsx:239-252`).

The UI does not expose product, status, type, or sort filters. The API supports them.

### 3.3 Create dialog

Dialog title `Create Lot`; submit `Create` / `Creating...` (`LotsListPage.jsx:170-218`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Product * | `productId` | `Organic Baby Spinach` | Select from active products; first 100 | Accepted; selecting sets UOM to product default |
| Traceability Lot Code * | `traceabilityLotCode` | `SPN-2026-0001` | Text, required, max 255 | Accepted |
| Quantity * | `quantity` | `500` | Number, any step | Accepted; stored `500.0000` |
| Unit of Measure * | `uom` | `kg` | Text, required, max 20 | Accepted; auto-filled from product |
| Notes | `notes` | `First spinach harvest` | Textarea, max 1000 | Accepted |
| Cancel | — | click | Button | Closes, resets |
| Create | — | click | Button | `201`, message `Lot created successfully`; row appears |

Product list call is `useGetProducts({ limit: 100, isActive: 'true' })` (`LotsListPage.jsx:54`). An organization with more than 100 active products cannot select the rest in this dialog `[VERIFIED-CODE]`.

---

## 4. Screen: `/lots/:id` — detail

Page title is the TLC; subtitle `Product: <productName>` (`LotDetailPage.jsx:121-124`).

### 4.1 Lot Information card

| Label | API Field | Display | Citation |
|---|---|---|---|
| Product | `productName` | Link to `/products/:productId` | `LotDetailPage.jsx:163-171` |
| Quantity | `quantity`, `uom` | Localized number plus UOM | `LotDetailPage.jsx:172-175` |
| Traceability Lot Code (TLC) | `traceabilityLotCode` | Monospace badge | `LotDetailPage.jsx:176-179` |
| Created At | `createdAt` | Locale date and time | `LotDetailPage.jsx:180-183` |
| Voided Reason | `voidReason` | Red box, only when status `void` and reason present | `LotDetailPage.jsx:184-191` |
| Notes | `notes` | Pre-wrapped text, only if present | `LotDetailPage.jsx:192-197` |

The card does not show `status` inside the body; the status badge is in the page header. It does not show `version`, `organizationId`, `createdBy`, or `updatedAt`.

### 4.2 Event Timeline card

Loads `GET /events?lotId=<uuid>&limit=100` (`LotDetailPage.jsx:54`).

| Element | API Field | Display | Citation |
|---|---|---|---|
| Event title | `event_type` | `<Type> Event`, linked to `/events/:id` | `LotDetailPage.jsx:223-225` |
| Void badge | `status` | `VOID` when void | `LotDetailPage.jsx:226-228` |
| Location | `location_name` | `at <name>`; may be empty for events without a location | `LotDetailPage.jsx:229-231` |
| Date/time | `event_datetime` | `formatEventDate` | `LotDetailPage.jsx:234` |
| Recorder | `recorded_by_name` | `by <name>` | `LotDetailPage.jsx:235` |

Empty: `No events recorded for this lot.` (`LotDetailPage.jsx:241-245`).

Timeline order is the event-list order: `created_at DESC, chain_seq DESC`, so newest first.

### 4.3 Actions

| Action | Visibility | Dialog | Citation |
|---|---|---|---|
| Edit Details | `can('events.create')` and status not `void` | `Edit Lot` | `LotDetailPage.jsx:128-139,251-276` |
| Void Lot | `can('org_admin')` and status not `void` | `Void Lot` | `LotDetailPage.jsx:140-145,278-304` |

**Role mismatch:** the API allows `compliance_manager` to void (`lots.routes.js:37-42`), but the UI checks `can('org_admin')`, which is true only for role `org_admin` (`usePermissions.js:3-43,53-57`). A compliance manager sees Edit but not Void. Test both: UI hides, API succeeds. This is a finding for `99_discrepancies_and_findings.md`.

### 4.4 Edit dialog

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| Quantity | `quantity` | `510` | Number, any step | Accepted; `500` → `510` |
| Notes | `notes` | `Corrected harvest weight` | Textarea | Accepted |
| Cancel | — | click | Button | No change |
| Save Changes | — | click | Button | `200`, message `Lot updated successfully`; version increments |

The edit dialog cannot change product, TLC, UOM, or status. Those are immutable through this form. The API validation also allows only `notes` and `quantity` (`lots.validation.js:12-15`).

### 4.5 Void dialog

Title `Void Lot`; description `This will mark the lot as voided. It cannot be used in future events. This action is irreversible.` (`LotDetailPage.jsx:281-289`).

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| Reason for voiding * | `voidReason` | `Duplicate entry` | Textarea, required, max 1000 | Accepted |
| Cancel | — | click | Button | No change |
| Void Lot / Voiding... | — | click | Button | `200`, message `Lot voided successfully`; badge `Void`; edit action disappears |

After void:

- Lot cannot be updated (`400 LOT_VOIDED`).
- Lot cannot be used as an input or output in a new event. Event creation checks lot status? Verify in `15_events.md`; current UI hides void lots.
- The same TLC can be reused for the same product because the partial unique index excludes void rows (`...006:32-37`).
- Void is irreversible through the API. There is no restore route.

---

## 5. Business rules

### 5.1 TLC uniqueness

| Scenario | Result |
|---|---|
| Same TLC, same org, same product, existing active | `409`/database unique error |
| Same TLC, same org, same product, existing void | Allowed |
| Same TLC, same org, different product | Allowed |
| Same TLC, different org, same product name | Allowed |

The error for a duplicate active TLC comes from the partial unique index, not from a service check. Expect a database constraint error surfaced by the global error handler; record the exact status and message during the run. `[UNVERIFIED-RUNTIME]`

### 5.2 Status rules

| Current status | Update | Void | New event link |
|---|---|---|---|
| `active` | Allowed | Allowed | Allowed |
| `recalled` | `400 LOT_RECALLED`, `Cannot update a recalled lot` | Allowed by code; no status check in `voidLot` | Allowed by code; compliance gaps may apply |
| `void` | `400 LOT_VOIDED`, `Cannot update a voided lot` | `400 LOT_VOIDED`, `Lot is already voided` | Should be blocked; confirm in event tests |

`voidLot` does not block voiding a recalled lot. That may be intended (recall then void) or a gap; record actual behavior.

### 5.3 Version behavior

`version` starts at 1 and increments on every update and void (`...006:14`; `lots.service.js:194,248`). The PATCH schema has no `version` field (`lots.validation.js:12-15`), and the service does not compare an expected version. Two concurrent updates both succeed; the last write wins. The column is not true optimistic concurrency. Record this as a finding.

---

## 6. Negative and boundary cases

| ID | Case | Request / Input | Expected Result |
|---|---|---|---|
| `NEG-LOT-01` | Quantity 0 | `{"quantity":0}` | `422`, field `quantity`, message `Quantity must be positive` |
| `NEG-LOT-02` | Quantity negative | `-1` | `422`, same message |
| `NEG-LOT-03` | Quantity blank | empty number field | Client `Must be positive`; API `422` invalid number |
| `NEG-LOT-04` | Quantity `0.0001` | decimal minimum | `201` |
| `NEG-LOT-05` | Quantity `99999999999.9999` | max for decimal(15,4) | `201` |
| `NEG-LOT-06` | Quantity `100000000000` | 12 integer digits | Database numeric overflow; `500` or mapped error `[UNVERIFIED-RUNTIME]` |
| `NEG-LOT-07` | Quantity `1e3` via JSON | number 1000 | `201`; coercion accepts |
| `NEG-LOT-08` | TLC empty | `""` | Client `Lot code is required`; API `422`, min 1 |
| `NEG-LOT-09` | TLC 256 chars | long string | `422`, field `traceabilityLotCode`, max 255 |
| `NEG-LOT-10` | UOM empty | `""` | `422`, field `uom`, message `Unit of measure is required` |
| `NEG-LOT-11` | UOM 21 chars | long string | `422`, max 20 |
| `NEG-LOT-12` | Product UUID unknown | random UUID | `404 NOT_FOUND`, message `Product not found` (`lots.service.js:34-37`) |
| `NEG-LOT-13` | Product belongs to another org | ORG-002 product UUID with ORG-001 token | `404 NOT_FOUND`, message `Product not found` |
| `NEG-LOT-14` | Product ID not a UUID | `"abc"` | `422`, field `productId`, message `Invalid Product ID` |
| `NEG-LOT-15` | Notes 1001 chars | long text | `422`, field `notes`, max 1000 |
| `NEG-LOT-16` | Duplicate active TLC same product | repeat `SPN-2026-0001` | Unique violation; record status/message |
| `NEG-LOT-17` | Duplicate TLC after void | `LOT-007` voided, create `CIL-2026-0003` | `201` |
| `NEG-LOT-18` | Update void lot | `PATCH LOT-007 {"quantity":60}` | `400 LOT_VOIDED`, message `Cannot update a voided lot` |
| `NEG-LOT-19` | Update recalled lot | `PATCH LOT-005 {"quantity":160}` | `400 LOT_RECALLED`, message `Cannot update a recalled lot` |
| `NEG-LOT-20` | Update with `{}` | empty body | `422`, message `No fields to update` |
| `NEG-LOT-21` | Void with empty reason | `{"voidReason":""}` | `422`, message `Void reason is required` |
| `NEG-LOT-22` | Void reason 1001 chars | long text | `422`, field `voidReason`, max 1000 |
| `NEG-LOT-23` | Void already void | `POST /lots/LOT-007/void` | `400 LOT_VOIDED`, message `Lot is already voided` |
| `NEG-LOT-24` | Void as operator | `USR-005` | `403 AUTH_FORBIDDEN`, message `Insufficient permissions` |
| `NEG-LOT-25` | Void as auditor | `USR-008` | `403 AUTH_FORBIDDEN` |
| `NEG-LOT-26` | Void as compliance manager via UI | `USR-004` | Menu item absent; API call succeeds `200` |
| `NEG-LOT-27` | Get cross-tenant lot | ORG-001 token + ORG-002 lot UUID | `404 NOT_FOUND`, message `Lot not found` |
| `NEG-LOT-28` | Update cross-tenant lot | same | `404 NOT_FOUND` |
| `NEG-LOT-29` | Create lot as auditor | `USR-008` | `403 AUTH_FORBIDDEN` |
| `NEG-LOT-30` | Create lot as operator | `USR-005` | `201`; allowed |
| `NEG-LOT-31` | TLC with spaces only | `"   "` | `201`; `.min(1)` accepts spaces. Finding |
| `NEG-LOT-32` | Notes `null` on create | `null` | `201`; stored null |
| `NEG-LOT-33` | Update notes `null` | `{"notes":null}` | `200`; clears notes |
| `NEG-LOT-34` | Concurrent updates | two `PATCH` calls | Both succeed; version jumps by 2 if serial, or last write wins; no conflict error. Finding |

---

## 7. How to create the special statuses

### `LOT-005` recalled

```sql
UPDATE lots
SET status = 'recalled', updated_at = now()
WHERE traceability_lot_code = 'MIX-2026-0002';
```

Verify: list with `?status=recalled` returns one row; detail shows `Recalled`; edit returns `400 LOT_RECALLED`.

### `LOT-016` void through API

As `USR-004` (`compliance_manager`), get a token, then:

```bash
curl -X POST http://localhost:3000/api/v1/lots/<LOT-016-uuid>/void \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"voidReason":"Duplicate entry"}'
```

Expected `200`, message `Lot voided successfully`. Then create `LOT-015` with the same TLC? No: create `LOT-016` first, void it, then create `LOT-015` with the same TLC. Order matters.

### Void `LOT-007`, then create `LOT-008`

1. Create `LOT-007` with TLC `CIL-2026-0003`.
2. Void it through the API.
3. Create `LOT-008` with the same product and TLC.
4. Expected `201`; both rows exist, only `LOT-008` is active.

---

## 8. Search and filter matrix

| ID | Request | Expected ORG-001 |
|---|---|---|
| `F-LOT-01` | `GET /lots` | All 11 ORG-001 lots including void and recalled; no default status filter |
| `F-LOT-02` | `?search=SPN` | `SPN-2026-0001`, `SPN-2026-0002` |
| `F-LOT-03` | `?search=spinach` | Both spinach lots; product name match |
| `F-LOT-04` | `?search=Cilantro` | Three cilantro lots |
| `F-LOT-05` | `?status=void` | `LOT-007`, `LOT-016` if scoped to ORG-003 |
| `F-LOT-06` | `?status=recalled` | `LOT-005` |
| `F-LOT-07` | `?productId=<PRD-001>` | `LOT-001`, `LOT-002`, `LOT-024` |
| `F-LOT-08` | `?traceabilityLotCode=MIX-2026-0001` | Exactly `LOT-004`; exact match, case-sensitive |
| `F-LOT-09` | `?traceabilityLotCode=mix-2026-0001` | 0; exact match |
| `F-LOT-10` | `?sort=quantity&order=asc` | `LOT-010` 0.0001 first |
| `F-LOT-11` | `?sort=status&order=asc` | active, recalled, void in alphabetical DB order |
| `F-LOT-12` | `?page=2&limit=10` | 1 row on page 2 for ORG-001 |
| `F-LOT-13` | `?limit=101` | `422` |
| `F-LOT-14` | ORG-002 `?search=FZN` | `LOT-011`, `LOT-012` only |
| `F-LOT-15` | ORG-001 `?traceabilityLotCode=FZN-2026-0100` | `LOT-024` only; proves cross-org TLC reuse |

`traceabilityLotCode` is exact-match unlike `search` (`lots.service.js:120-122`). This is intentional for scanner lookup in the PWA.

---

## 9. Payload reference

### Create

```json
{
  "productId": "<PRD-001-uuid>",
  "traceabilityLotCode": "SPN-2026-0001",
  "quantity": 500,
  "uom": "kg",
  "notes": "First spinach harvest"
}
```

### Create response

```json
{
  "success": true,
  "message": "Lot created successfully",
  "data": {
    "id": "<uuid>",
    "organizationId": "<org-uuid>",
    "productId": "<product-uuid>",
    "traceabilityLotCode": "SPN-2026-0001",
    "quantity": "500.0000",
    "uom": "kg",
    "notes": "First spinach harvest",
    "status": "active",
    "createdAt": "2026-06-01T08:00:00.000Z",
    "updatedAt": "2026-06-01T08:00:00.000Z",
    "version": 1
  }
}
```

`quantity` is a string in JSON because PostgreSQL `decimal` is returned as a string by `pg`. The UI handles this with `Number(...)`.

### Update

```json
{ "quantity": 510, "notes": "Corrected harvest weight" }
```

Response includes `version: 2` and a new `updatedAt`.

### Void

```json
{ "voidReason": "Duplicate entry" }
```

Response includes `status: "void"`, `voidReason`, and incremented `version`.

---

## 10. Cleanup

- Voided lots cannot be restored. Reset the database if a scenario needs a clean lot.
- Recalled fixture `LOT-005` requires a SQL update to return to `active`; there is no API.
- Do not delete lots that have event links; there is no delete route and foreign keys block it.
