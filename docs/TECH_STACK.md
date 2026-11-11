# LotTrace — Tech Stack & Approved Packages

> **RULE: Never add a package not in this file without updating it first.**
> If you think a package is needed, update this doc and note why, then proceed.

---

## Backend (`/backend`) — Node.js + Express + JavaScript

### Core Framework
| Package | Version | Why |
|---------|---------|-----|
| `express` | ^4.18.x | REST API framework |
| `express-async-errors` | ^3.1.x | Removes need for try/catch in every controller |
| `helmet` | ^7.x | HTTP security headers |
| `cors` | ^2.8.x | CORS handling |
| `compression` | ^1.7.x | Gzip response compression |

### Database
| Package | Version | Why |
|---------|---------|-----|
| `pg` | ^8.11.x | PostgreSQL client (node-postgres) |
| `knex` | ^3.x | SQL query builder — chosen over Prisma for: recursive CTEs in trace engine, JS-first (no TS type generation needed), tighter SQL control, JSONB operators |
| `knex-paginate` | ^2.x | Cursor/offset pagination helpers |

> **Why NOT Prisma?** Prisma's main advantage is TypeScript type generation. Since this project uses JavaScript, that advantage disappears. Knex gives us full SQL control needed for the trace engine's recursive CTEs and PostgreSQL-specific JSONB operations.
> **Why NOT MongoDB?** PostgreSQL JSONB covers all flexible KDE payload needs AND gives us relational integrity, recursive CTEs for trace queries, and RLS for multi-tenant security in one system.

### Authentication & Security
| Package | Version | Why |
|---------|---------|-----|
| `jsonwebtoken` | ^9.x | JWT access tokens (15min expiry) |
| `argon2` | ^0.31.x | Password hashing — preferred over bcrypt for security |
| `uuid` | ^9.x | Generate UUIDs for all entity IDs |
| `crypto` | built-in | HMAC-SHA256 for the keyed event hash chain |

### Validation
| Package | Version | Why |
|---------|---------|-----|
| `zod` | ^3.x | Schema validation for all request bodies and params |

### Background Jobs
| Package | Version | Why |
|---------|---------|-----|
| `bullmq` | ^5.x | Job queues built on Redis — used for imports, exports, hash-verify, email, webhooks |
| `ioredis` | ^5.x | Redis client (used by BullMQ and for direct caching/rate-limiting) |

### File Handling
| Package | Version | Why |
|---------|---------|-----|
| `multer` | ^1.4.x | Multipart upload handling |
| `@aws-sdk/client-s3` | ^3.x | S3/R2 object storage |
| `@aws-sdk/s3-request-presigner` | ^3.x | Presigned URL generation |
| `csv-parse` | ^5.x | Stream CSV parsing for bulk import |
| `csv-stringify` | ^6.x | CSV export generation |

### HTTP & Communication
| Package | Version | Why |
|---------|---------|-----|
| `axios` | ^1.x | HTTP client for outbound requests (webhooks, internal) |
| `resend` | ^3.x | Transactional email provider for invites and notifications |
| `nodemailer` | ^6.x | Email sending (works with any SMTP/API) |

### Logging & Monitoring
| Package | Version | Why |
|---------|---------|-----|
| `pino` | ^8.x | Structured JSON logging (fast, production-ready) |
| `pino-http` | ^9.x | HTTP request logging middleware |
| `@sentry/node` | ^7.x | Error tracking |

### Rate Limiting
| Package | Version | Why |
|---------|---------|-----|
| `express-rate-limit` | ^7.x | Rate limiting middleware |
| `rate-limit-redis` | ^4.x | Redis store for distributed rate limiting |

### PDF Generation (exports)
| Package | Version | Why |
|---------|---------|-----|
| `pdfkit` | ^0.14.x | PDF report generation in background job |

### Utilities
| Package | Version | Why |
|---------|---------|-----|
| `dotenv` | ^16.x | Environment variable loading |
| `date-fns` | ^3.x | Date manipulation — NO moment.js, NO dayjs |
| `date-fns-tz` | ^3.x | Timezone-aware date handling (critical for multi-location orgs) |
| `lodash` | ^4.x | Utility functions (cloneDeep, chunk, groupBy, etc.) |

### Dev Dependencies (Backend)
| Package | Version | Why |
|---------|---------|-----|
| `jest` | ^29.x | Unit + integration testing |
| `supertest` | ^6.x | HTTP endpoint testing |
| `nodemon` | ^3.x | Dev auto-restart |
| `eslint` | ^8.x | Linting |
| `prettier` | ^3.x | Code formatting |

---

## Frontend (`/frontend`) — React + Vite + JavaScript

### Core Framework
| Package | Version | Why |
|---------|---------|-----|
| `react` | ^18.x | UI framework |
| `react-dom` | ^18.x | React DOM renderer |
| `vite` | ^5.x | Build tool |
| `@vitejs/plugin-react` | ^4.x | Vite React plugin |

### Routing
| Package | Version | Why |
|---------|---------|-----|
| `react-router-dom` | ^6.x | Client-side routing |

### State Management
| Package | Version | Why |
|---------|---------|-----|
| `zustand` | ^4.x | Global UI state (auth user, sidebar, theme) — lightweight, no boilerplate |
| `@tanstack/react-query` | ^5.x | Server state — ALL API data fetching/caching/mutation |

