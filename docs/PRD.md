# LotTrace — Product Requirements Document

**Subtitle:** A multi-tenant supply chain traceability & audit-trail platform for regulated goods (v1 focus: food & CPG manufacturers/processors subject to FDA FSMA 204)

**Version:** 1.0 (Draft)
**Date:** June 20, 2026
**Stack:** Node.js + Express (API) · React (web app + scanning PWA) · PostgreSQL

---

## 0. How to Use This Document

This PRD defines **what** to build, **why**, and the business rules/edge cases engineering must handle. It intentionally stops short of:
- Full API request/response contracts (JSON schemas) — a companion **API Spec** doc
- Database migration scripts / exact column types — a companion **Technical Design Doc**
- Pixel-level UI mockups — companion **wireframes**

These can be produced as follow-on deliverables once this PRD is approved.

**Important caveat on compliance content:** sections referencing FDA FSMA 204 (Critical Tracking Events, Key Data Elements, retention periods, recordkeeping roles) describe the *general shape* of the rule to inform the data model. They are not a substitute for reading the current Food Traceability Final Rule text and Food Traceability List directly, or legal/compliance review, before telling a customer the product makes them "compliant." Treat Appendix A as a draft mapping to validate, not a legal source.

---

## 1. Overview

### 1.1 Problem
Small and mid-size food manufacturers, processors, distributors, and co-packers handling foods on the FDA's Food Traceability List currently track lot-level data in spreadsheets, paper logs, or fragmented systems. This makes it slow and error-prone to answer the two questions that matter most during a contamination event: *"Where did this lot come from?"* and *"Everywhere did it go?"* Enterprise traceability platforms exist but are priced and scoped for large manufacturers, leaving smaller operations underserved.

### 1.2 Vision
LotTrace is a SaaS platform that lets a food business capture lot-level events (receiving, transformation, shipping, creation) through fast scanning or simple forms, and instantly trace any lot forward or backward through the supply chain — turning a multi-day manual recall investigation into a query that takes seconds.

### 1.3 Target Customer (v1)
Single-to-multi-location food manufacturers, processors, and co-packers with 1–50 locations, currently using spreadsheets/paper, who handle one or more items on the FDA Food Traceability List.

### 1.4 Why Now
FDA pushed the FSMA 204 compliance deadline from January 2026 to July 20, 2028, removing immediate panic-buying urgency but giving forward-looking businesses a multi-year runway to replace ad hoc systems before enforcement begins — a calmer, more rational buying window than a deadline-driven scramble.

---

## 2. Goals & Success Metrics

### 2.1 Business Goals
- Acquire first 10 paying customers within 6 months of MVP launch
- Prove a repeatable sales motion before investing in deeper integrations
- Build a defensible data model that extends to adjacent verticals (pharma DSCSA, cosmetics, supplements) later

### 2.2 Product Goals
- Make event capture fast enough that floor staff actually use it instead of reverting to paper
- Make a "mock recall" / trace query return useful results in seconds, not hours
- Produce compliance-ready reports a QA manager can hand to an auditor without manual cleanup

### 2.3 Success Metrics

| Metric | Target (90 days post-launch) |
|---|---|
| Time to record one event (scan to saved) | < 15 seconds |
| Time to run a full forward+backward trace | < 3 seconds for lots with ≤ 10,000 linked events |
| % of events captured via scan vs. manual entry | > 60% |
| Customer-reported data-entry errors caught | Trending down month over month |
| Paying customers | 10+ |
| Logo churn | < 5%/month |

---

## 3. Glossary

| Term | Meaning |
|---|---|
| CTE | Critical Tracking Event — a supply chain step that must be recorded (receiving, transformation, shipping, creation) |
| KDE | Key Data Element — the specific data fields required for a given CTE |
| TLC | Traceability Lot Code — the unique code identifying a lot |
| FTL | Food Traceability List — FDA's list of foods subject to FSMA 204 |
| GTIN | Global Trade Item Number — GS1 standard product identifier |
| GLN | Global Location Number — GS1 standard location identifier |
| One-up-one-down | Each entity must identify the immediate source and immediate recipient of a lot, even without visibility into the whole chain |
| Forward trace | Given a lot, find everywhere it (or anything derived from it) went |
| Backward trace | Given a lot, find everywhere its inputs came from |
| Mock recall / recall simulation | A trace run as if a real contamination event occurred, to test recall readiness |
| Tenant | One customer organization in the multi-tenant system |

