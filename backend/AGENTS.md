# LotTrace Backend — AI Context

> Read this file when working in `/backend`.
> Also read the root `AGENTS.md` and the relevant `docs/` files before writing code.

---

## Stack
Node.js (LTS) + Express + JavaScript (CommonJS) + Knex + PostgreSQL + Redis + BullMQ

## Folder to Module Mapping
```
src/modules/auth/          → /api/v1/auth/*
src/modules/organizations/ → /api/v1/organizations/*
src/modules/users/         → /api/v1/users/*
src/modules/locations/     → /api/v1/locations/*
src/modules/products/      → /api/v1/products/*
src/modules/lots/          → /api/v1/lots/*
src/modules/events/        → /api/v1/events/*
src/modules/trace/         → /api/v1/trace/*
src/modules/imports/       → /api/v1/imports/*
src/modules/reports/       → /api/v1/reports/*
src/modules/audit/         → /api/v1/audit/*
src/modules/api-keys/      → /api/v1/api-keys/*
src/modules/webhooks/      → /api/v1/webhooks/*
src/modules/recall/        → /api/v1/recall/*
src/modules/dashboard/     → /api/v1/dashboard/*
src/modules/super-admin/   → /api/v1/admin/*
```

---

## Critical Backend Rules

### Authentication & Tenant Isolation
- `req.user` is set by `authenticate` middleware — never trust body fields for identity
- `req.organizationId` is set by `tenantScope` middleware — always use this
- **NEVER** accept `organizationId` from request body or query params
- **ALWAYS** filter every DB query by `organization_id = req.organizationId`
- **ALWAYS** return 404 (not 403) for cross-tenant resource access
- Set `app.current_org_id` Postgres setting for RLS on every request

### Database (Knex)
```javascript
const db = require('../../db/knex');

// ✅ Correct - always scope by organization_id
const lots = await db('lots')
  .where({ organization_id: organizationId, status: 'active' })
  .orderBy('created_at', 'desc');

// ❌ NEVER - never trust organizationId from outside service call context
const lots = await db('lots').where({ id: req.body.lotId }); // No org scope!
```

### Knex + PostgreSQL Patterns
```javascript
// Insert + return
const [record] = await db('table').insert(data).returning('*');

// Update + return
const [updated] = await db('table').where({ id, organization_id: orgId }).update(data).returning('*');

// Check exists (cross-tenant safe)
const lot = await db('lots').where({ id, organization_id: orgId }).first();
if (!lot) throw new AppError('Lot not found', 'NOT_FOUND', 404);

// JSONB query
const events = await db('events')
  .whereRaw("kde_payload->>'supplier_name' = ?", [supplierName]);

// Transactions
await db.transaction(async (trx) => {
  const [event] = await trx('events').insert(eventData).returning('*');
  await trx('event_lot_links').insert(links);
});
```

### Development Database (Greenfield)
- The development database is disposable. Reset it with `pnpm knex migrate:rollback --all` (or drop/recreate) and run `pnpm knex migrate:latest && pnpm knex seed:run` whenever a schema change is simpler from scratch.
- Never write backfill, data-repair, or compatibility migrations. Edit the original migration or add a clean one.
- Delete legacy columns, tables, hash versions, and code paths; do not keep them for old data.
- Tests create their own fixtures; never depend on seeded or pre-existing rows.

### Module File Pattern (4 files, always)
Every module has exactly these 4 files:

**`[module].routes.js`**
```javascript
const router = require('express').Router();
const { authenticate } = require('../../middleware/authenticate');
const { requireRole } = require('../../middleware/rbac');
const { validate } = require('../../middleware/validate');
const { createLotSchema } = require('./lots.validation');
const lotsController = require('./lots.controller');

// Apply auth to all routes in this router
router.use(authenticate);

router.get('/',    validate({ query: listLotsSchema }),  lotsController.listLots);
router.post('/',   requireRole(['org_admin', 'compliance_manager', 'operator']),
                   validate({ body: createLotSchema }),  lotsController.createLot);

module.exports = router;
```

**`[module].controller.js`**
```javascript
const apiResponse = require('../../utils/apiResponse');
const lotsService = require('./lots.service');

// Controllers are THIN: extract params → call service → respond
const createLot = async (req, res) => {
  const lot = await lotsService.createLot(req.validatedBody, req.organizationId, req.user.id);
  return apiResponse.created(res, lot, 'Lot created successfully');
};

module.exports = { createLot, listLots, getLot, updateLot, voidLot };
```

**`[module].service.js`**
```javascript
const db = require('../../db/knex');
const { v4: uuid } = require('uuid');
const AppError = require('../../utils/AppError');

// Services contain ALL business logic
const createLot = async (data, organizationId, userId) => {
  // Always scope to organizationId (from JWT, not client)
  const product = await db('products').where({ id: data.productId, organization_id: organizationId }).first();
  if (!product) throw new AppError('Product not found', 'NOT_FOUND', 404);

  const [lot] = await db('lots').insert({ id: uuid(), organization_id: organizationId, ...data, created_by: userId }).returning('*');
  return lot;
};

module.exports = { createLot };
```

