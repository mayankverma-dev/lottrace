# 02 — Field Registry

> Every table and column in the current migration set, with API field mapping, type, nullability, default, enforced constraints, and citation.
> “API field” means the camelCase name used in requests or responses. `—` means the column is never exposed by any current API.
> Nullability and defaults are taken from the migration, not from documentation.

---

## 1. `organizations`

Migration: `backend/src/db/migrations/20240101000001_create_organizations.js`.
API shape: `GET /organizations/me`, `PATCH /organizations/me` (`backend/src/modules/organizations/organizations.service.js`).

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...001:7` |
| `name` | `name` | text | no | — | PATCH: min 1, max 100 | `...001:8`; `organizations.validation.js:4` |
| `slug` | `slug` | text | no | — | Global unique; generated as slugified name + 8 hex chars | `...001:9`; `auth.service.js:196-205` |
| `industry_vertical` | `industryVertical` | text | no | `food` | No API writes it | `...001:10` |
| `plan_tier` | `planTier` | text | no | `starter` | No API writes it; no enum check | `...001:11` |
| `status` | `status` | text | no | `active` | No enum check; no API writes it | `...001:12` |
| `timezone_default` | `timezoneDefault` | text | no | `UTC` | PATCH: min 1, max 50; UI offers 9 values | `...001:13`; `organizations.validation.js:5`; `OrganizationPage.jsx:23-26` |
| `uom_default` | `uomDefault` | text | no | `kg` | PATCH: min 1, max 20; UI offers 7 values | `...001:14`; `organizations.validation.js:6`; `OrganizationPage.jsx:27-31` |
| `custom_settings` | `customSettings` | jsonb | no | `{}` | PATCH: any object; no key validation | `...001:15`; `organizations.validation.js:7` |
| `stripe_customer_id` | — | text | yes | — | Never written or read by current code | `...001:16` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | Read-only | `...001:17` |
| `updated_at` | `updatedAt` | timestamptz | no | `now()` | Updated by PATCH | `...001:18`; `organizations.service.js:53-78` |

Indexes: `idx_organizations_status` (`...001:20`).

Response-only derived fields: none. The service returns all columns mapped to camelCase, including `stripeCustomerId` (`organizations.service.js:5-19`) `[VERIFIED-CODE]`.

---

## 2. `users`

Migrations: `...002_create_users.js`, `...20260627174517_add_password_reset_to_users.js`, `...20260702172631_enforce_global_unique_email.js`, `...20260702181500_remove_email_verification.js`.
API shape: invite/update/list/get (`users.service.js:116-180,356-368`), login (`auth.service.js:139-158`).

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...002:7` |
| `organization_id` | — (derived from JWT) | uuid | no | — | FK organizations; never accepted from body | `...002:8`; `AGENTS.md` rule 9 |
| `first_name` | `firstName` | text | no | — | Invite/update: min 1, max 50 | `...002:9`; `users.validation.js:8,14` |
| `last_name` | `lastName` | text | no | — | Invite/update: min 1, max 50 | `...002:10`; `users.validation.js:9,15` |
| `email` | `email` | text | no | — | Global case-insensitive unique via `lower(email)`; Zod email; lowercased | `...002:11`; `...172631:14-16`; `users.validation.js:7` |
| `password_hash` | — | text | yes | — | Null for invited users; never returned | `...002:12`; `users.service.js:356-368` |
| `role` | `role` | text | no | — | Invite/update enum excludes `super_admin` | `...002:13`; `users.validation.js:4,10,16` |
| `status` | `status` | text | no | `invited` | `invited` / `active` / `deactivated`; no DB check | `...002:14`; `users.service.js:116-180,243-352` |
| `invite_token_hash` | — | text | yes | — | SHA-256 hash; cleared on accept | `...002:15`; `users.service.js:104-116` |
| `invite_expires_at` | — | timestamptz | yes | — | 72 hours from issue or resend | `...002:16`; `users.service.js:104-105` |
| `last_login_at` | `lastLoginAt` | timestamptz | yes | — | Updated on successful login | `...002:17`; `auth.service.js:153-158` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...002:18` |
| `updated_at` | `updatedAt` | timestamptz | no | `now()` | — | `...002:19` |
| `password_reset_token_hash` | — | text | yes | — | SHA-256 hash, 1-hour expiry | `...174517:7`; `auth.service.js:408-421` |
| `password_reset_expires_at` | — | timestamptz | yes | — | 1 hour | `...174517:8`; `auth.service.js:410` |

Removed columns (do not test as present): `email_verified`, `verification_otp`, `verification_expires_at` (`...181500:6-10`).

Indexes: `idx_users_org_status` (`...002:22`), `users_email_normalized_unique` (`...172631:14-16`). The original `idx_users_email_org` unique constraint and `idx_users_email` index are dropped (`...172631:9-12`).

---

## 3. `refresh_tokens`

Migration: `...003_create_refresh_tokens.js`. No API exposes it; cookies only.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | — | uuid | no | `gen_random_uuid()` | Primary key | `...003:7` |
| `user_id` | — | uuid | no | — | FK users, ON DELETE CASCADE | `...003:8` |
| `token_hash` | — | text | no | — | Unique | `...003:9` |
| `session_family` | — | uuid | no | — | Groups rotations of one login | `...003:10` |
| `device_hint` | — | text | yes | — | User-Agent derived `[VERIFIED-CODE]` | `...003:11`; `auth.service.js:50-60` |
| `ip_address` | — | inet | yes | — | Request IP | `...003:12` |
| `is_used` | — | boolean | no | `false` | Reuse detection | `...003:13` |
| `replaced_by_token_id` | — | uuid | yes | — | Self-FK, CASCADE | `...003:14` |
| `rotated_at` | — | timestamptz | yes | — | Set on rotation | `...003:15` |
| `replacement_token_ciphertext` | — | text | yes | — | Encrypted replacement token for retry tolerance | `...003:16` |
| `expires_at` | — | timestamptz | no | — | 7 days | `...003:17`; `auth.service.js:68-72` |
| `created_at` | — | timestamptz | no | `now()` | — | `...003:18` |

---

## 4. `locations`

Migration: `...004_create_locations.js`. API: `locations.service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key; composite unique with org | `...004:6,28` |
| `organization_id` | — | uuid | no | — | FK organizations; JWT-derived | `...004:7` |
| `name` | `name` | text | no | — | Create: min 1, max 255; duplicate rule | `...004:8`; `locations.validation.js:7`; `locations.service.js:13-31` |
| `type` | `type` | text | no | — | `farm`, `plant`, `warehouse`, `distributor`, `retailer`, `other` | `...004:9`; `locations.validation.js:4,8` |
| `is_external` | `isExternal` | boolean | no | `false` | — | `...004:10` |
| `address_line1` | `addressLine1` | text | yes | — | Max 500; duplicate differentiator | `...004:11`; `locations.validation.js:10` |
| `address_line2` | `addressLine2` | text | yes | — | Max 500 | `...004:12`; `locations.validation.js:11` |
| `city` | `city` | text | yes | — | Max 255; duplicate differentiator | `...004:13`; `locations.validation.js:12` |
| `state` | `state` | text | yes | — | Max 255 | `...004:14`; `locations.validation.js:13` |
| `postal_code` | `postalCode` | text | yes | — | Max 20 | `...004:15`; `locations.validation.js:14` |
| `country` | `country` | text | no | `US` | Max 2; no ISO validation | `...004:16`; `locations.validation.js:15` |
| `gln` | `gln` | text | yes | — | Max 13; duplicate differentiator; no checksum | `...004:17`; `locations.validation.js:16` |
| `timezone` | `timezone` | text | yes | — | Max 100; no IANA validation | `...004:18`; `locations.validation.js:17` |
| `is_active` | `isActive` | boolean | no | `true` | Deactivate route only | `...004:19`; `locations.service.js:220-250` |
| `created_by` | `createdBy` | uuid | yes | — | FK users; caller | `...004:20` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...004:21` |
| `updated_at` | `updatedAt` | timestamptz | no | `now()` | — | `...004:22` |

Indexes: `idx_locations_org`, `idx_locations_org_active` (`...004:24-25`).

---

## 5. `products`

Migration: `...005_create_products.js`. API: `products.service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key; composite unique with org | `...005:6,24` |
| `organization_id` | — | uuid | no | — | FK organizations; JWT-derived | `...005:7` |
| `name` | `name` | text | no | — | Min 1, max 255; duplicate rule | `...005:8`; `products.validation.js:14`; `products.service.js:13-27` |
| `sku` | `sku` | text | yes | — | Max 100; required to distinguish duplicate name | `...005:9`; `products.validation.js:15` |
| `gtin` | `gtin` | text | yes | — | Max 14; no checksum | `...005:10`; `products.validation.js:16` |
| `category` | `category` | text | yes | — | Max 255 | `...005:11`; `products.validation.js:17` |
| `is_ftl` | `isFtl` | boolean | no | `false` | FDA Food Traceability List flag | `...005:12` |
| `default_uom` | `defaultUom` | text | no | `kg` | Min 1, max 20 | `...005:13`; `products.validation.js:19` |
| `custom_kde_schema` | `customKdeSchema` | jsonb | no | `[]` | Array of `{name,label,type,required}`; name snake_case | `...005:14`; `products.validation.js:4-11` |
| `is_active` | `isActive` | boolean | no | `true` | No deactivate route | `...005:15` |
| `created_by` | `createdBy` | uuid | yes | — | FK users | `...005:16` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...005:17` |
| `updated_at` | `updatedAt` | timestamptz | no | `now()` | — | `...005:18` |

---

## 6. `lots`

Migration: `...006_create_lots.js`. API: `lots.service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key; composite unique with org | `...006:6,25` |
| `organization_id` | — | uuid | no | — | FK organizations; JWT-derived | `...006:7` |
| `product_id` | `productId` | uuid | no | — | Composite FK `(product_id, organization_id)`; UUID validated | `...006:8,27-29`; `lots.validation.js:5` |
| `traceability_lot_code` | `traceabilityLotCode` | text | no | — | Min 1, max 255; unique per org+product among non-void | `...006:9,33-37`; `lots.validation.js:6` |
| `quantity` | `quantity` | decimal(15,4) | no | — | Positive; coerced number | `...006:10`; `lots.validation.js:7,14` |
| `uom` | `uom` | text | no | — | Min 1, max 20 | `...006:11`; `lots.validation.js:8` |
| `status` | `status` | text | no | `active` | `active` / `recalled` / `void`; only `void` is written by API | `...006:12`; `lots.service.js:239-260` |
| `void_reason` | `voidReason` | text | yes | — | Required by void route, max 1000 | `...006:13`; `lots.validation.js:18` |
| `version` | `version` | integer | no | `1` | Optimistic concurrency; PATCH sends `version` | `...006:14`; `lots.service.js:174-187` |
| `notes` | `notes` | text | yes | — | Max 1000 | `...006:15`; `lots.validation.js:9,13` |
| `created_by` | `createdBy` | uuid | yes | — | FK users | `...006:16` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...006:17` |
| `updated_at` | `updatedAt` | timestamptz | no | `now()` | — | `...006:18` |

Indexes: `idx_lots_org`, `idx_lots_org_status`, `idx_lots_product` (`...006:20-22`), partial unique `idx_lots_tlc_org_product` (`...006:33-37`).

---

## 7. `events`

Migration: `...007_create_events.js`. API: `events.service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key; composite unique with org | `...007:6,38` |
| `organization_id` | — | uuid | no | — | FK organizations; JWT-derived | `...007:7` |
| `event_type` | `eventType` | text | no | — | `creation`, `receiving`, `transformation`, `shipping` | `...007:8`; `events.validation.js:10` |
| `location_id` | `locationId` | uuid | yes | — | Required for receiving; composite FK `(location_id, organization_id)` | `...007:9,42-44`; `events.validation.js:41-43` |
| `counterparty_info` | `counterpartyInfo` | jsonb | yes | — | Free object; no nested validation | `...007:10`; `events.validation.js:16` |
| `event_datetime` | `eventDatetime` | timestamptz | no | — | ISO-8601 datetime string | `...007:11`; `events.validation.js:12` |
| `recorded_by` | `recordedBy` | uuid | no | — | FK users; caller | `...007:12` |
| `recorded_at` | `recordedAt` | timestamptz | no | `now()` | Server time | `...007:13` |
| `source` | `source` | text | no | `manual` | `manual`, `scan`, `import`, `api` | `...007:14`; `events.validation.js:13` |
| `kde_payload` | `kdePayload` | jsonb | no | `{}` | Free object; drives compliance gaps | `...007:15`; `events.validation.js:14` |
| `compliance_gaps` | `complianceGaps` | jsonb | yes | — | `[{field,message}]`; computed `has_compliance_gaps` | `...007:16,48-52` |
| `notes` | `notes` | text | yes | — | No max in Zod | `...007:18`; `events.validation.js:15` |
| `idempotency_key` | — | text | yes | — | Unique per org; `import_<org>_<transaction>` for imports | `...007:19-22,40` |
| `record_hash` | `recordHash` | text | no | — | HMAC chain seal | `...007:23` |
| `prev_hash` | `prevHash` | text | no | — | Previous event hash or genesis | `...007:24` |
| `chain_seq` | `chainSeq` | bigint | no | — | Unique per org; check `>= 1` | `...007:25,56-62` |
| `hash_version` | `hashVersion` | smallint | no | `3` | — | `...007:26` |
| `hash_key_id` | `hashKeyId` | text | no | — | Keyring ID | `...007:27` |
| `status` | `status` | text | no | `active` | `active` / `amended` / `void` | `...007:28` |
| `supersedes_event_id` | `supersedesEventId` | uuid | yes | — | Self-FK; unique partial index (at most once) | `...007:29,66-70` |
| `status_reason` | `statusReason` | text | yes | — | Amend or void reason | `...007:30`; `events.service.js:350-420` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | No `updated_at`: immutable | `...007:31-32` |

