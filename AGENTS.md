# LotTrace — AI Context File (AGENTS.md)

## What This Project Is
LotTrace is a multi-tenant SaaS platform for supply chain traceability under FDA FSMA 204.
Food manufacturers, processors and co-packers use it to capture lot-level events (creation,
receiving, transformation, shipping) via barcode scanning or manual forms, and instantly trace
any lot forward or backward through the supply chain — turning a multi-day recall investigation
into a seconds-long query.

**Stack:** Node.js + Express (JavaScript) · React + Vite (JavaScript) · PostgreSQL · Redis · BullMQ

---

## ⚠️ CRITICAL RULES — Read Before Writing Any Code

1. **READ docs/API_STANDARDS.md** before creating any API endpoint — one response format, forever
2. **READ docs/CONVENTIONS.md** before creating any file — naming, structure, module patterns
3. **READ docs/TECH_STACK.md** before installing any package — no unapproved packages
4. **READ docs/DATABASE_SCHEMA.md** before touching any DB query — column names, types, indexes
5. **READ PROGRESS.md** before starting — understand current build state
6. **NEVER** use TypeScript — this project is pure JavaScript with JSDoc where needed
7. **NEVER** use `fetch()` — always use the configured `axios` instance from `backend/src/lib/http.js` (backend) or `frontend/src/lib/api.js` (frontend)
8. **NEVER** write raw string-interpolated SQL — always use Knex query builder or parameterized queries
9. **NEVER** trust `organization_id` from request body — always derive it from `req.user.organizationId` (JWT)
10. **NEVER** hard-delete records that are linked to events, lots, or audit trail in application behavior (resetting the disposable development database is fine)
11. **ASK for plan first** on any feature > 50 lines — list files + changes, wait for approval, then implement
12. **Treat the project as greenfield** — no backward compatibility, legacy data, backfills, or compatibility migrations. Reset the dev DB and delete obsolete schema/code instead.

---

## Development Policy — Greenfield

LotTrace is pre-production. There are no production users and no data that must survive a change.

- **No backward compatibility:** do not add legacy code paths, dual formats, feature flags, or compatibility shims.
- **No data preservation:** do not write backfills, data-repair migrations, or "keep old rows working" logic.
- **Rewrite freely:** do not preserve an old implementation just because it exists; replace it with the simplest correct design.
- **Schema changes are direct:** edit the original migration or add a clean one, then reset the development database and reseed.
- **Delete obsolete things:** remove old columns, tables, endpoints, hash versions, and dead code instead of keeping them "just in case".
- **Tests build their own data:** never depend on seeded or pre-existing rows.
- **Keep final invariants:** tenant isolation, append-only audit trail, hash verification, and RBAC must still be correct in the finished system.
- **One safety rule:** never run destructive commands against a shared staging or production database. The development database is disposable.

---

## Architecture at a Glance

```
[React Web App :3001]     [Scan PWA :3002]
         \                      /
    [Express API :3000]  ←→  [Redis: cache, rate-limit, BullMQ queues]
              |
     [PostgreSQL :5432]
              |
     [BullMQ Workers: import-processor, export-generator, hash-verifier]
              |
     [S3/R2 Object Storage: file uploads, generated reports]
```

### Services
| Service | Port | Location | Purpose |
|---------|------|----------|---------|
| API | 3000 | `/backend` | Express REST API |
| Web App | 3001 | `/frontend` | Main dashboard (React) |
| Scan PWA | 3002 | `/scan-pwa` | Mobile scanning interface (React PWA) |
| PostgreSQL | 5432 | Docker | Primary database |
| Redis | 6379 | Docker | Cache + BullMQ + rate limiting |

### Multi-Tenancy Model
- Shared database, shared schema
- `organization_id` column on every tenant-scoped table
- `organization_id` **only** from `req.user.organizationId` (JWT) — never client body
- PostgreSQL Row Level Security (RLS) as defense-in-depth layer
- 404 (never 403) when cross-tenant ID accessed — don't confirm existence

---

## Key Files Index

| File | Purpose |
|------|---------|
| `PROGRESS.md` | Current build state — update at end of every session |
| `docs/PRD.md` | Full product requirements |
| `docs/ARCHITECTURE.md` | Detailed system design & data flows |
| `docs/TECH_STACK.md` | Every approved package and WHY |
| `docs/API_STANDARDS.md` | Response format, errors, status codes — THE LAW |
| `docs/DATABASE_SCHEMA.md` | All PostgreSQL tables, columns, indexes |
| `docs/CONVENTIONS.md` | File naming, folder structure, code patterns |
| `docs/UI_DESIGN_SYSTEM.md` | Tailwind config, shadcn/ui rules, component patterns |
| `docs/FEATURE_MAP.md` | All features with phase and build status |
| `docs/VALIDATION_RULES.md` | Zod schemas and validation patterns |
| `backend/AGENTS.md` | Backend-specific context (read when in /backend) |
| `frontend/AGENTS.md` | Frontend-specific context (read when in /frontend) |
| `scan-pwa/AGENTS.md` | PWA-specific context (read when in /scan-pwa) |

---

## Module List (Backend)
Each module in `backend/src/modules/` has: `routes.js`, `controller.js`, `service.js`, `validation.js`

| Module | API Prefix | Status |
|--------|-----------|--------|
| auth | `/api/v1/auth` | — |
| organizations | `/api/v1/organizations` | — |
| users | `/api/v1/users` | — |
| locations | `/api/v1/locations` | — |
| products | `/api/v1/products` | — |
| lots | `/api/v1/lots` | — |
| events | `/api/v1/events` | — |
| trace | `/api/v1/trace` | — |
| imports | `/api/v1/imports` | — |
| reports | `/api/v1/reports` | — |
| audit | `/api/v1/audit` | — |
| api-keys | `/api/v1/api-keys` | — |
| webhooks | `/api/v1/webhooks` | — |
| recall | `/api/v1/recall` | — |
| super-admin | `/api/v1/admin` | — |

---

## Current Build Status
→ See `PROGRESS.md` for full session state
→ See `docs/FEATURE_MAP.md` for phase-by-phase feature status

## Roles Reference
`org_admin` · `compliance_manager` · `operator` · `auditor` · `api_key` · `super_admin`

## Event Types (CTEs)
`creation` · `receiving` · `transformation` · `shipping`

## Lot Statuses
`active` · `recalled` · `void`