---

## 4. Users, Roles & Permissions

### 4.1 Personas
- **Org Admin** — sets up the account, manages users/locations/products. Cares about onboarding speed and not breaking anything.
- **QA / Compliance Manager** — runs trace queries, mock recalls, pulls compliance reports for audits. Cares about completeness and defensibility of records.
- **Floor/Warehouse Staff (Operator)** — scans barcodes during receiving, production, shipping. Cares about speed.
- **Auditor (read-only)** — internal QA or external auditor invited temporarily. Views records/reports, edits nothing.
- **API/Integration identity** — non-human actor authenticating via API key.
- **Platform Super Admin** (your team) — manages tenants, billing, support, platform health; not part of any customer org.

### 4.2 Roles (v1)
1. Org Admin
2. Compliance Manager
3. Operator
4. Auditor (read-only)
5. API/Integration (scoped, non-interactive)
6. Super Admin (platform-level, separate from tenant roles)

### 4.3 Permission Matrix

| Action | Org Admin | Compliance Mgr | Operator | Auditor | API Key |
|---|---|---|---|---|---|
| Manage org settings/billing | ✅ | ❌ | ❌ | ❌ | ❌ |
| Invite/manage users & roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage locations | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage products | ✅ | ✅ | ❌ | ❌ | Scoped |
| Create/edit lots | ✅ | ✅ | ✅ | ❌ | Scoped |
| Record events (scan/manual) | ✅ | ✅ | ✅ | ❌ | Scoped |
| Void/amend an event | ✅ | ✅ | ❌ | ❌ | ❌ |
| Bulk import | ✅ | ✅ | ❌ | ❌ | ❌ |
| Run trace / recall simulation | ✅ | ✅ | ❌ | View-only | ❌ |
| Export compliance reports | ✅ | ✅ | ❌ | ✅ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ✅ | ❌ |
| Manage API keys/webhooks | ✅ | ❌ | ❌ | ❌ | ❌ |

Every permission check is enforced **server-side**, on every endpoint — never inferred from what the UI happens to show.

---

## 5. Scope

### 5.1 In Scope (v1)
- Multi-tenant org/user/role management
- Locations, products, lots
- Event capture for 4 CTEs: Creation, Receiving, Transformation, Shipping
- Manual entry forms + browser-based barcode/QR scanning (PWA, no native app)
- CSV bulk import
- Forward & backward trace queries
- Recall simulation report
- Compliance export (CSV/PDF of CTE/KDE records)
- Append-only audit log with tamper-evidence (hash chain)
- Basic dashboard (lots, events, open compliance gaps)
- Email notifications for compliance gaps

### 5.2 Out of Scope (v1) — explicitly deferred
- Native mobile apps (PWA only at v1)
- IoT/sensor/cold-chain temperature integration
- GS1 EPCIS-format export
- Pre-built ERP connectors (CSV/API only at v1)
- Offline-first scanning with conflict-resolution sync (assume connectivity at v1; revisit for Phase 3 — warehouse WiFi is a real risk)
- Multi-language UI
- Blockchain-based storage
- Automated regulatory filing (the product produces records a human uses/submits — it does not file anything with FDA directly)

### 5.3 Assumptions
- Customers have smartphones/tablets with cameras for scanning
- Customers can export at least a CSV from whatever system they use today, for onboarding
- v1 targets the U.S. FSMA 204 framework; international variants are a later-phase exercise

---

## 6. System Architecture

### 6.1 High-Level Architecture

```
[React Web App]        [React PWA - Scanning]
        \\                      /
         \\                    /
        [Express REST API] ---- [Redis: cache, queues, rate limit]
                |
        [PostgreSQL: primary data store]
                |
        [Background Workers: BullMQ - imports, exports, hash-chain jobs]
                |
        [Object storage: file uploads, generated reports]
```

### 6.2 Tech Stack & Key Libraries

