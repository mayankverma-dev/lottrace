# LotTrace — Code Conventions

> Read this before creating any file, writing any function, or naming anything.

---

## File & Folder Naming

| Type | Convention | Example |
|------|-----------|---------|
| Backend JS files | `kebab-case.type.js` | `lots.service.js` |
| Frontend React components | `PascalCase.jsx` | `LotCard.jsx` |
| Frontend pages | `PascalCase.jsx` in `/pages` | `LotDetailPage.jsx` |
| Frontend hooks | `camelCase.js` starting with `use` | `useTrace.js` |
| Frontend stores | `camelCase.store.js` | `auth.store.js` |
| Frontend API hooks | `camelCase.api.js` | `lots.api.js` |
| Frontend utils | `camelCase.js` | `formatDate.js` |
| Backend migrations | `YYYYMMDDHHmmss_description.js` | `20240115_create_lots.js` |
| Env files | `.env`, `.env.example` | lowercase |

---

## Backend Project Structure

```
backend/
├── src/
│   ├── app.js                 ← Express app setup, middleware registration
│   ├── server.js              ← HTTP server start, port binding
│   │
│   ├── modules/               ← Feature modules (each has 4 files)
│   │   ├── auth/
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js
│   │   │   └── auth.validation.js
│   │   ├── organizations/
│   │   ├── users/
│   │   ├── locations/
│   │   ├── products/
│   │   ├── lots/
│   │   ├── events/
│   │   ├── trace/
│   │   ├── imports/
│   │   ├── reports/
│   │   ├── audit/
│   │   ├── api-keys/
│   │   ├── webhooks/
│   │   ├── recall/
│   │   ├── dashboard/
│   │   └── super-admin/
│   │
│   ├── middleware/
│   │   ├── authenticate.js     ← JWT verification, sets req.user
│   │   ├── tenantScope.js      ← Sets req.organizationId, configures RLS
│   │   ├── rbac.js             ← Role-based access control factory
│   │   ├── validate.js         ← Zod schema validation middleware
│   │   ├── rateLimiter.js      ← Rate limiting configs
│   │   ├── requestId.js        ← Attach unique request ID
│   │   ├── auditLogger.js      ← Log sensitive actions
│   │   └── errorHandler.js     ← Global error handler
│   │
│   ├── jobs/                  ← BullMQ workers
│   │   ├── queues.js           ← Queue definitions
│   │   ├── import-processor.js
│   │   ├── export-generator.js
│   │   ├── hash-verifier.js
│   │   ├── email-sender.js
│   │   └── webhook-dispatcher.js
│   │
│   ├── db/
│   │   ├── knex.js             ← Knex instance (singleton)
│   │   ├── migrations/         ← Numbered migration files
│   │   └── seeds/              ← Test/dev seeds
│   │
│   ├── config/
│   │   ├── env.js              ← Validated env vars (Zod schema)
│   │   ├── redis.js            ← ioredis instance
│   │   └── storage.js          ← S3 client instance
│   │
│   └── utils/
│       ├── apiResponse.js      ← Response helpers (ALWAYS use these)
│       ├── AppError.js         ← Operational error class
│       ├── hashChain.js        ← Event hash computation
│       ├── logger.js           ← pino logger instance
│       ├── pagination.js       ← Pagination helpers
│       └── auditTrail.js       ← Audit log writing helper
│
├── .env
├── .env.example
├── package.json
└── knexfile.js
```

---

## Database Migrations (Greenfield)

The project is pre-production; the development database is disposable.

- Edit the original migration or add a clean migration instead of writing a compatibility migration.
- Never write backfills, data-repair scripts, dual-write migrations, or legacy verifiers.
- When a schema change is simpler from scratch, reset the database:
  `pnpm knex migrate:rollback --all`, then `pnpm knex migrate:latest && pnpm knex seed:run`.
- Delete obsolete columns, tables, and indexes instead of keeping them for old data.
- Tests create the rows they need; never depend on seeded or pre-existing data.

