# LotTrace — Development Environment Setup

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20.x LTS | https://nodejs.org or `nvm install 20` |
| pnpm | 8.x+ | `npm install -g pnpm` |
| Docker & Docker Compose | latest | https://docs.docker.com/get-docker/ |
| Git | any | pre-installed on most systems |

---

## First-Time Setup

### 1. Clone and install dependencies
```bash
git clone https://github.com/your-org/lottrace.git
cd lottrace
pnpm install         # installs all workspaces (backend + frontend + scan-pwa)
```

### 2. Start infrastructure (PostgreSQL + Redis + MinIO)
```bash
cp .env.example .env
# Fill every blank secret in .env, for example:
#   openssl rand -hex 24
docker compose up -d
# PostgreSQL: 127.0.0.1:5432  (credentials from .env)
# Redis:      127.0.0.1:6379  (password from .env)
# MinIO:      127.0.0.1:9000  (console: 127.0.0.1:9001)
```

Compose refuses to start when a required password is blank. Every port is
bound to `127.0.0.1`. Start the optional admin consoles only when needed:
```bash
docker compose --profile tools up -d
```

### 3. Set up environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp scan-pwa/.env.example scan-pwa/.env
# Edit backend/.env with your values. The PostgreSQL, Redis, and MinIO
# credentials must match the root .env used by docker-compose.yml.
```

### 4. Run database migrations + seeds
```bash
cd backend
pnpm knex migrate:latest
pnpm knex seed:run
```

The seed is safe by default:

- It refuses `NODE_ENV=production`.
- Local hosts (`localhost`, `127.0.0.1`, `::1`, `postgres`) run directly.
- Remote hosts require `ALLOW_DESTRUCTIVE_SEED=true` plus interactive confirmation.
  In a non-interactive shell, also set `SEED_CONFIRM_REMOTE=true`.
- It no longer truncates. Reruns preserve existing rows and passwords.
- On first insert it prints a generated super-admin password once. Set
  `SEED_SUPER_ADMIN_PASSWORD` to choose the password instead. Setting it on a
  later run resets the password.

> **Development database is disposable.** This project is pre-production. When a
> schema change is simpler from scratch, reset the database
> (`pnpm knex migrate:rollback --all`, or drop/recreate) and run
> `pnpm knex migrate:latest && pnpm knex seed:run`. Do not write backfill or
> compatibility migrations; edit the original migration or add a clean one.

### 5. Start all services
```bash
# From project root:
pnpm dev
# Starts: backend:3000 + frontend:3001 + scan-pwa:3002
```

---

## Environment Variables

### `backend/.env`
```bash
# Database
DATABASE_URL=postgresql://lottrace:<postgres-password>@127.0.0.1:5432/lottrace
# TLS is controlled by DATABASE_URL: use ?sslmode=require (or ?ssl=true) to enable it.
# Certificate verification is ON by default. Provide the provider CA if it is not
# in Node's trust store. Set only one of these:
# DB_SSL_CA_PATH=/path/to/ca.pem
# DB_SSL_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
# Local development only. Rejected in staging/production.
# DB_TLS_INSECURE=false

# Redis
REDIS_URL=redis://:<redis-password>@127.0.0.1:6379

# JWT (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ACCESS_JWT_SECRET=<64-char-random-hex>
REFRESH_JWT_SECRET=<64-char-random-hex-different-from-above>
REFRESH_TOKEN_ENCRYPTION_KEY=<64-char-random-hex>
ARGON2_SECRET=<32-char-random-hex>

# Hash chain HMAC keyring (required; signing keys stay out of the database)
HASH_CHAIN_KEY_ID=dev-k1
HASH_CHAIN_SECRET=<64-char-random-hex>
# Optional previous keys for verification after rotation: {"dev-k0":"<64-char hex>"}
HASH_CHAIN_OLD_KEYS=

# Object Storage (use local MinIO for dev, R2 for prod)
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<minio-root-user>
S3_SECRET_ACCESS_KEY=<minio-root-password>
S3_BUCKET=lottrace-dev

# Email (Resend for prod; EMAIL_DRY_RUN=true for local)
RESEND_API_KEY=re_your_api_key_here
EMAIL_FROM=LotTrace <onboarding@resend.dev>
DEV_EMAIL_OVERRIDE=developer@example.com
EMAIL_DRY_RUN=true

# App
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3001
# Local PWA origin for credentialed CORS. Use the deployed PWA URL only in
# deployment environments.
SCAN_PWA_URL=http://localhost:3002
# Express `trust proxy` setting. Leave empty when the API is directly exposed.
# Behind a proxy, set the exact hop count or a comma-separated trusted CIDR
# list. Never set this to true; invalid values fail startup.
TRUST_PROXY=
# TRUST_PROXY=1
# TRUST_PROXY=loopback
# TRUST_PROXY=10.0.0.0/8,192.168.0.0/16

