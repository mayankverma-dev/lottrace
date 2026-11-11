# LotTrace — Validation Rules

> All request validation uses Zod. Backend schemas live in `[module].validation.js`.
> Frontend schemas are duplicated in the feature component (same Zod, different import path).
> This file documents the rules — Zod code lives in the module files.

---

## General Rules

1. **Every request body** is validated with Zod before the controller touches it
2. **Every query param** on list endpoints is validated (page, limit, filters)
3. Invalid = 422 with `VALIDATION_ERROR` code and field-level details
4. UUIDs: `z.string().uuid('Must be a valid ID')`
5. Required strings: `z.string().min(1, 'Field is required')` (not just `.string()` — empty string passes)
6. Dates from client: `z.string().datetime({ message: 'Must be ISO 8601 datetime' })`
7. Strip unknown keys: all schemas use `.strict()` or `.strip()` (default is strip)
8. Numbers from forms: `z.coerce.number()` (forms send strings)

---

## Auth Schemas

### Register
```javascript
// auth.validation.js
const registerSchema = z.object({
  firstName:    z.string().min(1).max(100),
  lastName:     z.string().min(1).max(100),
  email:        z.string().email('Invalid email address'),
  password:     z.string().min(12, 'Password must be at least 12 characters').max(128),
  companyName:  z.string().min(1).max(200),
  companySlug:  z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, hyphens only'),
});
```

### Login
```javascript
const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});
```

### Forgot Password
```javascript
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
```

### Reset Password
```javascript
const resetPasswordSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string().min(12).max(128),
});
```

---

## Organization Schemas

### Update Org Settings
```javascript
const updateOrgSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  timezoneDefault: z.string().optional(),  // IANA timezone
  uomDefault:      z.enum(['kg', 'lb', 'g', 'oz', 'units', 'lbs', 'mt']).optional(),
}).strict();
```

---

## User Schemas

### Invite User
```javascript
const inviteUserSchema = z.object({
  email: z.string().email(),
  role:  z.enum(['org_admin', 'compliance_manager', 'operator', 'auditor']),
  firstName: z.string().min(1).max(100).optional(),
  lastName:  z.string().min(1).max(100).optional(),
});
```

### Update User
```javascript
const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName:  z.string().min(1).max(100).optional(),
  role:      z.enum(['org_admin', 'compliance_manager', 'operator', 'auditor']).optional(),
}).strict();
```

---

## Location Schemas

### Create / Update Location
```javascript
const createLocationSchema = z.object({
  name:         z.string().min(1).max(200),
  type:         z.enum(['farm', 'plant', 'warehouse', 'distributor', 'retailer', 'other']),
  isExternal:   z.boolean().default(false),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city:         z.string().max(100).optional(),
  state:        z.string().max(100).optional(),
  postalCode:   z.string().max(20).optional(),
  country:      z.string().length(2).default('US'),  // ISO alpha-2
  gln:          z.string().regex(/^\d{13}$/, 'GLN must be 13 digits').optional().nullable(),
  timezone:     z.string().optional(),               // IANA timezone
});

const updateLocationSchema = createLocationSchema.partial();
```

---

## Product Schemas

### Create / Update Product
```javascript
const kdeFieldSchema = z.object({
  name:     z.string().min(1).max(100).regex(/^[a-z_]+$/, 'Use lowercase snake_case'),
  label:    z.string().min(1).max(200),
  type:     z.enum(['string', 'number', 'boolean', 'date', 'select']),
  required: z.boolean().default(false),
  options:  z.array(z.string()).optional(),  // for type = 'select'
});

const createProductSchema = z.object({
  name:              z.string().min(1).max(200),
  sku:               z.string().max(100).optional(),
  gtin:              z.string().regex(/^\d{8}(\d{4}(\d{2})?)?$/, 'GTIN must be 8, 12, or 14 digits').optional().nullable(),
  category:          z.string().max(100).optional(),
  isFtl:             z.boolean().default(false),
  defaultUom:        z.string().min(1).max(20).default('kg'),
  customKdeSchema:   z.array(kdeFieldSchema).default([]),
});

const updateProductSchema = createProductSchema.partial();
```

---

## Lot Schemas

### Create Lot
```javascript
const createLotSchema = z.object({
  productId:              z.string().uuid(),
  traceabilityLotCode:    z.string().min(1).max(200),
  quantity:               z.number().positive('Quantity must be positive'),
  uom:                    z.string().min(1).max(20),
  notes:                  z.string().max(2000).optional(),
});
```

### Void Lot
```javascript
const voidLotSchema = z.object({
  reason: z.string().min(1, 'Void reason is required').max(1000),
});
```

### Update Lot
```javascript
const updateLotSchema = z.object({
  quantity: z.number().positive().optional(),
  uom:      z.string().min(1).max(20).optional(),
  notes:    z.string().max(2000).optional(),
  version:  z.number().int().positive(),  // required for optimistic concurrency
}).strict();
```

### List Lots (Query Params)
```javascript
const listLotsSchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
  status:     z.enum(['active', 'recalled', 'void']).optional(),
  productId:  z.string().uuid().optional(),
  search:     z.string().max(200).optional(),
  sort:       z.enum(['createdAt', 'updatedAt', 'traceabilityLotCode']).default('createdAt'),
  order:      z.enum(['asc', 'desc']).default('desc'),
});
```

---

## Event Schemas

### Lot Link (used inside event schemas)
```javascript
const lotLinkSchema = z.object({
  lotId:     z.string().uuid(),
  direction: z.enum(['input', 'output']),
  quantity:  z.number().positive().optional(),
  uom:       z.string().min(1).max(20).optional(),
});
```

