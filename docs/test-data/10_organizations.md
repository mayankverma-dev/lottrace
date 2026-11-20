# 10 — Organizations

> Entity: tenant root. One organization per company. Created only by registration + email verification.
> Screens: `/settings` (`OrganizationPage`). API: `GET /organizations/me`, `PATCH /organizations/me`.

---

## 1. Purpose and prerequisites

| Item | Value | Citation |
|---|---|---|
| Created by | `POST /auth/register` then `POST /auth/verify-email` | `auth.service.js:87-131,173-243` |
| First user role | `org_admin` (hard-coded) | `auth.service.js:209` |
| Defaults after creation | `industry_vertical=food`, `plan_tier=starter`, `status=active`, `timezone_default=UTC`, `uom_default=kg`, `custom_settings={}` | `20240101000001_create_organizations.js:10-15`; `auth.service.js:192-198` |
| Slug | Slugified name + `-` + 8 random hex characters | `auth.service.js:196-205` |
| Who can view settings | Any authenticated user (route has no role gate) | `organizations.routes.js:15` |
| Who can edit settings | `org_admin` only | `organizations.routes.js:18` |

Create the six organizations in this file before any other entity. Record the real UUID and slug for each. The test IDs (`ORG-001` …) are labels only.

---

## 2. Record set

| ID | Organization Name | Default Timezone | Default UOM | Custom Settings | Purpose |
|---|---|---|---|---|---|
| `ORG-001` | Green Valley Fresh Foods | `America/Los_Angeles` | `kg` | `{}` | Primary happy-path tenant |
| `ORG-002` | Northwind Cold Chain | `America/Denver` | `kg` | `{"dockScheduling":true}` | Cross-tenant isolation |
| `ORG-003` | Harvest Moon Dairy | `America/Chicago` | `lb` | `{"organicCertified":true}` | Transformation and UOM variation |
| `ORG-004` | Blue Harbor Seafood | `America/Los_Angeles` | `kg` | `{"coldChainMinC":-2}` | FTL and recall simulation |
| `ORG-005` | Prairie Grain Co-op | `America/Chicago` | `kg` | `{}` | Bulk quantities and import |
| `ORG-006` | Cedar Fork Test Kitchen | `UTC` | `kg` | `{}` | Empty tenant |

### 2.1 Registration inputs used to create each organization

The organization name is entered on `/register`; the rest of the registration form is in `11_users_auth.md`.

| ID | UI Label: Organization Name | Input Type | Expected Result |
|---|---|---|---|
| `ORG-001` | `Green Valley Fresh Foods` | Text, max 100 | Pending signup stored 30 min; after OTP, org created with slug `green-valley-fresh-foods-<8hex>` |
| `ORG-002` | `Northwind Cold Chain` | Text | Slug `northwind-cold-chain-<8hex>` |
| `ORG-003` | `Harvest Moon Dairy` | Text | Slug `harvest-moon-dairy-<8hex>` |
| `ORG-004` | `Blue Harbor Seafood` | Text | Slug `blue-harbor-seafood-<8hex>` |
| `ORG-005` | `Prairie Grain Co-op` | Text | Slug `prairie-grain-co-op-<8hex>` |
| `ORG-006` | `Cedar Fork Test Kitchen` | Text | Slug `cedar-fork-test-kitchen-<8hex>` |

### 2.2 Settings values to apply after first login

| ID | Organization Name | Default Timezone | Default Unit of Measure | Custom Settings |
|---|---|---|---|---|
| `ORG-001` | `Green Valley Fresh Foods` | `America/Los_Angeles` | Kilograms (kg) | leave `{}` |
| `ORG-002` | `Northwind Cold Chain` | `America/Denver` | Kilograms (kg) | set via API only `{"dockScheduling":true}` |
| `ORG-003` | `Harvest Moon Dairy` | `America/Chicago` | Pounds (lb) | set via API only `{"organicCertified":true}` |
| `ORG-004` | `Blue Harbor Seafood` | `America/Los_Angeles` | Kilograms (kg) | set via API only `{"coldChainMinC":-2}` |
| `ORG-005` | `Prairie Grain Co-op` | `America/Chicago` | Kilograms (kg) | leave `{}` |
| `ORG-006` | `Cedar Fork Test Kitchen` | `UTC` | Kilograms (kg) | leave `{}` |

