# 03 — Test Data Design Notes

> Canonical organization and user identities, relationship map, record graph, and fixture strategy.
> Create records in the order shown here unless a scenario says otherwise.

---

## 1. Organization portfolio

Six organizations cover: multi-site produce, cold-chain 3PL, dairy manufacturing, seafood processing, grain handling, and an empty tenant.

| Org ID | Name | Slug pattern | Industry intent | Domain | Data density | Primary purpose |
|---|---|---|---|---|---|---|
| `ORG-001` | Green Valley Fresh Foods | `green-valley-fresh-foods-<8hex>` | Produce grower/packer | `greenvalley.example.com` | High | Main happy-path org; all CTEs, imports, trace, gaps, attachments |
| `ORG-002` | Northwind Cold Chain | `northwind-cold-chain-<8hex>` | Cold storage 3PL | `northwind.example.org` | Medium | External locations, non-FTL products, cross-tenant tests |
| `ORG-003` | Harvest Moon Dairy | `harvest-moon-dairy-<8hex>` | Dairy processor | `harvestmoon.example.com` | Medium | Transformation with two outputs, UOM litres |
| `ORG-004` | Blue Harbor Seafood | `blue-harbor-seafood-<8hex>` | Seafood processor | `blueharbor.example.org` | Medium | FTL flag, transformation, recall simulation |
| `ORG-005` | Prairie Grain Co-op | `prairie-grain-co-op-<8hex>` | Grain elevator/mill | `prairiegrain.example.com` | Medium | High-quantity lots, bulk UOM, CSV import |
| `ORG-006` | Cedar Fork Test Kitchen | `cedar-fork-test-kitchen-<8hex>` | New empty tenant | `cedarfork.example.com` | Empty | Empty states, onboarding, permission isolation |

### How each organization is created

There is no super-admin or public “create organization” endpoint. An organization is created only by the registration + OTP verification flow:

1. `POST /auth/register` stores a pending payload in Redis under `signup:<email>` for 1800 seconds (`backend/src/modules/auth/auth.service.js:114-131`).
2. `POST /auth/verify-email` inserts the organization, derives the slug from the name plus a random suffix, and creates the first `org_admin` (`auth.service.js:179-260`).

Consequences for testing:

- The slug suffix is random and cannot be chosen. Record the actual slug after creation.
- The first user of each organization is always `org_admin`.
- Registration returns `{ requiresVerification: true, email }`, not tokens (`auth.service.js:127-131`).
- The OTP is a 6-digit code delivered by the email worker. With `EMAIL_DRY_RUN=true`, read it from the worker log. There is no API to fetch it.

`[UNVERIFIED-RUNTIME]` The exact log line and OTP visibility depend on the local email transport configuration. Do not attempt to read Redis keys unless you control the development environment.

### Organization settings baseline

| Field | ORG-001 | ORG-002 | ORG-003 | ORG-004 | ORG-005 | ORG-006 |
|---|---|---|---|---|---|---|
| `name` | Green Valley Fresh Foods | Northwind Cold Chain | Harvest Moon Dairy | Blue Harbor Seafood | Prairie Grain Co-op | Cedar Fork Test Kitchen |
| `timezoneDefault` | `America/Los_Angeles` | `America/Denver` | `America/Chicago` | `America/Los_Angeles` | `America/Chicago` | `UTC` |
| `uomDefault` | `kg` | `kg` | `lb` | `kg` | `kg` | `kg` |
| `customSettings` | `{}` | `{"dockScheduling":true}` | `{"organicCertified":true}` | `{"coldChainMinC":-2}` | `{}` | `{}` |

`timezoneDefault`, `uomDefault`, and `customSettings` are not settable at registration. They are changed on `/settings` after creation. Allowed timezone choices in the UI are the nine values in `frontend/src/pages/settings/OrganizationPage.jsx:23-26`. The API accepts any string up to 50 characters (`organizations.validation.js:5`), so API-only values are a separate negative/edge case.

---

## 2. Canonical users

All users use password `LotTrace!Test2026` unless stated otherwise. Invited users have no password until they accept the invite. Deactivated users retain their password hash but cannot log in.

`org_admin` count per active org is at least one. ORG-001 has two to test last-admin protection.