| Layer | Choice | Notes |
|---|---|---|
| API runtime | Node.js (LTS) + Express | REST, versioned under `/api/v1` |
| Validation | Zod (or Joi) | Validate every request body/query param server-side |
| ORM/Query | Prisma or Knex | Prisma for dev speed + migrations; Knex if you want tighter SQL control for recursive trace queries |
| Database | PostgreSQL | JSONB for flexible KDE payloads; recursive CTEs for trace queries |
| Auth | JWT (access + refresh tokens) | Short-lived access token (~15 min), rotating refresh, httpOnly cookie for web, bearer header for API |
| Password hashing | argon2 (preferred) or bcrypt | Never roll your own |
| Background jobs | BullMQ + Redis | Bulk import, PDF/CSV generation, hash-chain verification |
| File storage | S3-compatible (AWS S3 / Backblaze B2) | Signed URLs; never serve files directly through the API process |
| Frontend (web) | React + Vite + TypeScript | TanStack Query for server state, React Router |
| Frontend (scanning PWA) | React + @zxing/library or BarcodeDetector API | Service worker for installability; camera-based, no special hardware |
| Styling | Tailwind | Fast, consistent |
| Charts | Recharts | Dashboard visuals |
| Testing | Jest + Supertest (API), Playwright (e2e) | |
| Logging | pino | Structured JSON logs |
| Error tracking | Sentry | |
| CI/CD | GitHub Actions | Lint → test → build → deploy |

### 6.3 Multi-Tenancy
- Shared database, shared schema, `organization_id` column on every tenant-scoped table.
- Every query filters by `organization_id` derived from the authenticated session/token — **never** from a client-supplied field.
- Automated tests must assert that a user from Org 1 cannot read/write Org 2's data, including via IDs guessed in URLs (insecure direct object reference).
- Consider Postgres Row-Level Security (RLS) as a second enforcement layer beneath application checks, so an application-code bug can't silently leak cross-tenant data.

### 6.4 Environments
Local → Staging (mirrors prod, used for UAT/demos) → Production. Separate databases per environment; staging seeded with synthetic data only.

---

## 7. Data Model (Conceptual)

| Entity | Key Fields | Notes |
|---|---|---|
| `organizations` | id, name, industry_vertical, plan_tier, status, created_at | The tenant |
| `users` | id, org_id, name, email, password_hash, role_id, status, last_login_at | |
| `roles` | id, org_id (nullable for system roles), name, permissions | |
| `locations` | id, org_id, name, type, address, gln, timezone | type: farm/plant/warehouse/distributor/retailer/other |
| `products` | id, org_id, name, gtin, category, is_ftl, default_uom, custom_kde_schema (jsonb) | `custom_kde_schema` lets a tenant add fields without a migration |
| `lots` | id, org_id, product_id, traceability_lot_code, quantity, uom, status, created_at | status: active/recalled/void |
| `events` | id, org_id, event_type, location_id, counterparty_info (jsonb), event_datetime, recorded_by, recorded_at, kde_payload (jsonb), record_hash, prev_hash, status, supersedes_event_id, status_reason | Core append-only table |
| `event_lot_links` | id, event_id, lot_id, direction (input/output), quantity, uom | Enables many-to-many lot transformations |
| `attachments` | id, parent_type, parent_id, file_url, uploaded_by, uploaded_at | COAs, photos, BOLs |
| `audit_log` | id, org_id, actor_user_id, action, entity_type, entity_id, before, after, ip_address, timestamp | Logs *system actions*; `events` logs *supply chain facts* |
| `imports` | id, org_id, filename, status, row_count, error_count, error_report_url, created_by | Bulk import job tracking |
| `api_keys` | id, org_id, key_hash, label, scopes, last_used_at, revoked_at | |
| `webhooks` | id, org_id, url, subscribed_events, secret, status | |
| `notifications` | id, org_id, user_id, type, message, read_status, created_at | |
| `recall_simulations` | id, org_id, triggering_lot_id, params, result_summary, run_by, run_at | Stored for audit review of past mock recalls |
| `subscriptions` | id, org_id, plan, stripe_customer_id, status, current_period_end | |

