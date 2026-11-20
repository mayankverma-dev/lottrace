# 13 — Products

> Entity: `products`. Screens: `/products` (list + create dialog with KDE builder), `/products/:productId` (detail + edit).
> API: `GET/POST /products`, `GET/PATCH /products/:productId`.

---

## 1. Purpose and prerequisites

Products are created after locations and before lots. A lot always belongs to one product. Product KDE schemas drive event compliance gaps.

| Rule | Value | Citation |
|---|---|---|
| Duplicate name | Allowed only with a distinct SKU | `products.service.js:13-27` |
| KDE name pattern | `^[a-z][a-z0-9_]*$` (snake_case) | `products.validation.js:5` |
| KDE types | `string`, `number`, `boolean`, `date` | `products.validation.js:7-9` |
| KDE fields | `name`, `label`, `type`, `required` | `products.validation.js:4-11` |
| Default list | Active only | `products.service.js:58-63` (lines 20-24 of excerpt) |
| Search fields | `name`, `sku`, `gtin`, case-insensitive | `products.service.js:81-87` |
| Create/edit roles | `org_admin`, `compliance_manager` | `products.routes.js:21-35` |
| No deactivate route | `is_active` stays true unless changed in SQL | `products.routes.js` |
| No delete route | — | `products.routes.js` |

---

## 2. Record set

GTINs are 14 digits and fake. Do not use real GS1 prefixes.

| ID | Org | Name | SKU | GTIN | Category | FTL | Default UOM | Custom KDE schema |
|---|---|---|---|---|---|---|---|---|
| `PRD-001` | ORG-001 | `Organic Baby Spinach` | `GV-SPN-001` | `00012345678901` | `Leafy Greens` | true | `kg` | `harvest_date` date required; `field_heat_index` number optional |
| `PRD-002` | ORG-001 | `Organic Kale` | `GV-KAL-002` | `00012345678902` | `Leafy Greens` | true | `kg` | none |
| `PRD-003` | ORG-001 | `Spring Mix Blend` | `GV-MIX-003` | `00012345678903` | `Leafy Greens` | true | `kg` | `harvest_date` date required; `wash_line` string optional |
| `PRD-004` | ORG-001 | `Romaine Hearts` | `GV-ROM-004` | `00012345678904` | `Leafy Greens` | true | `kg` | none |
| `PRD-005` | ORG-001 | `Cilantro Bunch` | `GV-CIL-005` | `00012345678905` | `Herbs` | false | `units` | `bunch_count` number required |
| `PRD-006` | ORG-001 | `Strawberries` | `GV-STR-006` | `00012345678906` | `Berries` | false | `kg` | none |
| `PRD-007` | ORG-002 | `Frozen Berry Blend` | `NW-FRB-001` | `00022345678901` | `Frozen Fruit` | false | `kg` | none |
| `PRD-008` | ORG-002 | `Organic Baby Spinach` | `NW-SPN-001` | `00022345678902` | `Leafy Greens` | true | `kg` | none |
| `PRD-009` | ORG-003 | `Whole Milk` | `HM-MILK-001` | `00032345678901` | `Dairy` | false | `liters` | `tank_id` string optional |
| `PRD-010` | ORG-003 | `Aged Cheddar` | `HM-CHD-002` | `00032345678902` | `Cheese` | false | `kg` | `aging_days` number optional |
| `PRD-011` | ORG-003 | `Whey Powder` | `HM-WHEY-003` | `00032345678903` | `By-product` | false | `kg` | none |
| `PRD-012` | ORG-004 | `Atlantic Salmon` | `BH-SAL-001` | `00042345678901` | `Finfish` | true | `kg` | `catch_area` string required |
| `PRD-013` | ORG-004 | `Yellowfin Tuna` | `BH-TUN-002` | `00042345678902` | `Finfish` | true | `kg` | none |
| `PRD-014` | ORG-004 | `Salmon Fillet` | `BH-FIL-003` | `00042345678903` | `Finfish` | true | `kg` | none |
| `PRD-015` | ORG-005 | `Hard Red Wheat` | `PG-WHT-001` | `00052345678901` | `Grain` | false | `kg` | `moisture_pct` number optional |
| `PRD-016` | ORG-005 | `Rolled Oats` | `PG-OAT-002` | `00052345678902` | `Grain` | false | `kg` | none |
| `PRD-017` | ORG-005 | `Yellow Corn` | `PG-CRN-003` | `00052345678903` | `Grain` | false | `kg` | none |

`PRD-008` deliberately reuses `Organic Baby Spinach` in another organization. It proves cross-tenant search and name reuse.

### 2.1 KDE schema JSON to paste or enter

`PRD-001`:

```json
[
  { "name": "harvest_date", "label": "Harvest Date", "type": "date", "required": true },
  { "name": "field_heat_index", "label": "Field Heat Index", "type": "number", "required": false }
]
```

`PRD-003`:

```json
[
  { "name": "harvest_date", "label": "Harvest Date", "type": "date", "required": true },
  { "name": "wash_line", "label": "Wash Line", "type": "string", "required": false }
]
```

`PRD-005`:

```json
[
  { "name": "bunch_count", "label": "Bunch Count", "type": "number", "required": true }
]
```

`PRD-012`:

```json
[
  { "name": "catch_area", "label": "Catch Area", "type": "string", "required": true }
]
```

`PRD-015`:

```json
[
  { "name": "moisture_pct", "label": "Moisture %", "type": "number", "required": false }
]
```

The UI builder cannot set `type` reliably on first render because the Select uses `defaultValue` and `setValue` only on change (`ProductsListPage.jsx:246-257`). If you create a field and leave the type untouched, `setValue` never runs for that field. The form default from `append` is `string`, so the submitted value is `string` `[VERIFIED-CODE]`. Confirm the stored JSON after creation.

---

## 3. Screen: `/products` — list

Header: `Products`; subtitle `Manage products and their traceability requirements`. Button `Add Product` (`ProductsListPage.jsx:146-157`).

### 3.1 Table columns

| UI Label | API Field | Display rule | Citation |
|---|---|---|---|
| Product | `name` | Link to detail | `ProductsListPage.jsx:70-79` |
| SKU | `sku` | Text or `—` | `ProductsListPage.jsx:80-84` |
| GTIN | `gtin` | Text or `—` | `ProductsListPage.jsx:85-89` |
| Category | `category` | Text or `—` | `ProductsListPage.jsx:90-94` |
| FTL | `is_ftl` | Badge `FTL` when true, blank otherwise | `ProductsListPage.jsx:95-105` |
| UoM | `default_uom` | Text | `ProductsListPage.jsx:106-110` |
| KDE Fields | `custom_kde_schema` | Count badge or `—` | `ProductsListPage.jsx:111-118` |

Product API responses are raw snake_case rows (`products.service.js:29-52` excerpt). The UI reads `row.original.is_ftl`, `default_uom`, and `custom_kde_schema`.

### 3.2 Filters and empty state

| Control | Query | Values | Expected |
|---|---|---|---|
| Search products... | `search` | max 255 | Matches name, SKU, or GTIN |
| (no UI) | `category` | exact string, max 255 | Exact category filter |
| (no UI) | `isFtl` | `true` / `false` | FTL filter |
| (no UI) | `isActive` | `true` / `false` | Defaults to `true` |
| (no UI) | `sort` | `name`, `createdAt`, `category`, `sku` | Default `createdAt` |
| (no UI) | `order` | `asc`, `desc` | Default `desc` |

Empty state: `No products yet`; `Add your first product to define what you're tracking.`; `Add Product` only for create permission (`ProductsListPage.jsx:309-322`).

### 3.3 Create dialog fields