| User ID | Org | First | Last | Email | Role | Status | Notes |
|---|---|---|---|---|---|---|---|
| `USR-001` | ORG-001 | Ava | Thompson | `ava.thompson@greenvalley.example.com` | `org_admin` | active | Primary admin; creates org |
| `USR-002` | ORG-001 | Marcus | Reed | `marcus.reed@greenvalley.example.com` | `org_admin` | active | Second admin; last-admin tests |
| `USR-003` | ORG-001 | Priya | Nair | `priya.nair@greenvalley.example.com` | `compliance_manager` | active | Gap alerts, exports |
| `USR-004` | ORG-001 | Daniel | Okafor | `daniel.okafor@greenvalley.example.com` | `compliance_manager` | active | Amend/void tests |
| `USR-005` | ORG-001 | Elena | Rossi | `elena.rossi@greenvalley.example.com` | `operator` | active | Web + PWA recordings |
| `USR-006` | ORG-001 | Jamal | Carter | `jamal.carter@greenvalley.example.com` | `operator` | active | PWA offline tests |
| `USR-007` | ORG-001 | Mei | Lin | `mei.lin@greenvalley.example.com` | `operator` | active | Import uploads |
| `USR-008` | ORG-001 | Hannah | Schmidt | `hannah.schmidt@greenvalley.example.com` | `auditor` | active | Read-only checks |
| `USR-009` | ORG-001 | Oliver | Grant | `oliver.grant@greenvalley.example.com` | `operator` | invited | Invite expiry/resend |
| `USR-010` | ORG-001 | Rita | Alvarez | `rita.alvarez@greenvalley.example.com` | `auditor` | deactivated | Reactivation tests |
| `USR-011` | ORG-002 | Liam | Chen | `liam.chen@northwind.example.org` | `org_admin` | active | Cross-tenant owner |
| `USR-012` | ORG-002 | Grace | Park | `grace.park@northwind.example.org` | `compliance_manager` | active | |
| `USR-013` | ORG-002 | Victor | Nguyen | `victor.nguyen@northwind.example.org` | `operator` | active | |
| `USR-014` | ORG-002 | Aisha | Bello | `aisha.bello@northwind.example.org` | `operator` | active | |
| `USR-015` | ORG-002 | Tom | Becker | `tom.becker@northwind.example.org` | `auditor` | active | |
| `USR-016` | ORG-002 | Fiona | Walsh | `fiona.walsh@northwind.example.org` | `operator` | invited | |
| `USR-017` | ORG-003 | Sofia | Martinez | `sofia.martinez@harvestmoon.example.com` | `org_admin` | active | |
| `USR-018` | ORG-003 | Ben | Foster | `ben.foster@harvestmoon.example.com` | `compliance_manager` | active | |
| `USR-019` | ORG-003 | Carla | Jimenez | `carla.jimenez@harvestmoon.example.com` | `operator` | active | |
| `USR-020` | ORG-003 | Dmitri | Volkov | `dmitri.volkov@harvestmoon.example.com` | `operator` | active | |
| `USR-021` | ORG-003 | Nina | Patel | `nina.patel@harvestmoon.example.com` | `auditor` | active | |
| `USR-022` | ORG-003 | Owen | Hughes | `owen.hughes@harvestmoon.example.com` | `operator` | deactivated | |
| `USR-023` | ORG-004 | Noah | Williams | `noah.williams@blueharbor.example.org` | `org_admin` | active | |
| `USR-024` | ORG-004 | Amara | Diallo | `amara.diallo@blueharbor.example.org` | `compliance_manager` | active | |
| `USR-025` | ORG-004 | Lucas | Silva | `lucas.silva@blueharbor.example.org` | `operator` | active | |
| `USR-026` | ORG-004 | Zoe | Kim | `zoe.kim@blueharbor.example.org` | `auditor` | active | |
| `USR-027` | ORG-004 | Ravi | Menon | `ravi.menon@blueharbor.example.org` | `operator` | invited | |
| `USR-028` | ORG-005 | Ethan | Brown | `ethan.brown@prairiegrain.example.com` | `org_admin` | active | |
| `USR-029` | ORG-005 | Maja | Nowak | `maja.nowak@prairiegrain.example.com` | `compliance_manager` | active | |
| `USR-030` | ORG-005 | Caleb | Turner | `caleb.turner@prairiegrain.example.com` | `operator` | active | |
| `USR-031` | ORG-005 | Ingrid | Larsen | `ingrid.larsen@prairiegrain.example.com` | `auditor` | active | |
| `USR-032` | ORG-005 | Diego | Ramos | `diego.ramos@prairiegrain.example.com` | `operator` | deactivated | |
| `USR-033` | ORG-006 | Chloe | Dubois | `chloe.dubois@cedarfork.example.com` | `org_admin` | active | Empty-tenant owner |
| `USR-000` | platform | LotTrace | Admin | `admin@lottrace.com` | `super_admin` | active | Seed-only; password from `SEED_SUPER_ADMIN_PASSWORD` |