**Relationship notes**
- A lot can have many input and output events (e.g., received once, shipped in three partial shipments → three `event_lot_links` rows).
- A transformation event links N input lots to M output lots via `event_lot_links` — this is what makes "which finished products did this ingredient end up in" answerable.
- `events` is **append-only**: no UPDATE/DELETE in application code. Corrections create a new event with `supersedes_event_id`, and the original gets `status = 'amended'` rather than being deleted.

---

## 8. Functional Requirements

*(Format per module: Purpose → Features → Business Rules → Edge Cases)*

### 8.1 Authentication & Account Management
**Purpose:** Secure login/session handling for all human users.
**Features**
- Email + password signup/login
- Password reset via emailed time-limited token
- JWT access token + rotating refresh token
- Session/device list with ability to revoke a session
- Optional 2FA (TOTP) — recommended default-on for Org Admin/Compliance Manager in v1.1

**Business Rules**
- Passwords: minimum length + breached-password check, rather than arbitrary complexity rules
- Refresh tokens are single-use and rotate on every refresh (detect replay)
- Lockout after N failed attempts with exponential backoff, not a permanent lock

**Edge Cases**
- Expired/already-used password reset link → clear, non-leaky error, never a message that confirms/denies account existence
- Refresh token reused after rotation (theft signal) → invalidate the entire session family, force re-login, flag for review
- User deactivated mid-session → next API call must reject the still-valid access token (check user status per-request, not just at login)
- Email already registered under a different org → no silent account merging; require an explicit invite-acceptance flow
- Concurrent login from two devices → allowed by default, both shown in session list

### 8.2 Organization (Tenant) Management & Onboarding
**Purpose:** Set up a new customer account and its core reference data.
**Features**
- Org signup with company info, primary contact, industry vertical
- Guided onboarding checklist: add first location → add first product → invite a teammate → record first event
- Org-level settings: timezone default, units of measure default, custom KDE fields per product type

**Business Rules**
- One org can never enumerate or detect another org's existence via the API
- Org deletion is a soft-delete (status = suspended/closed) with data retained per policy, not a hard delete, given the audit-trail nature of the product

**Edge Cases**
- Org cancels subscription with open compliance obligations → data export must remain available for a defined grace period before any deletion
- Org adds a non-food product line after setup → custom KDE schema must support per-product overrides, not one org-wide template

### 8.3 User & Role Management
**Purpose:** Invite, manage, and permission teammates.
**Features**
- Invite by email with role pre-assigned
- Edit/deactivate users
- Assign a system role (v2: custom roles with granular permission toggles)

**Business Rules**
- The last remaining Org Admin cannot self-deactivate/self-demote (prevents account lockout)
- Role changes apply immediately, not at next login (must invalidate cached permission checks)

**Edge Cases**
- Deactivated user has historical events attributed to them → those events keep showing the user's identity in the audit trail; never cascade-delete or anonymize a deactivated user's historical attribution
- Invite sent to an email that independently signs up as its own org → invite token binds to email + org; fresh signup shouldn't silently consume an unrelated pending invite

### 8.4 Location Management
**Purpose:** Represent every physical place where events happen, including external partners.
**Features**
- CRUD for the org's own locations
- Lightweight "external partner" location records (name + address, no login) since most counterparties won't be LotTrace users
- Optional GLN field

**Business Rules**
- Timezone stored explicitly per location; event timestamps stored in UTC but displayed/entered in local time, since "what day did this happen" matters for compliance

**Edge Cases**
- Same physical address used by two different counterparties at different times (e.g., a shared 3PL warehouse) → location records are keyed by org_id + identifying fields, never assumed globally unique by address alone
- Location closes/relocates → mark inactive, never delete, so historical events still resolve to a real record

### 8.5 Product Management
**Purpose:** Define what's being tracked.
**Features**
- CRUD for products: name, GTIN (optional), category, default unit of measure
- Flag whether a product is on the Food Traceability List
- Custom field schema per product

**Business Rules**
- `is_ftl = true` requires full KDE capture on every event; non-FTL products can use a lighter capture flow

**Edge Cases**
- Product reformulated under the same name → treat as a new product version, don't overwrite, since historical lots reference the old formulation
- GTIN entered with a check-digit error → validate format and reject/warn rather than silently accepting a malformed code