> **Rule:** Zustand ONLY for: auth session, UI preferences (sidebar open/closed, theme).
> ALL data from the API goes through React Query (useGetLots, useCreateEvent, etc.)
> NEVER store API response data in Zustand.

### HTTP Client
| Package | Version | Why |
|---------|---------|-----|
| `axios` | ^1.x | HTTP client — ONLY import from `src/lib/api.js` (pre-configured instance) |

> **NEVER use `fetch()` directly.** Always use the axios instance from `src/lib/api.js`.
> It handles: base URL, auth header injection, token refresh on 401, response unwrapping.

### Forms & Validation
| Package | Version | Why |
|---------|---------|-----|
| `react-hook-form` | ^7.x | Form state management — ALL forms use this |
| `zod` | ^3.x | Schema validation — ALL schemas defined with Zod |
| `@hookform/resolvers` | ^3.x | Connects Zod schemas to react-hook-form |

### UI Components & Styling
| Package | Version | Why |
|---------|---------|-----|
| `tailwindcss` | ^3.x | Utility-first CSS — NO inline styles, NO CSS modules |
| `shadcn/ui` | latest | Component library built on Radix UI — run `npx shadcn-ui@latest add [component]` |
| `@radix-ui/react-*` | various | Underlying Radix primitives (via shadcn) |
| `lucide-react` | ^0.4xx | Icons — NO heroicons, NO FontAwesome, NO emoji as icons |
| `clsx` | ^2.x | Conditional className merging |
| `tailwind-merge` | ^2.x | Tailwind class conflict resolution |
| `class-variance-authority` | ^0.7.x | Component variants (via shadcn) |

### Data Visualization
| Package | Version | Why |
|---------|---------|-----|
| `recharts` | ^2.x | Dashboard charts (bar, line, pie) |

### Tables
| Package | Version | Why |
|---------|---------|-----|
| `@tanstack/react-table` | ^8.x | Headless table with sorting, filtering, pagination |

### Dates
| Package | Version | Why |
|---------|---------|-----|
| `date-fns` | ^3.x | Date formatting/manipulation — NO moment.js |
| `date-fns-tz` | ^3.x | Timezone display (show dates in location's local time) |

### Notifications & Feedback
| Package | Version | Why |
|---------|---------|-----|
| `sonner` | ^1.x | Toast notifications |

### Barcode Scanning (Frontend — loaded only in PWA)
| Package | Version | Why |
|---------|---------|-----|
| `@zxing/library` | ^0.19.x | Browser-based barcode/QR scanning via camera |

### File Handling
| Package | Version | Why |
|---------|---------|-----|
| `papaparse` | ^5.x | Client-side CSV parsing (template preview before upload) |

### Dev Dependencies (Frontend)
| Package | Version | Why |
|---------|---------|-----|
| `@vitejs/plugin-react` | ^4.x | JSX transform |
| `vite-plugin-pwa` | ^0.19.x | PWA manifest + service worker (scan-pwa only) |
| `eslint` | ^8.x | Linting |
| `prettier` | ^3.x | Formatting |
| `vitest` | ^1.x | Unit testing |
| `@testing-library/react` | ^14.x | Component testing |
| `@playwright/test` | ^1.x | E2E testing |

---

## Package Rules — Enforced

### ✅ Allowed — Always Use These
| Task | Use This |
|------|---------|
| HTTP calls (frontend) | `axios` via `src/lib/api.js` |
| HTTP calls (backend outbound) | `axios` |
| Date formatting | `date-fns` |
| Timezone handling | `date-fns-tz` |
| Icons | `lucide-react` |
| Global state | `zustand` |
| Server/API state | `@tanstack/react-query` |
| Forms | `react-hook-form` |
| Validation | `zod` |
| Toast/notifications | `sonner` |
| Logging (backend) | `pino` |
| Job queues | `bullmq` |
| Redis client | `ioredis` |
| UUIDs | `uuid` |

### ❌ Banned — Never Use These
| Banned | Use Instead |
|--------|------------|
| `fetch()` | `axios` |
| `moment.js` | `date-fns` |
| `dayjs` | `date-fns` |
| `redux` / `redux-toolkit` | `zustand` + `react-query` |
| `react-query v3/v4` | `@tanstack/react-query` v5 |
| `sequelize` | `knex` |
| `mongoose` | `knex` + `pg` |
| `bcrypt` / `bcryptjs` | `argon2` |
| `request` / `node-fetch` | `axios` |
| TypeScript | JavaScript + JSDoc |
| CSS modules | Tailwind |
| Inline styles | Tailwind |
| `heroicons` | `lucide-react` |
| `react-icons` | `lucide-react` |
| `npm` / `yarn` | `pnpm` |

---

## Package Manager
**pnpm** — always use pnpm, never npm or yarn directly.

```bash
# Install
pnpm install

# Add package to specific workspace
pnpm add --filter backend express
pnpm add --filter frontend axios

# Add dev dependency
pnpm add -D --filter backend jest

# Run scripts
pnpm --filter backend dev
pnpm --filter frontend dev
pnpm dev  # runs all via workspace root concurrently
```