# Stripe (use test keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Sentry (optional in dev)
SENTRY_DSN=
```

> `REFRESH_TOKEN_ENCRYPTION_KEY`, `HASH_CHAIN_KEY_ID`, and `HASH_CHAIN_SECRET`
> are required. The backend validates them at startup and refuses to run when
> they are missing or too short. Keep the real values in the ignored
> `backend/.env`; never commit them.
>
> The database, Redis, and MinIO placeholders must match the values in the root
> `.env`. In `staging` and `production`, the backend also refuses to start when
> `DATABASE_URL`, `REDIS_URL`, or the S3 credentials are missing or still use a
> known local default.

### `frontend/.env`
```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_SENTRY_DSN=
```

`VITE_SENTRY_DSN` is read at build time. Leave it empty to disable browser error
reporting; the Sentry SDK chunk is not loaded when the DSN is empty.

### `scan-pwa/.env`
```bash
VITE_API_BASE_URL=http://localhost:3000
```

---

## Docker Compose (`docker-compose.yml`)

All services are defined in the root `docker-compose.yml`. Compose reads
credentials from the untracked root `.env`; copy `.env.example` first and fill
every blank secret.

Services:
- **postgres** — primary database (`127.0.0.1:5432`)
- **redis** — cache + BullMQ (`127.0.0.1:6379`, password required)
- **minio** — local S3-compatible storage (`127.0.0.1:9000`, console: `127.0.0.1:9001`)
- **pgadmin** — optional database console (`127.0.0.1:5050`, `--profile tools`)
- **redisinsight** — optional Redis console (`127.0.0.1:5540`, `--profile tools`)

Every published port is bound to `127.0.0.1`. The compose stack is for local
development only; never reuse its credentials in staging or production.

---

## Daily Development Commands

```bash
# Start all services
pnpm dev

# Start individual services
pnpm --filter backend dev
pnpm --filter frontend dev
pnpm --filter scan-pwa dev

# Run backend tests
pnpm --filter backend test
pnpm --filter backend test:watch

# Run a specific test file
pnpm --filter backend test src/modules/lots/lots.service.test.js

# Knex migrations
cd backend
pnpm knex migrate:latest          # run pending migrations
pnpm knex migrate:rollback        # roll back last batch
pnpm knex migrate:status          # show migration status
pnpm knex seed:run                # seed dev data (refuses production; no truncate)
pnpm knex migrate:make <name>     # create new migration

# Lint + format
pnpm lint          # lint all workspaces
pnpm format        # format all workspaces
pnpm lint:fix      # auto-fix lint issues

# Docker
docker compose up -d              # start infrastructure
docker compose down               # stop infrastructure
docker compose logs -f postgres   # watch postgres logs
docker compose exec postgres psql -U lottrace  # open psql

# Add a shadcn component (run inside /frontend or /scan-pwa)
pnpm --filter frontend dlx shadcn@latest add button
```

---

## Monorepo Structure

```
lottrace/
├── package.json              ← root workspace config
├── pnpm-workspace.yaml       ← workspace definitions
├── docker-compose.yml        ← infrastructure
├── .eslintrc.js              ← shared ESLint config
├── .prettierrc               ← shared Prettier config
├── .gitignore
│
├── backend/                  ← Node.js + Express API
├── frontend/                 ← React dashboard
└── scan-pwa/                 ← React PWA for scanning
```

---

## Seeded Development Data

After `pnpm knex seed:run`, the current seed creates only the system super admin.

> The demo accounts below are stale and tracked by `P2-08`. Do not rely on them.

| Email | Password | Role |
|-------|---------|------|
| admin@demo.com | Password123! | org_admin |
| compliance@demo.com | Password123! | compliance_manager |
| operator@demo.com | Password123! | operator |
| auditor@demo.com | Password123! | auditor |
| admin@lottrace.com | Printed once at seed time, or `SEED_SUPER_ADMIN_PASSWORD` | super_admin |

Org: **LotTrace System** (slug: `lottrace-system`)

The seed is idempotent. It preserves existing rows and does not reset an existing
password unless `SEED_SUPER_ADMIN_PASSWORD` is set.

---

## Accessing Local Tools

| Tool | URL | Credentials |
|------|-----|-------------|
| API | http://localhost:3000 | — |
| Frontend | http://localhost:3001 | — |
| Scan PWA | http://localhost:3002 | — |
| MinIO Console | http://127.0.0.1:9001 | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from root `.env` |
| pgAdmin (optional) | http://127.0.0.1:5050 | `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` from root `.env` |
| Redis Insight (optional) | http://127.0.0.1:5540 | Connect with `REDIS_PASSWORD` from root `.env` |

---

## Troubleshooting

### `pnpm install` fails
```bash
node -v  # must be 20.x
npm install -g pnpm@latest
```

### Port already in use
```bash
lsof -i :3000   # find what's using port 3000
kill -9 <PID>
```

### Database connection refused
```bash
docker compose ps          # check postgres is running
docker compose up -d postgres
```

### Migrations fail
```bash
cd backend
pnpm knex migrate:status   # see which migration failed
# Fix the migration file, then:
pnpm knex migrate:rollback
pnpm knex migrate:latest
```

### Camera doesn't work in Scan PWA
- Camera requires HTTPS or localhost
- Test at http://localhost:3002 (works on localhost)
- On a real device: expose via `ngrok http 3002` (gets HTTPS URL)