### 8.6 Lot / Batch Management
**Purpose:** The central unit being traced.
**Features**
- Create a lot manually or automatically via a "Creation" event
- Lot status: active / recalled / void
- Full event-history timeline per lot

**Business Rules**
- TLC uniqueness is scoped per org + product, not globally unique
- A lot is never hard-deleted once it has any linked event — only voided with a reason

**Edge Cases**
- TLC collision (same code reused after time has passed) → warn on creation, require explicit confirmation, keep both records distinguishable by creation date
- Quantity discrepancy: sum of outputs exceeds the recorded lot quantity → flag as a data-integrity warning rather than silently allowing it
- Two lots physically combined into one → model as a Transformation event with two inputs and one output, not as editing one lot to "become" the other

### 8.7 Event Capture (Critical Tracking Events)
**Purpose:** Record the four core CTEs with their required KDEs.
**Features**
- **Creation:** output lot(s), location, date, quantity
- **Receiving:** input lot(s) or new external lot reference, source location/counterparty, receiving location, date, quantity
- **Transformation:** N input lots → M output lots, with per-link quantities
- **Shipping:** lot(s), destination location/counterparty, date, quantity
- Free-text notes + file attachment (photo, COA, BOL) on any event

**Business Rules**
- Required KDE fields per CTE follow the product's `is_ftl` flag and the org's custom schema
- Events are immutable once saved; "editing" creates a superseding event, marking the original `amended`

**Edge Cases**
- Transformation with normal process loss/waste → allow an explicit loss/waste quantity field rather than forcing inputs to mathematically equal outputs
- Receiving from a non-LotTrace supplier → capture supplier-provided lot code/info as-is; you can't enforce a third party's data quality
- Backdated entry → store distinct `event_datetime` (when it happened) vs. `recorded_at` (when entered), both visible
- One physical delivery needs splitting into two records (e.g., two POs) → support multiple events per delivery rather than forcing one record to cover unrelated POs

### 8.8 Barcode/QR Scanning (PWA)
**Purpose:** Make event capture fast on the floor.
**Features**
- Browser-based camera scanning (no native app install)
- Scan a lot code → pull up record → attach to a new event in 1–2 taps
- Bulk scan mode for sequential receiving
- Parse GS1-128/Data Matrix structured codes where present; fall back to raw code capture otherwise

**Business Rules**
- A scanned code matching no known lot prompts "create new lot from this code" rather than failing silently

**Edge Cases**
- Duplicate scan of the same code in one session → debounce/detect immediate duplicates, ask for confirmation rather than creating two events
- Unreadable/damaged barcode → manual code entry always available, never scan-only
- Camera permission denied → clear in-app guidance, not a silent dead end
- Device clock skew → server timestamps `recorded_at` itself; client can separately submit a known "this happened at" time

### 8.9 Manual Data Entry
**Purpose:** Fallback/primary path for office staff or paper-based operations.
**Features**
- Form-based entry mirroring the scan flow's data requirements
- Autocomplete/lookup for existing lots, products, locations

**Edge Cases**
- Quantity entered in the wrong unit (e.g., typed assuming kg when field defaults to lb) → show the unit explicitly next to every quantity field, never assume

### 8.10 Bulk Import (CSV/Excel)
**Purpose:** Onboarding and ongoing import for customers who keep records elsewhere.
**Features**
- Downloadable CSV template per CTE type
- Upload → server-side validation → row-level error report before committing anything
- Async processing via background job, notification on completion

**Business Rules**
- Per-row commit, not per-file: valid rows commit, invalid rows are rejected with specific reasons
- Imports are tagged `source = 'import'` for auditability

**Edge Cases**
- Re-upload with overlapping rows → detect likely duplicates (lot code + event type + date + location) and flag for review, don't silently duplicate
- Very large file (e.g., 500k rows) → chunked/streamed processing via background worker, never loaded fully into request memory
- Inconsistent date formats/encoding → reject with a specific, row-numbered error; never guess silently