Computed: `has_compliance_gaps` boolean generated (`...007:48-52`). API field `hasComplianceGaps` (`events.service.js` select).

Indexes: five filter+keyset indexes and `idx_events_org_datetime` (`...007:74-98`), compliance gap partial index (`...007:99-102`).

---

## 8. `event_lot_links`

Migration: `...008_create_event_lot_links.js`. API: nested `inputs`/`outputs`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...008:6` |
| `organization_id` | — | uuid | no | — | FK organizations; JWT-derived | `...008:7` |
| `event_id` | `eventId` | uuid | no | — | Composite FK `(event_id, organization_id)` | `...008:8,22-24` |
| `lot_id` | `lotId` | uuid | no | — | Composite FK `(lot_id, organization_id)` | `...008:9,25-27` |
| `direction` | `direction` | text | no | — | `input` / `output`; unique per event+lot+direction | `...008:10,31-34` |
| `quantity` | `quantity` | decimal(15,4) | yes | — | Zod positive number | `...008:11`; `events.validation.js:5` |
| `uom` | `uom` | text | yes | — | Zod min 1 | `...008:12`; `events.validation.js:6` |
| `created_at` | — | timestamptz | no | `now()` | — | `...008:13` |

---

## 9. `attachments`

Migration: `...009_create_attachments.js`. API: `events.service.js:420-500`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...009:6` |
| `organization_id` | — | uuid | no | — | FK organizations; JWT-derived | `...009:7` |
| `parent_type` | `parentType` | text | no | — | `event` / `lot`; current API uses `event` only | `...009:8` |
| `parent_id` | `parentId` | uuid | no | — | Event ID in current API | `...009:9` |
| `storage_key` | — | text | no | — | S3 object key | `...009:10` |
| `filename` | `filename` | text | no | — | Min 1, max 255 | `...009:11`; `events.validation.js:55` |
| `content_type` | `contentType` | text | no | — | Min 1, max 255; upload allow-list 5 MIME types | `...009:12`; `events.validation.js:56`; `events.service.js:23-29` |
| `size_bytes` | `sizeBytes` | bigint | yes | — | Max 50 MiB at presign | `...009:13`; `events.service.js:22` |
| `uploaded_by` | `uploadedBy` | uuid | no | — | FK users | `...009:14` |
| `status` | `status` | text | no | `pending` | Check: `pending`, `uploaded`, `deleting`, `deleted` | `...009:15,21` |
| `uploaded_at` | `uploadedAt` | timestamptz | yes | — | — | `...009:16` |
| `deleted_at` | `deletedAt` | timestamptz | yes | — | Soft delete | `...009:17` |
| `deleted_by` | `deletedBy` | uuid | yes | — | FK users | `...009:18` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...009:19` |

---

## 10. `audit_log`

Migration: `...010_create_audit_log.js`. API: `GET /audit`, audit export.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...010:6` |
| `organization_id` | `organizationId` | uuid | yes | — | Null for platform actions | `...010:7` |
| `actor_id` | `actorId` | uuid | yes | — | Null for API key/system | `...010:8` |
| `actor_type` | `actorType` | text | no | `user` | `user`, `api_key`, `system`, `super_admin`; no check | `...010:9` |
| `actor_label` | `actorLabel` | text | yes | — | Email or key label | `...010:10` |
| `action` | `action` | text | no | — | Dotted action name | `...010:11` |
| `entity_type` | `entityType` | text | yes | — | Free text | `...010:12` |
| `entity_id` | `entityId` | uuid | yes | — | — | `...010:13` |
| `before_state` | `beforeState` | jsonb | yes | — | Redacted of password fields | `...010:14`; `audit.service.js:13-31` |
| `after_state` | `afterState` | jsonb | yes | — | Redacted | `...010:15` |
| `metadata` | `metadata` | jsonb | yes | — | Free object | `...010:16` |
| `ip_address` | `ipAddress` | inet | yes | — | — | `...010:17` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | Append-only, no `updated_at` | `...010:18-19` |