`customSettings` has no UI control. Apply it with `PATCH /organizations/me` as `org_admin`. If you do not need it, skip it; no other test depends on the value.

---

## 3. Screen: `/settings` — Profile Details

Card title: `Profile Details`; description: `Update your organization's core information and defaults.` (`OrganizationPage.jsx:80-81`). Save button label: `Save Changes` (`OrganizationPage.jsx:135-138`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Organization Name | `name` | `Green Valley Fresh Foods` | Text input, required, max 100 | Saves; success toast; header and sidebar text unchanged until refresh |
| Organization Name (boundary) | `name` | 100 `A` characters | Text input | Saves; audit row records before/after |
| Organization Name (boundary) | `name` | 101 `A` characters | Text input | `422 VALIDATION_ERROR`, field `name`, message `Too big: expected string to have <=100 characters` (Zod default) |
| Organization Name (empty) | `name` | empty | Clear field and submit | Client blocks with `Organization Name is required` (`OrganizationPage.jsx:18`) |
| Default Timezone | `timezoneDefault` | `America/Los_Angeles` | Select, required | Saves |
| Default Timezone (all options) | `timezoneDefault` | `UTC`, `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, `Europe/London`, `Europe/Paris`, `Asia/Tokyo`, `Australia/Sydney` | Select | Each option saves; values are the only choices in the UI (`OrganizationPage.jsx:23-26`) |
| Default Timezone (API-only) | `timezoneDefault` | `Not/AZone` | `PATCH` with curl | Saves `200`; no IANA validation (`organizations.validation.js:5`) |
| Default Timezone (empty) | `timezoneDefault` | empty | Select cannot be cleared; use API `""` | `422`, message `Too small: expected string to have >=1 characters` |
| Default Unit of Measure | `uomDefault` | `Kilograms (kg)` | Select, required | Saves `kg` |
| Default Unit of Measure (options) | `uomDefault` | `Kilograms (kg)`, `Pounds (lb)`, `Grams (g)`, `Ounces (oz)`, `Units` | Select | Each maps to `kg`, `lb`, `g`, `oz`, `units` (`OrganizationPage.jsx:27-31`) |
| Default Unit of Measure (API-only) | `uomDefault` | `metric_ton` | `PATCH` with curl | Saves `200`; max 20, no enum (`organizations.validation.js:6`) |
| Read-only: Plan | `planTier` | `starter` | Text display | Shown as `Starter`; cannot edit (`OrganizationPage.jsx:146-160`) |
| Read-only: Status | `status` | `active` | Badge | Shown as `Active`; cannot edit |
| Read-only: Slug | `slug` | generated | Text display | Shown in Subscription & Account card |
| Save (no changes) | — | submit unchanged | Button | `200`; writes `updated_at` even when values match. No “no changes” check `[VERIFIED-CODE]` |

Notes:

- The frontend form sends all three fields on every save (`OrganizationPage.jsx:33-43`), so the API's `No fields to update` path is reachable only with a raw `PATCH {}` (`organizations.service.js:31-33`).
- `PATCH` uses `.strict()`: any unknown key returns `422` with `Unrecognized key(s) in object: 'organizationId'` (`organizations.validation.js:8`).
- Body `organizationId` cannot change tenancy. The service ignores it; unknown keys are rejected before the service runs.

---

## 4. Negative and boundary cases

| ID | Case | Request | Expected Result |
|---|---|---|---|
| `NEG-ORG-01` | Empty body | `PATCH /organizations/me` `{}` | `422 VALIDATION_ERROR`, message `No fields to update`, no `details` |
| `NEG-ORG-02` | Unknown key | `PATCH` `{"industryVertical":"pharma"}` | `422 VALIDATION_ERROR`, details field `industryVertical`, message `Unrecognized key(s) in object: 'industryVertical'` |
| `NEG-ORG-03` | Non-admin edit | Login as `USR-003` (`compliance_manager`), open `/settings` | Save button hidden; direct `PATCH` returns `403 AUTH_FORBIDDEN`, message `Insufficient permissions` (`rbac.js`) |
| `NEG-ORG-04` | Operator edit | Login as `USR-005` (`operator`) | Same as `NEG-ORG-03` |
| `NEG-ORG-05` | Auditor edit | Login as `USR-008` (`auditor`) | Same as `NEG-ORG-03` |
| `NEG-ORG-06` | Cross-tenant read | `GET /organizations/me` with ORG-002 token | Returns ORG-002 only; there is no `:id` route to attack (`organizations.routes.js:15`) |
| `NEG-ORG-07` | `customSettings` wrong type | `PATCH` `{"customSettings":"x"}` | `422`, details field `customSettings`, message `Invalid input: expected object, received string` |
| `NEG-ORG-08` | Name with HTML | `PATCH` `{"name":"<script>alert(1)</script>"}` | Saves; rendered as text by React. XSS must not execute. Screenshot for evidence `[INFRA]` |
| `NEG-ORG-09` | Missing token | `PATCH` without `Authorization` | `401 UNAUTHORIZED`, message `Authentication required` (`authenticate.js`) |
| `NEG-ORG-10` | Deactivated user token | Deactivate `USR-010`, reuse its access token | `401`, message `Account is deactivated` (`authenticate.js:48-71`) |

---

## 5. Empty tenant: ORG-006

Login as `USR-033` (`chloe.dubois@cedarfork.example.com`). Expected empty states:

| Screen | Expected |
|---|---|
| `/dashboard` | Zero counts; onboarding checklist visible; no activity rows |
| `/lots` | Empty state with “create lot” action |
| `/events` | Empty state; no filter results |
| `/locations` | Empty state |
| `/products` | Empty state |
| `/trace` | Lot selector empty; trace cannot run |
| `/reports/compliance-gaps` | Zero gaps, not an error |
| `/recall` | Empty list; create dialog requires a lot and cannot submit |
| `/imports` | Empty list; upload still allowed |
| `/settings/users` | One user: `USR-033` |
| Notifications bell | Zero unread; dropdown empty |

---

## 6. Seed super-admin organization

The seed script creates a platform organization for `admin@lottrace.com` (`backend/src/db/seed-super-admin.js:164-260`). Details:

| Item | Value | Citation |
|---|---|---|
| Email | `admin@lottrace.com` | `seed-super-admin.js:7` |
| Role | `super_admin` | `seed-super-admin.js:242` |
| Organization name | `LotTrace Platform` (fixed by seed) | `seed-super-admin.js:180-195` |
| Minimum password length | 12 | `seed-super-admin.js:8,132-135` |
| Environment gate | Refuses `NODE_ENV=production`; remote requires confirmation | `seed-super-admin.js:82-104` |

Do not use this account for tenant tests. `super_admin` passes RBAC role checks but services still filter by its own `organizationId` (`rbac.js`; `AGENTS.md`). It sees no ORG-001 data.

---

## 7. API payload reference

### `GET /organizations/me` → `200`

```json
{
  "success": true,
  "message": "Organization fetched successfully",
  "data": {
    "id": "<uuid>",
    "name": "Green Valley Fresh Foods",
    "slug": "green-valley-fresh-foods-a1b2c3d4",
    "industryVertical": "food",
    "planTier": "starter",
    "status": "active",
    "timezoneDefault": "America/Los_Angeles",
    "uomDefault": "kg",
    "customSettings": {},
    "createdAt": "2026-06-01T00:00:00.000Z",
    "updatedAt": "2026-06-01T00:00:00.000Z"
  }
}
```

### `PATCH /organizations/me` request

```json
{
  "name": "Green Valley Fresh Foods",
  "timezoneDefault": "America/Los_Angeles",
  "uomDefault": "kg"
}
```

Response: same shape as `GET`, with updated `updatedAt`.

### Audit rows produced

| Action | `action` value | `entity_type` | Citation |
|---|---|---|---|
| Organization update | `organization.update` | `organization` | `organizations` controller/service audit call |
| User invite | `user.invite` | `user` | `users.service.js` audit call |
| User role update | `user.update` | `user` | `users.service.js` audit call |

Exact action strings must be confirmed in the running audit log. The migration comment lists `lot.void` and `user.invite` as examples (`...010:11`). `[VERIFIED-CODE]` for the write calls; `[UNVERIFIED-RUNTIME]` for exact strings shown in the UI.

---

## 8. Cleanup and reset

- Do not delete organizations through the API; no delete route exists.
- To reset, roll back all migrations and reseed (`00_README_INDEX.md` §7).
- If you only need to undo a settings change, `PATCH` the original values back. The audit trail keeps both entries, which is useful for audit tests.