### 8.11 Trace Engine (Forward & Backward)
**Purpose:** Answer "where did this go" and "where did this come from."
**Features**
- Recursive traversal of `event_lot_links` to build forward tree (everything this lot became) and backward tree (everything that went into it)
- Visual + tabular results, with hop count shown
- Exportable trace result

**Business Rules**
- Tracing must correctly follow transformation links in both directions (A+B → C means forward(A) reaches C, and backward(C) reaches both A and B)

**Edge Cases**
- Very deep/wide trace trees → paginate rendering, but never silently truncate the underlying compliance answer ("47 of 312, view all")
- Defensive cycle protection in the recursive query, even though physical chains shouldn't loop, to guard against a bad data entry creating a self-referencing lot
- Voided/amended events in the chain → trace results must clarify whether superseded data is included, since an auditor may need both views

### 8.12 Recall Simulation
**Purpose:** Let a customer rehearse and demonstrate recall-readiness.
**Features**
- Select a lot (or product + date range) as "affected"
- Run a full forward trace → "affected lots/customers/locations" report
- Save simulations with timestamp/parameters as evidence of recall-readiness testing

**Edge Cases**
- Simulation against a lot with incomplete upstream data → explicitly flag "unknown/incomplete" branches rather than presenting an artificially complete-looking result

### 8.13 Compliance Reporting & Export
**Purpose:** Produce the records an auditor would request.
**Features**
- CTE/KDE log export (CSV/PDF) by date range, product, or lot
- "Compliance gap" report highlighting records missing required KDE fields

**Edge Cases**
- Large export requests → background job + download link/email, never a blocking request
- Amendments must show correctly — the *current* authoritative version drives the compliance summary, without erasing the fact a correction occurred