Indexes: `idx_audit_org`, `idx_audit_actor`, `idx_audit_org_created`, `idx_audit_entity` (`...010:21-31`).

---

## 11. `imports`

Migration: `...011_create_imports.js`. API: `imports.service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...011:7` |
| `organization_id` | — | uuid | no | — | FK organizations, CASCADE; JWT-derived | `...011:8` |
| `filename` | `filename` | text | no | — | Uploaded filename | `...011:9`; `imports/routes.js:13-27` |
| `storage_key` | `storageKey` | text | no | — | S3 key | `...011:10` |
| `cte_type` | `cteType` | text | no | — | `creation`, `receiving`, `transformation`, `shipping` | `...011:11`; `imports/validation.js:4-8` |
| `status` | `status` | text | no | `pending` | Five values; SQL comment lists four | `...011:12`; `imports/validation.js:12`; `import-processor.js:227-233` |
| `total_rows` | `totalRows` | integer | yes | — | Set by worker | `...011:13` |
| `valid_rows` | `validRows` | integer | yes | — | Set by worker | `...011:14` |
| `error_rows` | `errorRows` | integer | yes | — | Set by worker | `...011:15` |
| `error_report_key` | `errorReportKey` | text | yes | — | S3 CSV key | `...011:16` |
| `job_id` | `jobId` | text | yes | — | BullMQ job ID | `...011:17` |
| `created_by` | `createdBy` | uuid | no | — | FK users | `...011:18` |
| `started_at` | `startedAt` | timestamptz | yes | — | — | `...011:19` |
| `completed_at` | `completedAt` | timestamptz | yes | — | — | `...011:20` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...011:21` |

---

## 12. `recall_simulations`

Migration: `...012_create_recall_simulations.js`. API: `recall/service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...012:7` |
| `organization_id` | — | uuid | no | — | FK organizations, CASCADE | `...012:8` |
| `name` | `name` | text | no | — | Min 1, max 255 | `...012:9`; `recall/validation.js:5` |
| `triggering_lot_id` | `triggeringLotId` | uuid | no | — | FK lots; UUID validated | `...012:10`; `recall/validation.js:6` |
| `params` | `params` | jsonb | no | `{}` | Free object | `...012:11`; `recall/validation.js:7` |
| `result_summary` | `resultSummary` | jsonb | yes | — | Trace summary | `...012:12` |
| `result_storage_key` | `resultStorageKey` | text | yes | — | Reserved; no worker writes it | `...012:13` |
| `status` | `status` | text | no | `pending` | `pending`/`running`/`complete`/`failed`; synchronous, so `pending`/`running` transient | `...012:14`; `recall/service.js:6-58` |
| `run_by` | `runBy` | uuid | no | — | FK users | `...012:15` |
| `run_at` | `runAt` | timestamptz | no | `now()` | — | `...012:16` |
| `completed_at` | `completedAt` | timestamptz | yes | — | — | `...012:17` |

---

## 13. `notifications`

Migration: `...015_create_notifications.js`. API: `notifications.service.js`.

| Column | API field | Type | Null | Default | Constraint / rule | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...015:7` |
| `organization_id` | — | uuid | no | — | FK organizations, CASCADE | `...015:8` |
| `user_id` | `userId` | uuid | yes | — | Null = org-wide | `...015:9` |
| `type` | `type` | text | no | — | Four intended values; no check | `...015:10` |
| `title` | `title` | text | no | — | — | `...015:11` |
| `message` | `message` | text | no | — | — | `...015:12` |
| `link` | `link` | text | yes | — | In-app deep link | `...015:13` |
| `entity_type` | `entityType` | text | yes | — | — | `...015:14` |
| `entity_id` | `entityId` | uuid | yes | — | — | `...015:15` |
| `is_read` | `isRead` | boolean | no | `false` | Mark read routes | `...015:16`; `notifications.service.js` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...015:17` |

---

## 14. `idempotency_keys`

Migration: `...017_create_idempotency_keys.js`. Middleware only; no API.

| Column | Type | Null | Default | Constraint | Citation |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Primary key | `...017:15` |
| `key` | text | no | — | Length 1–255; unique per org | `...017:16,24,28-31` |
| `organization_id` | uuid | no | — | FK organizations, CASCADE | `...017:17` |
| `request_hash` | text | no | — | SHA-256 of method+route+canonical body | `...017:18` |
| `response_status` | integer | yes | — | Null or 2xx only | `...017:19,32-37` |
| `response_body` | jsonb | yes | — | Stored replay body | `...017:20` |
| `expires_at` | timestamptz | no | — | TTL enforced by maintenance | `...017:21` |
| `created_at` | timestamptz | no | `now()` | — | `...017:22` |

---

## 15. `event_evidence`

Migration: `...019_create_event_evidence.js`. API: internal only; not exposed.

| Column | Type | Null | Default | Constraint | Citation |
|---|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Primary key | `...019:12` |
| `organization_id` | uuid | no | — | FK organizations | `...019:13` |
| `event_id` | uuid | no | — | FK events | `...019:14` |
| `seq` | integer | no | — | Unique per event, `>= 1` | `...019:15,24,28-31` |
| `kind` | text | no | — | `status_change` / `attachment_added` | `...019:16` |
| `payload` | jsonb | no | — | Signed change payload | `...019:17` |
| `record_hash` | text | no | — | HMAC | `...019:18` |
| `prev_hash` | text | no | — | Chain to event hash or prior evidence | `...019:19` |
| `hash_version` | smallint | no | `3` | — | `...019:20` |
| `hash_key_id` | text | no | — | — | `...019:21` |
| `created_at` | timestamptz | no | `now()` | Append-only trigger | `...019:22,39-68` |

---

## 16. `report_exports`

Migration: `...020_create_report_exports.js`. API: `reports.service.js`.

| Column | API field | Type | Null | Default | Constraint | Citation |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | no | `gen_random_uuid()` | Primary key | `...020:11` |
| `organization_id` | — | uuid | no | — | FK organizations, CASCADE; RLS | `...020:12,40-46` |
| `requested_by` | `requestedBy` | uuid | no | — | FK users | `...020:13` |
| `type` | `type` | text | no | `events` | Check: `events` / `audit` | `...020:14,29` |
| `format` | `format` | text | no | — | Check: `csv` / `json` | `...020:15,30` |
| `status` | `status` | text | no | `queued` | Check: `queued`/`processing`/`complete`/`failed` | `...020:16,32-36` |
| `storage_key` | `storageKey` | text | yes | — | S3 key | `...020:17` |
| `row_count` | `rowCount` | integer | yes | — | Null or `>= 0` | `...020:18,37` |
| `filters` | `filters` | jsonb | no | `{}` | Must be JSON object | `...020:19,31` |
| `error` | `error` | text | yes | — | Failure message | `...020:20` |
| `error_code` | `errorCode` | text | yes | — | `EXPORT_LIMIT_EXCEEDED` when over limit | `...020:21`; `export-format.js:10` |
| `created_at` | `createdAt` | timestamptz | no | `now()` | — | `...020:22` |
| `started_at` | `startedAt` | timestamptz | yes | — | — | `...020:23` |
| `completed_at` | `completedAt` | timestamptz | yes | — | — | `...020:24` |

---

## 17. Schema-only tables

These tables exist and are protected by RLS, but no route, service, worker, or UI reads or writes them.

### `api_keys`

| Column | Type | Null | Default | Citation |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | `...013:7` |
| `organization_id` | uuid | no | — | `...013:8` |
| `label` | text | no | — | `...013:9` |
| `key_prefix` | text | no | — | `...013:10` |
| `key_hash` | text | no | — | `...013:11` |
| `scopes` | text[] | no | `{}` | `...013:12` |
| `last_used_at` | timestamptz | yes | — | `...013:13` |
| `revoked_at` | timestamptz | yes | — | `...013:14` |
| `created_by` | uuid | no | — | `...013:15` |
| `created_at` | timestamptz | no | `now()` | `...013:16` |

Unique `key_hash` (`...013:18`). RLS: `add_rls_policies.js:10`.

### `webhooks`

| Column | Type | Null | Default | Citation |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | `...014:7` |
| `organization_id` | uuid | no | — | `...014:8` |
| `url` | text | no | — | `...014:9` |
| `subscribed_events` | text[] | no | `{}` | `...014:10` |
| `secret_hash` | text | no | — | `...014:11` |
| `status` | text | no | `active` | `...014:12` |
| `failure_count` | integer | no | `0` | `...014:13` |
| `last_triggered_at` | timestamptz | yes | — | `...014:14` |
| `last_success_at` | timestamptz | yes | — | `...014:15` |
| `created_by` | uuid | no | — | `...014:16` |
| `created_at` | timestamptz | no | `now()` | `...014:17` |
| `updated_at` | timestamptz | no | `now()` | `...014:18` |

RLS: `add_rls_policies.js:11`.

---

## 18. API-only fields with no database column

| Field | Where | Meaning | Citation |
|---|---|---|---|
| `inputs[]` / `outputs[]` | `POST /events`, amend | Expanded into `event_lot_links`; shape depends on `eventType` | `events.validation.js:17-44`; `events.service.js:60-120` |
| `amendReason` | `POST /events/:id/amend` | Stored in `events.status_reason` of the replacement | `events.validation.js:46-48`; `events.service.js:350-390` |
| `voidReason` | `POST /events/:id/void` | Stored in `events.status_reason` of the target | `events.validation.js:50-52` |
| `page`, `limit` | Most list endpoints | Page-based pagination | `utils/pagination.js` |
| `cursor` | `GET /events` | Keyset cursor, base64url of `(created_at, chain_seq)` | `utils/cursor.js`; `events.service.js:258-270` |
| `version` | `PATCH /lots/:id` | Required optimistic concurrency token | `lots.service.js:174-187` |
| `Idempotency-Key` header | Event and attachment mutations | Replay protection | `middleware/idempotency.js`; `...017:28-37` |

---

## 19. Field-count summary

| Table | Columns | Exposed by API | Internal only |
|---|---|---|---|
| `organizations` | 12 | 10 | `stripe_customer_id`, `slug` (read-only) |
| `users` | 18 | 9 | password, invite, reset columns |
| `refresh_tokens` | 12 | 0 | all |
| `locations` | 16 | 15 | `organization_id` |
| `products` | 13 | 12 | `organization_id` |
| `lots` | 15 | 11 | `organization_id`, `version` (request-only) |
| `events` | 22 | 18 | `organization_id`, `idempotency_key` |
| `event_lot_links` | 8 | 5 (nested) | `organization_id`, `id`, `created_at` |
| `attachments` | 14 | 9 | `storage_key`, `organization_id` |
| `audit_log` | 13 | 12 | none |
| `imports` | 14 | 12 | `organization_id`, `storage_key` |
| `recall_simulations` | 10 | 8 | `organization_id`, `result_storage_key` |
| `notifications` | 9 | 8 | `organization_id` |
| `idempotency_keys` | 8 | 0 | all |
| `event_evidence` | 9 | 0 | all |
| `report_exports` | 13 | 11 | `organization_id` |
| `api_keys` | 10 | 0 | all |
| `webhooks` | 12 | 0 | all |

Total: 18 tables, 228 columns. Counts include columns that are never serialized. Re-verify with `\d+ <table>` if a migration changes.