**`[module].validation.js`**
```javascript
const { z } = require('zod');

const createLotSchema = z.object({
  productId:           z.string().uuid(),
  traceabilityLotCode: z.string().min(1).max(200),
  quantity:            z.number().positive(),
  uom:                 z.string().min(1).max(20),
});

module.exports = { createLotSchema };
```

---

## Special: Hash Chain Computation

Never hand-roll the hash payload. Use the canonical serializer from `backend/src/utils/hashChain.js` on every path — manual create, import, and verification:
```javascript
const {
  HASH_VERSION,
  GENESIS_HASH,
  PENDING_RECORD_HASH,
  getChainTip,
  nextChainSeq,
  sealEventHash,
} = require('../../utils/hashChain');

// Inside the event transaction, after pg_advisory_xact_lock(org_lock_id):
const tip = await getChainTip(trx, organizationId);
const chainSeq = nextChainSeq(tip);
const prevHash = tip ? tip.record_hash : GENESIS_HASH;

// Insert the event with record_hash: PENDING_RECORD_HASH and hash_version:
// HASH_VERSION, insert its event_lot_links, then seal the hash from the
// persisted row and links. Same transaction.
const event = await sealEventHash(trx, eventId, prevHash);
```

> **P0-01/P0-02:** the hash covers **persisted values only** (`numeric(15,4)` text
> such as `"1.0000"`, ISO-8601 UTC datetime, links sorted by `lot_id`, explicit
> `null`/`{}` defaults), never the request body or CSV row. Both writers call
> `sealEventHash()`; the verifier calls `loadEventHashPayload()` — never
> re-implement the payload in a caller. Every insert sets `chain_seq` and
> `hash_version`, and reads the tip with `getChainTip()` / `nextChainSeq()`
> inside the transaction that holds `pg_advisory_xact_lock(org_lock_id)`.
> There is no legacy hash version support: to change the format, bump
> `HASH_VERSION`, update the serializer and verifier together, and reset the
> development database.


---

## Special: Compliance Gap Detection

On every event save, check required KDEs:
```javascript
// utils/complianceGaps.js
const detectGaps = (event, product, lotLinks) => {
  const gaps = [];

  // Always required
  if (!event.locationId) gaps.push({ field: 'locationId', message: 'Location is required' });
  if (!event.eventDatetime) gaps.push({ field: 'eventDatetime', message: 'Event date is required' });

  // FTL products have stricter requirements
  if (product.is_ftl) {
    if (event.event_type === 'receiving' && !event.counterparty_info?.name) {
      gaps.push({ field: 'counterpartyInfo.name', message: 'Supplier name required for FTL products' });
    }
    // Check custom KDE schema required fields
    for (const field of product.custom_kde_schema) {
      if (field.required && !event.kde_payload?.[field.name]) {
        gaps.push({ field: `kdePayload.${field.name}`, message: `${field.label} is required` });
      }
    }
  }

  return gaps.length > 0 ? gaps : null;
};
```

---

## Pagination Helper
```javascript
// utils/pagination.js
const paginate = async (query, { page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;
  const countQuery = query.clone().clearSelect().count('* as total');
  const [{ total }] = await countQuery;
  const data = await query.limit(limit).offset(offset);

  return {
    data,
    pagination: {
      total: parseInt(total),
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1,
    },
  };
};
```

---

## Audit Logging
Write to audit_log for all sensitive actions:
```javascript
// utils/auditTrail.js
const writeAudit = async ({ organizationId, actorId, actorType = 'user', action, entityType, entityId, beforeState, afterState, metadata, ipAddress }) => {
  await db('audit_log').insert({
    id: uuid(),
    organization_id: organizationId,
    actor_id: actorId,
    actor_type: actorType,
    action,       // e.g. 'lot.void', 'event.amend', 'user.invite'
    entity_type: entityType,
    entity_id: entityId,
    before_state: beforeState ? JSON.stringify(beforeState) : null,
    after_state: afterState ? JSON.stringify(afterState) : null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ip_address: ipAddress,
  });
};
```

**Actions that MUST be audit-logged:**
- `user.invite`, `user.deactivate`, `user.role_change`
- `lot.void`, `lot.recall`
- `event.amend`, `event.void`
- `report.export` (compliance export download)
- `api_key.create`, `api_key.revoke`
- `admin.impersonate`
- `org.suspend`

---

## Error Handling
- `express-async-errors` is installed — no try/catch needed in route handlers
- Throw `AppError` for expected operational errors
- Unexpected errors bubble to `errorHandler` middleware
- Knex constraint errors (23505 = unique, 23503 = foreign key) are caught in errorHandler