### 8.14 Audit Log & Data Integrity
**Purpose:** Prove the system's own records haven't been tampered with.
**Features**
- Each event stores a hash of (its content + previous event's hash) — a per-org hash chain
- A verification job/endpoint that re-walks the chain and confirms no out-of-band alteration
- Separate `audit_log` capturing sensitive reads (exports), not just writes

**Edge Cases**
- A legitimate schema migration (e.g., column rename) must not break the hash chain — hash over a stable, versioned serialization, not the raw row
- A verification failure must report which record and approximately when, not just a binary tampered/not-tampered flag

### 8.15 Dashboard & Analytics
**Features**
- Counts: active lots, events this week, open compliance gaps, locations, products
- Recent activity feed
- Compliance-gap list with drill-through to the specific missing fields

### 8.16 Notifications & Alerts
**Features**
- Alert when an event saves with missing/incomplete required KDEs
- Weekly compliance-gap digest to Org Admin/Compliance Manager

**Edge Cases**
- Notification storms (e.g., a bulk import creating 200 gap alerts) → batch/digest rather than 200 individual emails

### 8.17 Settings & Configuration
**Features**
- Org-level defaults: timezone, unit of measure
- Custom KDE field builder per product (name, type, required y/n)

**Edge Cases**
- A required custom field added after historical events exist → apply going forward only; never retroactively mark old events non-compliant for a field that didn't exist when they were recorded

### 8.18 API, Webhooks & Integrations
**Features**
- Scoped API keys (read-only vs. write, per-resource scopes)
- Outbound webhooks for key events (event created, compliance gap detected, recall simulation run)
- Rate-limited public API under `/api/v1`

**Edge Cases**
- Webhook endpoint down/slow → retry with backoff, capped attempts, surfaced delivery failures to the org admin
- Leaked API key → support immediate revoke + rotation without downtime (issue new key before revoking old)

### 8.19 Platform / Super-Admin Console
**Features (internal only)**
- Search tenants, impersonate-with-audit-trail for support, suspend/reinstate orgs, view system health

**Edge Cases**
- Support impersonation must itself be logged with the support agent's identity — never indistinguishable from the customer's own actions

### 8.20 Billing & Subscription
**Features**
- Stripe subscription, plan tiers gated by location count/event volume
- Self-serve upgrade/downgrade, invoices

**Edge Cases**
- Payment failure → grace period with degraded (read-only) access before suspension, not instant lockout of an active compliance system
- Downgrade below current usage → block with a clear message; never silently delete locations to fit a new plan

---

## 9. Cross-Cutting Edge Cases & Tricky Scenarios

1. **Multi-supplier blended lot** — a transformation with many small inputs (e.g., a sauce blending 8 suppliers' ingredients) must capture all 8 input links, not a summary.
2. **Returns / recalled product re-entering the chain** — model as a new Receiving event referencing the original shipping event, not a reversal of history.
3. **Partial shipments over time** — one lot shipped across five shipments over two weeks → five linked shipping events, quantities summing correctly against the lot total.
4. **Concurrent edits** — two staff updating the same lot's status simultaneously → optimistic concurrency (version/timestamp check), even though individual events are append-only and don't have this problem.
5. **Soft-delete everywhere it matters** — locations, products, users, lots are deactivated/voided, never hard-deleted, once tied to history.
6. **Time zones across multi-location orgs** — store UTC, display/enter local time; "same day" compliance questions use the location's local date, not server time.
7. **Unit-of-measure conversions** — a single source-of-truth conversion table with consistent rounding; never assume units match across locations.
8. **Bulk import vs. live double-entry** — dedupe on (lot code + event type + date + location), not exact row match, when historical data is imported after live use has already begun.
9. **Tenant isolation under load/bugs** — any feature touching client-supplied IDs must be specifically tested for cross-tenant access attempts, not just happy-path tested.
10. **Export abuse** — repeated full-org export requests could be used to exfiltrate data; rate-limit and log large exports distinctly from normal API traffic.

---

## 10. Non-Functional Requirements

### 10.1 Performance & Scale (v1 targets)
- API p95 < 300ms for CRUD endpoints
- Trace query < 3s for up to 10,000 linked events per lot
- Per-org support: up to 50 locations, 5,000 active lots, 1M total events without architecture changes

### 10.2 Security
- TLS everywhere; encrypt sensitive fields and backups at rest
- Argon2/bcrypt password hashing; short-lived JWT access + rotating refresh tokens
- Server-side RBAC on every endpoint, plus Postgres RLS as defense-in-depth
- Input validation (Zod/Joi) on every request; parameterized queries/ORM only, never raw string-built SQL
- Rate limiting (per-IP and per-API-key) via Redis
- File uploads: type/size limits, stored outside the web root, served via signed URLs
- Dependency vulnerability scanning in CI (npm audit / Snyk)
- Secrets in environment/secrets manager, never in source control
- Treat SOC 2 readiness as a roadmap item once enterprise-leaning customers appear — most prerequisites (audit logging, access reviews) are already built above

### 10.3 Reliability & Availability
- 99.5% uptime target at v1
- Daily automated Postgres backups + point-in-time recovery; documented RTO/RPO
- Health-check endpoint, uptime monitoring, error tracking (Sentry)

### 10.4 Data Retention
- Event and audit records are never hard-deleted while an org is active
- Default retention period should align to the relevant regulation for the customer's vertical — verify the current exact figure against the official rule text before hardcoding it into compliance copy
- Defined export grace period before any deletion on account closure

### 10.5 Accessibility & Device Support
- Web dashboard targets WCAG 2.1 AA
- Scanning PWA must work on mid/low-end Android devices and modern mobile Safari/Chrome
- No support commitment for Internet Explorer

### 10.6 Observability
- Structured JSON logging (pino), centralized aggregation
- Metrics/dashboards for API latency, job queue depth, error rates
- Audit log is a customer-facing product feature; application logs are an internal ops tool — keep them architecturally separate

---

## 11. API Design Principles (high-level)

- REST, versioned under `/api/v1/...`
- Resource-oriented: `/organizations`, `/users`, `/locations`, `/products`, `/lots`, `/events`, `/trace`, `/imports`, `/reports`, `/api-keys`, `/webhooks`
- Auth via `Authorization: Bearer <token>` (JWT for users, API key for integrations)
- Standard error shape: `{ error: { code, message, details } }`
- Cursor-based pagination for any list endpoint that can grow large (events, audit log)
- Idempotency keys on event-creation endpoints, so a retried request from a flaky warehouse connection can't create a duplicate event
- A full request/response contract per endpoint is a separate companion document

---

## 12. Testing & Quality Strategy

- Unit tests (Jest): lot-linking math, hash-chain generation/verification, trace traversal, KDE-requirement resolution
- Integration tests (Supertest) per endpoint: permission-denied cases per role, cross-tenant access attempts, malformed input
- E2E tests (Playwright): signup → add location/product → record event via scan → run trace → export report
- Seeded staging environment with synthetic data only — never real customer data outside production
- CI (GitHub Actions): lint → unit → integration → build, blocking merge on failure

---

## 13. Acceptance Criteria (sample)

**Event capture (Transformation)**
- Given 2 input lots and 1 output lot with quantities, when saved, `event_lot_links` contains 3 rows tied to one event
- Given a required KDE field is missing, when saved, the event still saves (real-world capture can't be blocked) but is flagged as a compliance gap

**Trace query**
- Given Lot A → (transformation) → Lot C, forward-tracing A returns C
- Given a lot with no events, tracing returns an empty-but-valid result, not an error

**Tenant isolation**
- Given a valid token for Org 1, requesting a lot ID belonging to Org 2 returns 404 (not 403, to avoid confirming the ID's existence), and the attempt is logged

---

## 14. Release Plan / Phased Roadmap

| Phase | Weeks | Scope |
|---|---|---|
| 0 — Foundation | 1–3 | Repo, CI/CD, auth, multi-tenant scaffolding, org/user/role CRUD |
| 1 — Trace Core (MVP) | 4–9 | Locations, products, lots, 4 CTE event capture, manual entry, basic forward/backward trace, append-only audit log, CSV compliance export |
| 2 — Field-Ready | 10–14 | Scanning PWA, bulk CSV import, recall simulation, dashboard, compliance-gap notifications |
| 3 — Scale & Integrate | 15–20 | Public API + webhooks, billing/subscription, platform admin console, PDF reporting |
| 4 — Depth | 21+ | GS1 EPCIS export, ERP connector framework, offline-scan + sync, 2FA, SOC 2 prep, adjacent verticals (e.g., DSCSA for pharma) |

End of Phase 1 = sellable MVP, roughly two months solo/full-time. End of Phase 2 = genuinely field-ready, roughly three and a half months.

---

## 15. Risks & Open Questions

**Risks**
- Regulatory specifics (exact KDE fields, retention periods, role definitions) must be validated against the current official rule text before use in customer-facing compliance claims.
- Change management: getting floor staff to actually scan instead of reverting to paper is a UX/training risk, not just a feature-completeness one.
- Tenant data isolation is the single highest-consequence area to get wrong — invest disproportionately in testing it.

**Open Questions**
- Pricing model: per-location, per-event-volume, or flat tiers? Needs validation with early prospects.
- Should offline-capable scanning move into Phase 2 given how unreliable warehouse WiFi often is?
- Pursue GS1 standards/solution-provider alignment early (helps with large-retailer requirements), or only once a customer asks?

---

## Appendix A: Representative KDE Mapping (verify against current FDA rule text)

| CTE | Representative KDEs (general shape — confirm exact list against the official rule) |
|---|---|
| Creation | Traceability lot code, product description, quantity & unit, location, date |
| Receiving | Lot code, product description, quantity & unit, source location/business, receiving location, date |
| Transformation | New output lot code(s), traceability lot code(s) of all inputs, product description(s), quantity & unit, location, date |
| Shipping | Lot code, product description, quantity & unit, destination location/business, date |

The official rule also defines specific recordkeeping roles (e.g., originator, first receiver, transformer, shipper, receiver) with subtle differences in obligations — map these against the rule text per role rather than treating all entities identically.

---

## Appendix B: Suggested Repo / Folder Structure

```
/api
  /src
    /modules
      /auth
      /organizations
      /users
      /locations
      /products
      /lots
      /events
      /trace
      /imports
      /reports
      /audit
      /webhooks
    /middleware (auth, rbac, tenant-scope, error-handler, rate-limit)
    /jobs (bullmq workers: import-processor, export-generator, hash-verifier)
    /db (migrations, models/schema)
    /tests
/web
  /src
    /features (mirrors API modules)
    /components
    /hooks
/scan-pwa
  /src
    (camera scanning flow, optimized for mobile, shares API client with /web)
```

---

*End of PRD v1.0.*