---

## Frontend Project Structure

```
frontend/src/
├── main.jsx              ← Vite entry point
├── App.jsx               ← Route definitions
│
├── lib/
│   ├── api.js            ← Axios instance (BASE URL, auth header, interceptors)
│   ├── queryClient.js    ← React Query client config
│   └── utils.js          ← shadcn/ui clsx+tailwind-merge util
│
├── api/                  ← React Query hooks (named: useGetXxx, useCreateXxx)
│   ├── auth.api.js
│   ├── lots.api.js
│   ├── events.api.js
│   ├── locations.api.js
│   ├── products.api.js
│   ├── trace.api.js
│   ├── imports.api.js
│   ├── reports.api.js
│   └── dashboard.api.js
│
├── stores/               ← Zustand (auth session + UI state ONLY)
│   ├── auth.store.js
│   └── ui.store.js
│
├── components/           ← Shared/reusable components
│   ├── ui/               ← shadcn/ui auto-generated (never edit manually)
│   ├── layout/
│   │   ├── AppLayout.jsx
│   │   ├── AuthLayout.jsx
│   │   └── Sidebar.jsx
│   ├── common/
│   │   ├── DataTable.jsx       ← Wrapper around @tanstack/react-table
│   │   ├── PageHeader.jsx
│   │   ├── StatusBadge.jsx
│   │   ├── EmptyState.jsx
│   │   ├── LoadingSpinner.jsx
│   │   ├── ConfirmDialog.jsx
│   │   └── FormField.jsx       ← Label + Input + Error wrapper
│   └── forms/
│       └── LotSelector.jsx     ← Reusable lot search/select
│
├── features/             ← Feature-specific components (not reused elsewhere)
│   ├── auth/
│   ├── lots/
│   ├── events/
│   ├── trace/
│   ├── imports/
│   ├── reports/
│   └── dashboard/
│
├── pages/                ← Route-level components (lazy loaded)
│   ├── auth/
│   │   ├── LoginPage.jsx
│   │   ├── RegisterPage.jsx
│   │   └── ForgotPasswordPage.jsx
│   ├── DashboardPage.jsx
│   ├── lots/
│   │   ├── LotsListPage.jsx
│   │   └── LotDetailPage.jsx
│   ├── events/
│   │   └── RecordEventPage.jsx
│   ├── trace/
│   │   └── TracePage.jsx
│   └── ...
│
├── hooks/               ← Custom reusable hooks
│   ├── useDebounce.js
│   ├── usePermissions.js
│   └── useLocalStorage.js
│
└── utils/
    ├── formatDate.js    ← Date formatting with date-fns
    ├── formatLot.js
    └── permissions.js   ← Permission check helpers
```

---

## JavaScript Patterns

### No TypeScript — JSDoc for Critical Functions
```javascript
// Use JSDoc on service functions and complex utilities
/**
 * Creates a new lot
 * @param {{ traceabilityLotCode: string, productId: string, quantity: number, uom: string }} data
 * @param {string} organizationId
 * @param {string} userId
 * @returns {Promise<Object>} Created lot
 */
const createLot = async (data, organizationId, userId) => { ... };
```

### Module Pattern (CommonJS — Backend)
```javascript
// Always module.exports, never ES modules in backend
const lotsService = require('./lots.service');
module.exports = { createLot, getLot };
```

### ES Modules (Frontend)
```javascript
// Frontend uses ES modules (Vite handles it)
import { useQuery } from '@tanstack/react-query';
export const useGetLots = (params) => { ... };
```

### AppError — Operational Errors
```javascript
// backend/src/utils/AppError.js
class AppError extends Error {
  constructor(message, code, statusCode, details = null) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

// Usage in service:
throw new AppError('Lot not found', 'NOT_FOUND', 404);
throw new AppError('Lot is voided', 'LOT_VOIDED', 409);
```