### Status semantics

| Status | Meaning | Can log in? | Appears in default user list? |
|---|---|---|---|
| `invited` | Invite sent, password not set | No | Yes |
| `active` | Password set, account usable | Yes | Yes |
| `deactivated` | Login blocked, tokens revoked | No | Yes |

Sources: status default `backend/src/db/migrations/20240101000002_create_users.js:14`; login filters `status: 'active'` at `auth.service.js:139-144`; deactivate revokes refresh tokens at `users.service.js:243-292`.

### Email uniqueness across the whole platform

Email uniqueness is global and case-insensitive:

```sql
CREATE UNIQUE INDEX users_email_normalized_unique ON users (lower(email))
```

Source: `backend/src/db/migrations/20260702172631_enforce_global_unique_email.js:14-16`.

Therefore a second organization cannot invite `ava.thompson@greenvalley.example.com`; the invite returns `409 DUPLICATE_ENTRY`. Use the alternate addresses in `11_users_auth.md` §4 for duplicate-case tests.

---

## 3. Locations, products, lots, and events at a glance

Detailed rows live in files 12–15. This is the relationship map.

### ORG-001 — Green Valley Fresh Foods

```text
LOC-001 Main Farm (farm)
  EVT-001 creation -> LOT-001 spinach 500kg, LOT-002 spinach 320kg
  EVT-005 creation -> LOT-003 kale 300kg
  EVT-006 creation -> LOT-006 romaine 200kg
  EVT-008 creation -> LOT-009 cilantro 50kg
  EVT-010 creation -> LOT-010 strawberries 0.0001kg

LOC-002 Packing House (plant)
  EVT-002 receiving <- LOT-001 480kg
  EVT-003 transformation <- LOT-001 250kg + LOT-003 100kg
                       -> LOT-004 spring mix 300kg
  EVT-013 receiving <- LOT-002 100kg (missing required KDE -> gap)

LOC-003 Sacramento DC (warehouse)
  EVT-004 shipping <- LOT-004 200kg

LOC-004 Bay Area Retail Depot (distributor, external)
  no event; counterparty text only

LOC-005 Cold Storage (warehouse, INACTIVE)
  used for inactive filter and event-location rejection

LOC-006 Riverside Partner Farm (farm, external)
  no owned event; counterparty for receiving tests
```

Event lifecycle on this graph:

- `EVT-001` is amended by `EVT-011`; original becomes `amended`, replacement is `active` and points to the original.
- `EVT-007` ships `LOT-006` and is voided by `EVT-012`; original becomes `void`.
- `LOT-007` is a voided duplicate-TLC lot; `LOT-008` reuses the same TLC after the void and must succeed.
- `LOT-005` is a `recalled` DB fixture only; no API can set it.

### ORG-002 — Northwind Cold Chain

```text
LOC-007 Reno Cold Store (warehouse)
  EVT-014 creation -> LOT-011, LOT-012 frozen berry blend
LOC-008 Truck Yard (other, external)
  EVT-015 shipping <- LOT-011 400kg
LOC-009 Boise Transfer (warehouse, INACTIVE)
```

### ORG-003 — Harvest Moon Dairy

```text
LOC-010 Dairy Plant (plant)
  EVT-016 receiving <- LOT-013 whole milk 2000 L
  EVT-017 transformation <- LOT-013 1500 L
                       -> LOT-014 cheddar 400kg
                       -> LOT-015 whey 50kg
  EVT-018 shipping <- LOT-014 100kg
LOC-011 Dairy Farm (farm)
LOC-012 Milk Run Transfer (distributor, external)
```

### ORG-004 — Blue Harbor Seafood

```text
LOC-013 Processing Plant (plant)
  EVT-020 transformation <- LOT-017 salmon 500kg -> LOT-019 salmon fillet 380kg
  EVT-021 shipping <- LOT-019 120kg
LOC-014 Fishing Dock (other)
  EVT-019 creation -> LOT-017 salmon 600kg, LOT-018 tuna 900kg
LOC-015 Seattle Cold Partner (warehouse, external)
```

