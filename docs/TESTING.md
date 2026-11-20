# LotTrace — Testing Strategy

---

## Test Pyramid

```
         /─────────────────\
        /   E2E Tests        \     ← Playwright (3–5 critical paths)
       /─────────────────────\
      /  Integration Tests    \    ← Supertest API tests (main coverage)
     /─────────────────────────\
    /     Unit Tests            \  ← Jest (services, utils, validators)
   /─────────────────────────────\
```

### Coverage Targets
| Layer | Tool | Target |
|-------|------|--------|
| Backend unit (services, utils) | Jest | 80%+ |
| Backend integration (API endpoints) | Supertest | All endpoints |
| Frontend component | Vitest + Testing Library | Critical forms |
| E2E (user flows) | Playwright | 5 core flows |

---

## Backend Testing (Jest + Supertest)

### Setup
```bash
cd backend
pnpm test          # run all
pnpm test:watch    # watch mode
pnpm test:coverage # with coverage report
```

### File Location Convention
```
src/modules/lots/
├── lots.routes.js
├── lots.controller.js
├── lots.service.js
├── lots.validation.js
├── lots.service.test.js      ← Unit test for service
└── lots.routes.test.js       ← Integration test (full HTTP)
```

### Test Database
- Separate test database: `lottrace_test`
- Each test file creates fresh data using helpers
- Tests run in transactions that are rolled back after each test
- OR: each test suite truncates its relevant tables before running

```javascript
// test/helpers/db.js
const db = require('../../src/db/knex');

const truncate = async (...tables) => {
  await db.raw(`TRUNCATE TABLE ${tables.join(', ')} CASCADE`);
};

const setupTestOrg = async () => {
  const [org] = await db('organizations').insert({
    id: uuid(), name: 'Test Org', slug: 'test-org', status: 'active',
  }).returning('*');
  const [user] = await db('users').insert({
    id: uuid(), organization_id: org.id, first_name: 'Test', last_name: 'User',
    email: 'test@test.com', role: 'org_admin', status: 'active',
    password_hash: await argon2.hash('password123'),
  }).returning('*');
  return { org, user };
};
```

### Integration Test Pattern (Supertest)
```javascript
// lots.routes.test.js
const request = require('supertest');
const app = require('../../app');
const { setupTestOrg, getAuthToken, truncate } = require('../../../test/helpers');

describe('Lots API', () => {
  let org, user, token;

  beforeAll(async () => {
    ({ org, user } = await setupTestOrg());
    token = await getAuthToken(user);
  });

  afterAll(async () => {
    await truncate('event_lot_links', 'events', 'lots', 'products', 'users', 'organizations');
  });

  describe('POST /api/v1/lots', () => {
    it('creates a lot successfully', async () => {
      const product = await createTestProduct(org.id);
      const res = await request(app)
        .post('/api/v1/lots')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product.id, traceabilityLotCode: 'LOT-001', quantity: 100, uom: 'kg' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.traceabilityLotCode).toBe('LOT-001');
    });

    it('returns 401 without auth token', async () => {
      const res = await request(app).post('/api/v1/lots').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 422 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/lots')
        .set('Authorization', `Bearer ${token}`)
        .send({ traceabilityLotCode: 'LOT-002' }); // missing productId, quantity, uom

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'productId' }),
          expect.objectContaining({ field: 'quantity' }),
        ])
      );
    });

    // ⚠️ CRITICAL: Cross-tenant test — must exist for every resource
    it('cannot access another org\'s product', async () => {
      const otherOrg = await createTestOrg();
      const otherProduct = await createTestProduct(otherOrg.id);

      const res = await request(app)
        .post('/api/v1/lots')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: otherProduct.id, traceabilityLotCode: 'LOT-HACK', quantity: 1, uom: 'kg' });

      // Should be 404 (not 403 — don't confirm other org's resource exists)
      expect(res.status).toBe(404);
    });
  });
});
```