### Validation Middleware Pattern
```javascript
// middleware/validate.js
const validate = (schema) => (req, res, next) => {
  try {
    req.validatedBody = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
      return apiResponse.validationError(res, details);
    }
    next(err);
  }
};

// Usage in routes:
router.post('/', validate(createLotSchema), lotsController.createLot);
// Controller then uses req.validatedBody (already validated + typed)
```

### React Query Hook Pattern (Frontend)
```javascript
// api/lots.api.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export const LOTS_KEYS = {
  all: ['lots'],
  list: (params) => ['lots', 'list', params],
  detail: (id) => ['lots', 'detail', id],
};

export const useGetLots = (params) => {
  return useQuery({
    queryKey: LOTS_KEYS.list(params),
    queryFn: async () => {
      const { data } = await api.get('/lots', { params });
      return data; // returns { success, data, pagination }
    },
  });
};

export const useCreateLot = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post('/lots', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LOTS_KEYS.all }),
  });
};
```

### Zustand Store Pattern (Frontend)
```javascript
// stores/auth.store.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: (user, accessToken) => set({ user, accessToken }),
      clearAuth: () => set({ user: null, accessToken: null }),
    }),
    { name: 'auth-storage' }
  )
);
```

---

## React Component Rules

### Always Named Exports (exception: Pages can use default for lazy loading)
```javascript
// ✅ Correct
export const LotCard = ({ lot }) => { ... };

// Pages use default (for React.lazy)
const LotsListPage = () => { ... };
export default LotsListPage;
```

### Every Component Has This Structure
```jsx
// 1. Imports
import { useState } from 'react';
import { Button } from '@/components/ui/button';

// 2. Component
export const LotCard = ({ lot, onVoid }) => {
  // 3. Hooks at top
  // 4. Event handlers
  // 5. Render
  return ( ... );
};

// 6. Prop validation (JSDoc)
/**
 * @param {{ lot: Object, onVoid: Function }} props
 */
```

### Always Handle Three States in Data Components
```jsx
const LotsListPage = () => {
  const { data, isLoading, isError } = useGetLots();

  if (isLoading) return <LoadingSkeleton />;
  if (isError) return <ErrorState />;
  if (!data?.data?.length) return <EmptyState title="No lots yet" description="Create your first lot to get started" />;

  return <DataTable data={data.data} ... />;
};
```

---

## Naming Conventions Quick Reference

| Thing | Convention | Example |
|-------|-----------|---------|
| DB tables | `snake_case` plural | `event_lot_links` |
| DB columns | `snake_case` | `organization_id` |
| API query params | `camelCase` | `?productId=...&dateFrom=...` |
| API response fields | `camelCase` | `{ "organizationId": "..." }` |
| JS variables/functions | `camelCase` | `const organizationId = ...` |
| JS constants | `UPPER_SNAKE_CASE` | `const MAX_IMPORT_SIZE = ...` |
| React components | `PascalCase` | `LotDetailCard` |
| CSS classes | Tailwind only, no custom | `className="flex items-center gap-2"` |
| Env vars | `UPPER_SNAKE_CASE` | `DATABASE_URL` |
| Git branches | `type/description` | `feat/lot-void`, `fix/trace-cycle` |

---

## Git Commit Format
```
type(scope): short description

Types: feat | fix | refactor | docs | test | chore | style
Scope: auth | lots | events | trace | ui | db | jobs | imports

Examples:
feat(lots): add lot void with reason
fix(trace): handle cycle detection in recursive CTE
refactor(auth): extract token refresh to service
docs(api): update event endpoint examples
test(lots): add cross-tenant access test
chore(deps): update knex to 3.1.0
```

---

## Environment Variable Access (Backend)
All env vars are accessed through `config/env.js` — never `process.env.X` directly in modules:
```javascript
// config/env.js
const { z } = require('zod');

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ACCESS_JWT_SECRET: z.string().min(64),
  // ... all required vars
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
});

const env = envSchema.parse(process.env);
module.exports = env;

// Usage: const env = require('../config/env');
// env.DATABASE_URL, env.PORT, etc.
```