Dialog title `Add Product`; button `Create` / `Creating...` (`ProductsListPage.jsx:158-287`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Name * | `name` | `Organic Baby Spinach` | Text, required, max 255 | Accepted |
| SKU | `sku` | `GV-SPN-001` | Text, max 100 | Accepted |
| GTIN | `gtin` | `00012345678901` | Text, max 14 | Accepted |
| Category | `category` | `Leafy Greens` | Text, max 255 | Accepted |
| Default Unit of Measure | `defaultUom` | `kg` | Select; options `kg`, `lb`, `units`, `cases`, `pallets`, `liters`, `gallons` | Accepted |
| On FDA Food Traceability List | `isFtl` | on | Switch; default off | Stored true |
| Add Field | — | click | Button | Appends one KDE row |
| Field Name | `customKdeSchema[i].name` | `harvest_date` | Text, required | Accepted if snake_case |
| Label | `customKdeSchema[i].label` | `Harvest Date` | Text, required | Accepted |
| Type | `customKdeSchema[i].type` | `Date` | Select `Text`, `Number`, `Yes/No`, `Date` | Stored `date` |
| Required | `customKdeSchema[i].required` | checked | Checkbox | Stored true |
| Trash icon | — | click | Icon button | Removes row |
| Cancel | — | click | Button | Closes, resets |
| Create | — | click | Button | `201`, message `Product created successfully`; list refresh |

### 3.4 KDE builder states

| State | Display | Citation |
|---|---|---|
| No rows | `No custom fields. Standard KDEs are always captured.` | `ProductsListPage.jsx:275-279` |
| One or more rows | Grid with Field Name, Label, Type, Required, delete | `ProductsListPage.jsx:226-273` |

---

## 4. Screen: `/products/:productId` — detail and edit

Header: product name, `FTL` badge if true, `Active`/`Inactive`, category badge. Button `Edit` if permitted (`ProductDetailPage.jsx:114-142`).

### 4.1 Read-only cards

| Card | Label | API Field | Display | Citation |
|---|---|---|---|---|
| Product Info | SKU | `sku` | Text or `—` | `ProductDetailPage.jsx:254-257` |
| Product Info | GTIN | `gtin` | Text or `—` | `ProductDetailPage.jsx:258-261` |
| Product Info | Category | `category` | Text or `—` | `ProductDetailPage.jsx:262-265` |
| Product Info | Default UoM | `default_uom` | Text | `ProductDetailPage.jsx:266-269` |
| Product Info | Created | `created_at` | Locale date | `ProductDetailPage.jsx:270-273` |
| Custom KDE Fields (N) | field.label | `custom_kde_schema[].label` | Text | `ProductDetailPage.jsx:277-301` |
| Custom KDE Fields (N) | field.name | `custom_kde_schema[].name` | `(field_name)` muted | `ProductDetailPage.jsx:290` |
| Custom KDE Fields (N) | type | `custom_kde_schema[].type` | Badge `Text`, `Number`, `Yes/No`, `Date` | `ProductDetailPage.jsx:23,293` |
| Custom KDE Fields (N) | required | `custom_kde_schema[].required` | `Required` destructive badge | `ProductDetailPage.jsx:294` |
| Custom KDE Fields (0) | — | — | `No custom fields defined. Standard KDEs are always captured.` | `ProductDetailPage.jsx:282-284` |

### 4.2 Edit form

Card title `Edit Product`; button `Save Changes` / `Saving...` (`ProductDetailPage.jsx:146-246`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Name * | `name` | `Organic Baby Spinach` | Text, required | Accepted; duplicate rule |
| SKU | `sku` | `GV-SPN-001` | Text | Accepted |
| GTIN | `gtin` | `00012345678901` | Text | Accepted |
| Category | `category` | `Leafy Greens` | Text | Accepted |
| Default UoM | `defaultUom` | `kg` | Select | Accepted |
| FDA Food Traceability List | `isFtl` | on | Switch | Accepted |
| Custom KDE Fields | `customKdeSchema` | add/remove/edit | Same builder as create | Accepted |
| Cancel | — | click | Button | Exits edit mode |
| Save Changes | — | click | Button | `200`, message `Product updated successfully` |

The detail edit Select uses `defaultValue={product.default_uom || 'kg'}` and only updates on change (`ProductDetailPage.jsx:175-182`). If you save without touching it, the value is still submitted from `startEditing` reset (`ProductDetailPage.jsx:66`). Good.

---

## 5. Duplicate-name rule and negative cases

On create, if another product in the same org has the same name:

1. No SKU supplied: `409 VALIDATION_ERROR`, `A product with this name already exists. Please provide a unique SKU to differentiate them.` (`products.service.js:19-21`).
2. Same SKU supplied: `409`, `A product with this name and SKU already exists.` (`products.service.js:23-26`).
3. Different SKU: allowed (`products.service.js:27`).

On update, the same check runs only when `name` or `sku` is provided (`products.service.js:75-96` in excerpt).

| ID | Case | Expected |
|---|---|---|
| `NEG-PRD-01` | Create second `Organic Baby Spinach` with no SKU | `409`, message `A product with this name already exists. Please provide a unique SKU to differentiate them.` |
| `NEG-PRD-02` | Create second `Organic Baby Spinach` with SKU `GV-SPN-001` | `409`, message `A product with this name and SKU already exists.` |
| `NEG-PRD-03` | Create second `Organic Baby Spinach` with SKU `GV-SPN-001-B` | `201` |
| `NEG-PRD-04` | Rename `Organic Kale` to `Organic Baby Spinach` with no SKU | `409`, first duplicate message |
| `NEG-PRD-05` | Name empty | Client `Name is required`; API `422`, min message |
| `NEG-PRD-06` | Name 256 chars | `422`, field `name`, max 255 message |
| `NEG-PRD-07` | SKU 101 chars | `422`, field `sku`, max 100 message |
| `NEG-PRD-08` | GTIN 15 digits | `422`, field `gtin`, max 14 message |
| `NEG-PRD-09` | `defaultUom: ""` via API | `422`, field `defaultUom`, min 1 message |
| `NEG-PRD-10` | KDE name `Harvest Date` | `422`, field `customKdeSchema.0.name`, message `Field name must be snake_case` |
| `NEG-PRD-11` | KDE name `1harvest` | `422`, same snake_case message |
| `NEG-PRD-12` | KDE name `harvest-date` | `422`, same snake_case message |
| `NEG-PRD-13` | KDE label empty | `422`, field `customKdeSchema.0.label`, message `Field label is required` |
| `NEG-PRD-14` | KDE type `text` | `422`, field `customKdeSchema.0.type`, message `Type must be one of: string, number, boolean, date` |
| `NEG-PRD-15` | KDE name 101 chars | `422`, field `customKdeSchema.0.name`, max 100 message |
| `NEG-PRD-16` | 51 KDE rows | No explicit limit; accepts. Test UI performance `[VERIFIED-CODE]` |
| `NEG-PRD-17` | Operator creates product | `403 AUTH_FORBIDDEN`, message `Insufficient permissions` |
| `NEG-PRD-18` | Auditor edits product | `403 AUTH_FORBIDDEN` |
| `NEG-PRD-19` | Update with `{}` | `422`, message `No fields to update` |
| `NEG-PRD-20` | Cross-tenant GET product | `404 NOT_FOUND`, message `Product not found` |
| `NEG-PRD-21` | Create product with only spaces as name | `201`; `.min(1)` accepts `" "`. Finding for `99_discrepancies_and_findings.md` `[VERIFIED-CODE]` |

### 5.1 Exact duplicate error body

```json
{
  "success": false,
  "message": "A product with this name already exists. Please provide a unique SKU to differentiate them.",
  "error": { "code": "VALIDATION_ERROR" }
}
```

---

## 6. KDE schema and compliance gaps

Event creation checks every linked lot's product schema. For each field with `required: true`, if `kdePayload[field.name]` is absent or falsy, a gap is added (`events/compliance.js:9-38`). Duplicate field names collapse into one gap. Gaps are stored on the event and the generated `has_compliance_gaps` column becomes true.

| Product | Required KDE | Event without it | Result |
|---|---|---|---|
| `PRD-001` | `harvest_date` | `EVT-013` | Gap `{field: "harvest_date", message: ...}`; event appears in Compliance Gaps |
| `PRD-003` | `harvest_date` | any event linking `LOT-004` | Gap |
| `PRD-005` | `bunch_count` | any event linking `LOT-009` | Gap unless `kdePayload.bunch_count` |
| `PRD-012` | `catch_area` | `EVT-019` creating `LOT-017`/`LOT-018` | Gap unless provided; create event for `LOT-017` should include `catch_area` to stay clean |

Falsy values count as missing: `0`, `false`, `""`, `null`. A boolean KDE marked required can therefore never be satisfied with `false` (`events/compliance.js:28`). Record this as a finding.

---

## 7. Search and filter matrix

| ID | Request | Expected ORG-001 result |
|---|---|---|
| `F-PRD-01` | `GET /products` | 6 active products |
| `F-PRD-02` | `?search=Organic` | 2: `Organic Baby Spinach`, `Organic Kale` |
| `F-PRD-03` | `?search=GV-SPN` | 1: `Organic Baby Spinach` |
| `F-PRD-04` | `?search=00012345678903` | 1: `Spring Mix Blend` |
| `F-PRD-05` | `?category=Leafy Greens` | 4 |
| `F-PRD-06` | `?isFtl=true` | 4: spinach, kale, spring mix, romaine |
| `F-PRD-07` | `?isFtl=false` | 2: cilantro, strawberries |
| `F-PRD-08` | `?isActive=false` | 0 until a SQL fixture flips one |
| `F-PRD-09` | `?sort=sku&order=asc` | `GV-CIL-005`, `GV-KAL-002`, `GV-MIX-003`, `GV-ROM-004`, `GV-SPN-001`, `GV-STR-006` |
| `F-PRD-10` | `?page=2&limit=4` | 2 rows, total 6 |
| `F-PRD-11` | ORG-002 `?search=Organic Baby Spinach` | 1: `PRD-008` only |
| `F-PRD-12` | `?category=leafy greens` | 0; category filter is exact and case-sensitive |

---

## 8. Product deletion and deactivation

No API deletes a product. No API deactivates a product. `is_active` exists in the table and filters, but nothing writes it (`products.routes.js`; `products.service.js`). To test inactive product behavior, use a DB fixture:

```sql
UPDATE products SET is_active = false WHERE sku = 'PG-CRN-003';
```

Expected after fixture:

- Product disappears from default list and lot product selector.
- Existing lots and events still resolve the product name.
- `GET /products?isActive=false` returns it.
- No UI action can reactivate it; reverse the SQL.

Label this `[DB-FIXTURE]`, not an application test.
