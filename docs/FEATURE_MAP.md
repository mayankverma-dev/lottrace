# LotTrace — Feature Map & Build Order

> Reference this for: what to build next, current feature status, phase scope.

---

## Phase 0 — Foundation (Weeks 1–3)

| # | Feature | Module | Status |
|---|---------|--------|--------|
| 0.1 | Monorepo scaffold (pnpm workspaces) | infra | ✅ |
| 0.2 | Docker Compose (postgres + redis) | infra | ✅ |
| 0.3 | ESLint + Prettier + Husky | infra | ✅ |
| 0.4 | Express app setup (app.js, middleware chain) | backend | ✅ |
| 0.5 | Knex setup + knexfile.js | database | ✅ |
| 0.6 | DB migrations: organizations, users, refresh_tokens | database | ✅ |
| 0.7 | Config: env.js (Zod validation), redis.js | backend | ✅ |
| 0.8 | Utilities: apiResponse.js, AppError.js, logger.js | backend | ✅ |
| 0.9 | Middleware: requestId, errorHandler, authenticate | backend | ✅ |
| 0.10 | Auth: register endpoint | auth | ✅ |
| 0.11 | Auth: login endpoint | auth | ✅ |
| 0.12 | Auth: refresh token endpoint | auth | ✅ |
| 0.13 | Auth: logout endpoint + Redis token blacklist | auth | ✅ |
| 0.14 | Auth: forgot-password + reset-password | auth | ✅ |
| 0.15 | Middleware: tenantScope.js + rbac.js | backend | ✅ |
| 0.16 | Org management endpoints (GET/PATCH /organizations/me) | organizations | ✅ |
| 0.17 | User invite flow (invite → email → accept) | users | ✅ |
| 0.18 | User CRUD (list, get, update, deactivate) | users | ✅ |
| 0.19 | Vite React scaffold (frontend + scan-pwa) | frontend | ✅ |
| 0.20 | shadcn/ui + Tailwind setup | frontend | ✅ |
| 0.21 | Axios instance (api.js) + React Query setup | frontend | ✅ |
| 0.22 | Auth Zustand store | frontend | ✅ |
| 0.23 | Login page | frontend | ✅ |
| 0.24 | Register page | frontend | ✅ |
| 0.25 | Forgot/reset password pages | frontend | ✅ |
| 0.26 | App layout (sidebar + routing) | frontend | ✅ |
| 0.27 | User management page | frontend | ✅ |
| 0.28 | Org settings page | frontend | ✅ |

---

## Phase 1 — Trace Core / MVP (Weeks 4–9)

| # | Feature | Module | Status |
|---|---------|--------|--------|
| 1.1 | DB migrations: locations, products, lots, events, event_lot_links, attachments, audit_log | database | ✅ |
| 1.2 | RLS policies on all tenant tables | database | ✅ |
| 1.3 | Location CRUD API | locations | ✅ |
| 1.4 | External partner location support | locations | ✅ |
| 1.5 | Product CRUD API | products | ✅ |
| 1.6 | Product custom KDE schema builder (API) | products | ✅ |
| 1.7 | Lot CRUD API | lots | ✅ |
| 1.8 | Lot void (POST /lots/:id/void) | lots | ✅ |
| 1.9 | Event: Creation CTE | events | ✅ |
| 1.10 | Event: Receiving CTE | events | ✅ |
| 1.11 | Event: Transformation CTE (N inputs → M outputs) | events | ✅ |
| 1.12 | Event: Shipping CTE | events | ✅ |
| 1.13 | Event amend flow (supersedes_event_id) | events | ✅ |
| 1.14 | Event void flow | events | ✅ |
| 1.15 | Compliance gap detection on event save | events | ✅ |
| 1.16 | Hash chain: compute + store (record_hash, prev_hash) | audit | ✅ |
| 1.17 | Audit log middleware (auditLogger.js) | audit | ✅ |
| 1.18 | Audit log endpoint (GET /audit) | audit | ✅ |
| 1.19 | Trace engine: forward trace (recursive CTE) | trace | ✅ |
| 1.20 | Trace engine: backward trace (recursive CTE) | trace | ✅ |
| 1.21 | Trace engine: full trace (forward + backward) | trace | ✅ |
| 1.22 | Trace result caching (Redis, 5min TTL) | trace | ✅ |
| 1.23 | CSV compliance export (BullMQ job) | reports | ✅ |
| 1.24 | Compliance gap report (GET /reports/compliance-gaps) | reports | ✅ |
| 1.25 | BullMQ setup (queues.js, export-generator.js) | jobs | ✅ |
| 1.26 | S3/R2 storage client setup | infra | ✅ |
| 1.27 | File attachment upload (presigned URL flow) | events | ✅ |
| 1.28 | Locations list + detail pages | frontend | ✅ |
| 1.29 | Products list + detail pages | frontend | ✅ |
| 1.30 | Lots list page + DataTable | frontend | ✅ |
| 1.31 | Lot detail page (timeline of events) | frontend | ✅ |
| 1.32 | Record Event form (4 CTE types) | frontend | ✅ |
| 1.33 | Trace visualization page (tree + table) | frontend | ✅ |
| 1.34 | Audit log page | frontend | ✅ |
| 1.35 | Compliance gap list page | frontend | ✅ |
| 1.36 | CSV export button → download | frontend | ✅ |