Event creation validates lot ownership inside its database transaction. A lot
that is unknown or belongs to another organization returns `404 NOT_FOUND`
(`Lot not found`), and the event plus all links are rolled back.

When supplied, `locationId` is validated against the event organization inside
the same transaction. Unknown or foreign locations return `404 NOT_FOUND`
(`Location not found`).

### Create Event — Base (shared fields)
```javascript
const eventBaseSchema = z.object({
  locationId:       z.string().uuid().optional(),
  eventDatetime:    z.string().datetime('Must be ISO 8601'),
  notes:            z.string().max(2000).optional(),
  kdePayload:       z.record(z.unknown()).default({}),
  counterpartyInfo: z.object({
    name:    z.string().optional(),
    address: z.string().optional(),
    lotCode: z.string().optional(),   // their lot code if not on LotTrace
  }).optional(),
});
```

### Creation CTE
```javascript
const createCreationEventSchema = eventBaseSchema.extend({
  eventType: z.literal('creation'),
  lots: z.array(lotLinkSchema.extend({ direction: z.literal('output') }))
         .min(1, 'At least one output lot required'),
});
```

### Receiving CTE
```javascript
const createReceivingEventSchema = eventBaseSchema.extend({
  eventType: z.literal('receiving'),
  lots: z.array(lotLinkSchema.extend({ direction: z.literal('input') }))
         .min(1, 'At least one lot required'),
  locationId: z.string().uuid('Receiving location is required'),
});
```

### Transformation CTE
```javascript
const createTransformationEventSchema = eventBaseSchema.extend({
  eventType: z.literal('transformation'),
  lots: z.array(lotLinkSchema).min(2, 'At least one input and one output lot required')
         .refine(
           lots => lots.some(l => l.direction === 'input') && lots.some(l => l.direction === 'output'),
           'Must have at least one input lot and one output lot'
         ),
  lossQuantity: z.number().min(0).optional(),  // process waste
  lossUom:      z.string().optional(),
});
```

### Shipping CTE
```javascript
const createShippingEventSchema = eventBaseSchema.extend({
  eventType: z.literal('shipping'),
  lots: z.array(lotLinkSchema.extend({ direction: z.literal('output') }))
         .min(1, 'At least one lot required'),
});
```

### Discriminated Union (single schema for POST /events)
```javascript
const createEventSchema = z.discriminatedUnion('eventType', [
  createCreationEventSchema,
  createReceivingEventSchema,
  createTransformationEventSchema,
  createShippingEventSchema,
]);
```

### Amend Event
```javascript
const amendEventSchema = z.object({
  reason:        z.string().min(1, 'Amendment reason is required').max(1000),
  notes:         z.string().max(2000).optional(),
  kdePayload:    z.record(z.unknown()).optional(),
  eventDatetime: z.string().datetime().optional(),
});
```

### Void Event
```javascript
const voidEventSchema = z.object({
  reason: z.string().min(1, 'Void reason is required').max(1000),
});
```

---

## Import Schemas

### Initiate Import
```javascript
const createImportSchema = z.object({
  cteType:  z.enum(['creation', 'receiving', 'transformation', 'shipping']),
  filename: z.string().min(1),
});
```

---

## Recall Simulation Schemas

```javascript
const createSimulationSchema = z.object({
  name:             z.string().min(1).max(200),
  triggeringLotId:  z.string().uuid(),
  params: z.object({
    includeAmended: z.boolean().default(true),
    includeVoided:  z.boolean().default(false),
    maxDepth:       z.number().int().min(1).max(100).default(50),
  }).default({}),
});
```

---

## API Key Schemas

```javascript
const createApiKeySchema = z.object({
  label:  z.string().min(1).max(100),
  scopes: z.array(
    z.enum(['read', 'write', 'read:lots', 'write:lots', 'read:events', 'write:events', 'read:trace'])
  ).min(1, 'At least one scope required'),
});
```

---

## Webhook Schemas

```javascript
const createWebhookSchema = z.object({
  url: z.string().url('Must be a valid HTTPS URL').refine(
    url => url.startsWith('https://'),
    'Webhook URL must use HTTPS'
  ),
  subscribedEvents: z.array(
    z.enum(['event.created', 'event.amended', 'event.void', 'gap.detected',
            'recall.simulation.complete', 'import.complete'])
  ).min(1),
});
```

---

## Common Query Param Schemas

```javascript
// Pagination (used across all list endpoints)
const paginationSchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort:  z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// Date range filter
const dateRangeSchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo:   z.string().datetime().optional(),
}).refine(
  d => !d.dateFrom || !d.dateTo || new Date(d.dateFrom) <= new Date(d.dateTo),
  'dateFrom must be before dateTo'
);
```

---

## Validation Middleware Usage

```javascript
// routes:
const { validate } = require('../../middleware/validate');
const { createLotSchema, listLotsSchema } = require('./lots.validation');

router.get('/',    validate({ query: listLotsSchema }),  lotsController.listLots);
router.post('/',   validate({ body: createLotSchema }),  lotsController.createLot);
router.patch('/:id', validate({ body: updateLotSchema }), lotsController.updateLot);

// middleware/validate.js — supports body, query, params
const validate = ({ body, query, params } = {}) => (req, res, next) => {
  try {
    if (body)   req.validatedBody   = body.parse(req.body);
    if (query)  req.validatedQuery  = query.parse(req.query);
    if (params) req.validatedParams = params.parse(req.params);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
      return apiResponse.validationError(res, details);
    }
    next(err);
  }
};
```