### Unit Test Pattern (Service)
```javascript
// lots.service.test.js
const { createLot } = require('./lots.service');
const db = require('../../db/knex');
const AppError = require('../../utils/AppError');

jest.mock('../../db/knex');

describe('lotsService.createLot', () => {
  it('throws NOT_FOUND if product does not belong to org', async () => {
    db.mockReturnValue({ where: () => ({ first: () => null }) });  // product not found
    await expect(createLot({ productId: 'uuid-1' }, 'org-1', 'user-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

---

## Critical Tests to Always Write

### 1. Cross-Tenant Isolation (every resource)
```javascript
it('[SECURITY] user from org A cannot read org B resource', async () => {
  const res = await request(app)
    .get(`/api/v1/lots/${orgBLotId}`)
    .set('Authorization', `Bearer ${orgAToken}`);
  expect(res.status).toBe(404);  // NOT 403
});
```

### 2. Auth Required (every protected route)
```javascript
it('returns 401 without token', async () => {
  const res = await request(app).get('/api/v1/lots');
  expect(res.status).toBe(401);
});
```

### 3. Validation Errors (every POST/PATCH body)
```javascript
it('returns 422 with field details for invalid body', async () => {
  const res = await request(app)
    .post('/api/v1/lots')
    .set('Authorization', `Bearer ${token}`)
    .send({});  // empty body
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(Array.isArray(res.body.error.details)).toBe(true);
});
```

### 4. Role Restrictions (protected actions)
```javascript
it('operator cannot void a lot', async () => {
  const res = await request(app)
    .post(`/api/v1/lots/${lotId}/void`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ reason: 'test' });
  expect(res.status).toBe(403);
});
```

### 5. Response Shape (API contract)
```javascript
it('response matches API standards envelope', async () => {
  const res = await request(app).get('/api/v1/lots').set('Authorization', `Bearer ${token}`);
  expect(res.body).toMatchObject({
    success: true,
    message: expect.any(String),
    data: expect.any(Array),
    pagination: expect.objectContaining({
      total: expect.any(Number),
      page: expect.any(Number),
      limit: expect.any(Number),
    }),
  });
});
```

---

## Trace Engine Tests (Critical)

```javascript
describe('Trace Engine', () => {
  it('forward trace follows transformation output links', async () => {
    // Setup: Lot A → (transformation) → Lot B
    const lotA = await createLot();
    const lotB = await createLot();
    await createTransformationEvent({ inputs: [lotA], outputs: [lotB] });

    const res = await request(app).get(`/api/v1/trace/${lotA.id}/forward`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: lotA.id, hop: 0 }),
      expect.objectContaining({ id: lotB.id, hop: 1 }),
    ]));
  });

  it('backward trace finds all input lots for transformation', async () => {
    // Lot A + Lot B → (transformation) → Lot C
    const backward = await request(app).get(`/api/v1/trace/${lotC.id}/backward`)...;
    expect(backward.body.data.nodes.map(n => n.id)).toContain(lotA.id);
    expect(backward.body.data.nodes.map(n => n.id)).toContain(lotB.id);
  });

  it('cycle protection: stops at max 50 hops without infinite loop', async () => {
    // Create a deep chain (not actual cycle — just deep)
    const res = await request(app).get(`/api/v1/trace/${deepLot.id}/forward`)...;
    expect(res.status).toBe(200);
  });
});
```

---

## Frontend Testing (Vitest + Testing Library)

```bash
cd frontend
pnpm test
```

### What to Test in Frontend
- Form validation (submit with invalid data → error messages shown)
- Permission gates (role X does not see button Y)
- API error handling (toast shown on mutation error)

```javascript
// features/lots/CreateLotForm.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateLotForm } from './CreateLotForm';

it('shows validation error when lot code is empty', async () => {
  render(<CreateLotForm />);
  fireEvent.click(screen.getByRole('button', { name: /create lot/i }));
  await waitFor(() => {
    expect(screen.getByText('Lot code is required')).toBeInTheDocument();
  });
});
```

---

## E2E Tests (Playwright)

### 5 Core Flows to Cover
1. Register → complete onboarding → log out → log back in
2. Create product → create lot → record creation event → view lot timeline
3. Scan lot code (mock camera) → record receiving event
4. Run trace on a lot → verify forward + backward results
5. Import CSV → view error report → re-upload corrected file

```bash
cd frontend
pnpm e2e          # run all E2E
pnpm e2e:ui       # Playwright UI mode
```

---

## Test Environment Config

```javascript
// backend/jest.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterFramework: ['./test/setup.js'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/db/migrations/**', '!src/db/seeds/**'],
  coverageThreshold: { global: { lines: 80, functions: 80 } },
};

// backend/test/setup.js
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://lottrace:REPLACE_WITH_LOCAL_PASSWORD@127.0.0.1:5432/lottrace_test';
process.env.ACCESS_JWT_SECRET = 'test-secret-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.REFRESH_JWT_SECRET = 'test-refresh-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
```