### ORG-005 — Prairie Grain Co-op

```text
LOC-016 Grain Elevator (warehouse)
  EVT-022 creation -> LOT-020 wheat 25000kg, LOT-021 oats 12000kg, LOT-022 corn 8000kg
  EVT-023 transformation <- LOT-020 10000kg -> LOT-023 wheat flour 9000kg
LOC-017 Grain Mill (plant)
```

### ORG-006 — Cedar Fork Test Kitchen

No locations, products, lots, events, imports, or simulations. Only `USR-033`.

---

## 4. Record creation order

Use this exact order to keep foreign keys and UI selectors populated:

1. **Organizations** via register + OTP (`10_organizations.md`).
2. **First admin** is created by OTP verification. Record the generated user.
3. **Additional users** via invites and accept-invite (`11_users_auth.md`). Users must exist before events reference `recorded_by`, but the pack allows events only after users are active.
4. **Locations** (`12_locations.md`). Products and events need them.
5. **Products** (`13_products.md`). Lots need them.
6. **Lots** (`14_lots.md`). Events need them.
7. **Events** (`15_events.md`). Trace, gaps, audit, notifications depend on them.
8. **Attachments** after their events exist.
9. **Imports** after products and locations exist.
10. **Recall simulations** after the trace graph exists.
11. **Exports** after events and audit rows exist.

Deactivated and recalled fixtures are created last so they do not interfere with happy paths.

---

## 5. Seed and fixture strategy

### 5.1 What must be created through the API/UI

| Data | Why API/UI | Constraint |
|---|---|---|
| Organizations | No admin create endpoint | Registration + OTP only |
| Users | Invite flow creates token and email | Global unique email |
| Locations | Duplicate rule depends on prior rows | Name + GLN/address/city |
| Products | KDE schema is validated by Zod | Name + SKU rule |
| Lots | TLC uniqueness is a partial index | Positive quantity |
| Events | Hash chain, compliance gaps, audit | Idempotency header |
| Imports | Job, S3 object, error report | CSV multipart |
| Recall | Trace and result summary | Lot must exist |

### 5.2 What requires a direct DB fixture

Use only in a disposable development database. These are not application behaviors.

| Fixture | SQL shape | Reason |
|---|---|---|
| `LOT-005` status `recalled` | `UPDATE lots SET status='recalled' WHERE traceability_lot_code='MIX-2026-0002';` | No API writes `recalled` |
| `LOT-015` status `void` for ORG-003 | `UPDATE lots SET status='void', void_reason='duplicate entry' ...` | Faster than API; API path also valid |
| `ORG-006` empty state | none | Naturally empty |
| Inactive product | `UPDATE products SET is_active=false ...` | No product deactivate endpoint |
| Stale import job | `UPDATE imports SET status='processing', started_at=now()-interval '2 hours'` | No cancel endpoint |
| Export limit failure | Insert >1,000,000 rows or use test harness | Impractical manually |

Every DB fixture is marked in its entity file. Tests that claim to verify application behavior must not use DB fixtures except where the entity file says so.

### 5.3 Idempotency keys

Event creation, void, amend, and attachment mutations require an `Idempotency-Key` header. The middleware stores only 2xx responses and rejects a reused key with a different body (`docs/API_STANDARDS.md:274-292`). For manual UI tests, the frontend generates a key automatically (`frontend/src/lib/idempotency.js`). For API tests, generate one UUID per logical operation and reuse it only for retries.

Suggested deterministic keys for repeatable API tests:

```text
11111111-1111-4111-8111-111111111111  EVT-001 first attempt
11111111-1111-4111-8111-111111111112  EVT-001 retry (same body)
22222222-2222-4222-8222-222222222221  EVT-002 first attempt
```

Do not reuse a key across different bodies. That is a negative test, not a happy path.

---

## 6. Cross-tenant pairs

Use these pairs to prove isolation. Each pair uses the same human-readable code in two organizations.