**End of Phase 1 = sellable MVP**

---

## Phase 2 — Field-Ready (Weeks 10–14)

| # | Feature | Module | Status |
|---|---------|--------|--------|
| 2.1 | DB migrations: imports, recall_simulations, notifications, idempotency_keys | database | ✅ |
| 2.2 | Scan PWA: camera scanning (@zxing/library) | scan-pwa | ✅ |
| 2.3 | Scan PWA: scan → lookup lot → attach to event | scan-pwa | ✅ |
| 2.4 | Scan PWA: bulk scan mode (sequential receiving) | scan-pwa | ✅ |
| 2.5 | Scan PWA: GS1-128 parsing | scan-pwa | ✅ |
| 2.6 | Scan PWA: create new lot from unknown scan | scan-pwa | ✅ |
| 2.7 | PWA manifest + service worker (vite-plugin-pwa) | scan-pwa | ✅ |
| 2.8 | Bulk CSV import API (POST /imports) | imports | ✅ |
| 2.9 | Import validation + per-row error report | imports | ✅ |
| 2.10 | Import background job (import-processor.js) | jobs | ✅ |
| 2.11 | Import deduplication logic | imports | ✅ |
| 2.12 | CSV import templates (downloadable per CTE) | imports | ✅ |
| 2.13 | Recall simulation API (POST /recall/simulations) | recall | ✅ |
| 2.14 | Recall simulation storage + retrieval | recall | ✅ |
| 2.15 | Dashboard stats endpoint (GET /dashboard/stats) | dashboard | ✅ |
| 2.16 | Dashboard recent activity feed | dashboard | ✅ |
| 2.17 | Compliance gap email notification | jobs | ✅ |
| 2.18 | Email batch digest (not per-gap storm) | jobs | ✅ |
| 2.19 | Hash chain verifier background job (nightly) | jobs | ✅ |
| 2.20 | In-app notifications (GET /notifications) | notifications | ✅ |
| 2.21 | Idempotency key support on event creation | events | ✅ |
| 2.22 | Dashboard page with stats cards + chart | frontend | ✅ |
| 2.23 | Bulk import page (upload + progress + errors) | frontend | ✅ |
| 2.24 | Recall simulation page | frontend | ✅ |
| 2.25 | Notification bell + list | frontend | ✅ |
| 2.26 | Onboarding checklist UI | frontend | ✅ |
| 2.27 | Scan PWA: offline event outbox + sync on reconnect | scan-pwa | ✅ |

**End of Phase 2 = genuinely field-ready**

---

## Phase 3 — Scale & Integrate (Weeks 15–20)

| # | Feature | Module | Status |
|---|---------|--------|--------|
| 3.1 | DB migrations: api_keys, webhooks, subscriptions | database | 🔲 |
| 3.2 | API keys: create, list, revoke | api-keys | 🔲 |
| 3.3 | API key authentication middleware | auth | 🔲 |
| 3.4 | API key rate limiting (separate from user) | middleware | 🔲 |
| 3.5 | Webhooks: CRUD + outbound dispatcher | webhooks | 🔲 |
| 3.6 | Webhook retry logic with backoff | jobs | 🔲 |
| 3.7 | PDF export (pdfkit, background job) | reports | 🔲 |
| 3.8 | PDF compliance report design | reports | 🔲 |
| 3.9 | Stripe subscription integration | billing | 🔲 |
| 3.10 | Plan limits enforcement (location count, event volume) | middleware | 🔲 |
| 3.11 | Billing portal (Stripe Customer Portal redirect) | billing | 🔲 |
| 3.12 | Grace period on payment failure (read-only mode) | billing | 🔲 |
| 3.13 | Super-admin console (tenant list, suspend, impersonate) | super-admin | 🔲 |
| 3.14 | Impersonation audit trail | super-admin | 🔲 |
| 3.15 | API keys management page | frontend | 🔲 |
| 3.16 | Webhooks management page | frontend | 🔲 |
| 3.17 | PDF export download | frontend | 🔲 |
| 3.18 | Billing / subscription page | frontend | 🔲 |

---

## Phase 4 — Depth (Week 21+)

| # | Feature | Status |
|---|---------|--------|
| 4.1 | GS1 EPCIS-format export | 🔲 |
| 4.2 | ERP connector framework (Webhook ingestion) | 🔲 |
| 4.3 | Offline scan + sync (service worker + conflict resolution) | 🔲 |
| 4.4 | TOTP 2FA for Org Admin / Compliance Manager | 🔲 |
| 4.5 | SOC 2 preparation (access reviews, policies) | 🔲 |
| 4.6 | Adjacent vertical: DSCSA (pharma) | 🔲 |
| 4.7 | Session device list + revoke individual session | 🔲 |
| 4.8 | Multi-language UI | 🔲 |
| 4.9 | SSO (SAML/OIDC) | 🔲 |

---

## Status Key
| Symbol | Meaning |
|--------|---------|
| 🔲 | Not started |
| 🔄 | In progress |
| ✅ | Complete |
| ⏸️ | Blocked / paused |
| ❌ | Descoped |