| Concept | ORG-001 value | ORG-002 value | Expected cross-tenant result |
|---|---|---|---|
| Location name | `Main Farm` | `Main Farm` | Listing scoped to caller; GET foreign ID 404 |
| Product name | `Organic Baby Spinach` | `Organic Baby Spinach` | Listing scoped; GET foreign ID 404 |
| Lot TLC | `SPN-2026-0001` | `SPN-2026-0001` | Same code allowed in different orgs |
| Event id | UUID of `EVT-001` | UUID of `EVT-014` | GET/void/amend foreign event 404 |
| User email | `ava.thompson@...` | `liam.chen@...` | Inviting ORG-001 email into ORG-002 fails 409 |

To avoid visual confusion during manual tests, ORG-002 locations use a `NW` prefix in the canonical tables, but one pair (`Main Farm`) intentionally collides. Create the colliding pair only for the isolation scenario, then delete or rename it if your environment does not allow duplicates. Location duplicate rules apply only within an organization (`locations.service.js:13-31`), so cross-org duplicates are allowed.

---

## 7. Data volume summary

| Entity | ORG-001 | ORG-002 | ORG-003 | ORG-004 | ORG-005 | ORG-006 | Total |
|---|---|---|---|---|---|---|---|
| Users | 10 | 6 | 6 | 5 | 5 | 1 | 33 |
| Locations | 6 | 3 | 3 | 3 | 2 | 0 | 17 |
| Products | 6 | 2 | 3 | 3 | 3 | 0 | 17 |
| Lots | 11 | 2 | 4 | 4 | 4 | 0 | 25 |
| Persisted events | 12 | 2 | 3 | 3 | 2 | 0 | 22 |
| Attachments | 3 | 1 | 1 | 1 | 0 | 0 | 6 |
| Imports | 7 | 1 | 0 | 0 | 2 | 0 | 10 |
| Recalls | 2 | 0 | 1 | 1 | 1 | 0 | 5 |
| Exports | 3 | 1 | 0 | 0 | 2 | 0 | 6 |

The lot count includes `LOT-024` (ORG-001) and `LOT-025` (ORG-004), the two cross-org/boundary rows. The event count is persisted rows only: the `EVT-012` void operation changes `EVT-007` and inserts no row. That gives 23 lifecycle records from 22 rows.

Notifications are flow-generated and are not fixed: every non-empty import and every completed or failed export creates one. `18_reports_audit.md` lists 8 baseline rows to verify plus one deliberate DB fixture.

---

## 8. Naming and search collision design

The data intentionally includes names that collide on substrings:

- `Organic Baby Spinach` and `Organic Kale` both contain `Organic`.
- `Spring Mix Blend` contains `Mix`; `Mixed Greens` is only in import examples.
- Locations `Main Farm` and `Riverside Partner Farm` both contain `Farm`.
- Lot codes `SPN-2026-0001`, `SPN-2026-0002`, `SPN-2026-0003`, `SPN-2026-0003` (void + active reuse).
- Product SKUs share the `GV-` prefix.

This supports search tests in `50_search_filter.md` without inventing extra records.

---

## 9. Time anchors

| Window | Use |
|---|---|
| 2026-06-01 08:00Z | EVT-001, EVT-005, EVT-006, EVT-008, EVT-010 |
| 2026-06-02 09:15Z | EVT-002, EVT-003 |
| 2026-06-03 14:30Z | EVT-004 |
| 2026-06-04 11:00Z | EVT-007, EVT-011 amendment |
| 2026-06-05 16:45Z | EVT-012 void |
| 2026-06-06 10:20Z | EVT-013 gap event |
| 2026-06-10..12 | ORG-002 events |
| 2026-06-15..18 | ORG-003 events |
| 2026-06-20..22 | ORG-004 events |
| 2026-06-24..26 | ORG-005 events |

Events outside the current 7-day dashboard window mean `eventsThisWeek` is 0 unless you also create a “now” event. `30_scenarios_e2e.md` includes an optional current-date event for the dashboard counter. The dashboard uses `event_datetime >= now - 7 days` (`backend/src/modules/dashboard/service.js:8-14`), not `created_at`.

---

## 10. What not to do

- Do not create an organization through SQL. The slug and admin user invariants will not match the registration flow.
- Do not reuse a user email across organizations. The unique index is global.
- Do not assume `super_admin` sees tenant data automatically. RBAC allows the role through role checks, but every service still filters by the JWT `organizationId`. The seeded super admin belongs to its own platform organization, so it sees only that organization’s data unless impersonation is added later.
- Do not use real supplier names, real lot codes from production, or real personal data.
- Do not run destructive resets against shared staging or production. This pack assumes a disposable local database.
