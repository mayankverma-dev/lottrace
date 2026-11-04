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

### 2. Start infrastructure (PostgreSQL + Redis)
```bash
docker-compose up -d
# PostgreSQL: localhost:5432  (user: lottrace, pass: lottrace, db: lottrace)
# Redis:      localhost:6379
```

### 3. Set up environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp scan-pwa/.env.example scan-pwa/.env
# Edit backend/.env with your values
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
DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace

# Redis
REDIS_URL=redis://localhost:6379

# JWT (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ACCESS_JWT_SECRET=<64-char-random-hex>
REFRESH_JWT_SECRET=<64-char-random-hex-different-from-above>
ARGON2_SECRET=<32-char-random-hex>

# Object Storage (use local MinIO for dev, R2 for prod)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=lottrace-dev

# Email (Resend for prod, Mailpit for dev)
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_FROM=noreply@lottrace.local

# App
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3001
SCAN_PWA_URL=http://localhost:3002

# Stripe (use test keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Sentry (optional in dev)
SENTRY_DSN=
```

### `frontend/.env`
```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_SENTRY_DSN=
```

### `scan-pwa/.env`
```bash
VITE_API_BASE_URL=http://localhost:3000
```

---

## Docker Compose (`docker-compose.yml`)

All services defined in the root `docker-compose.yml`.
Run `docker-compose up -d` to start all infrastructure.

Services:
- **postgres** — primary database (port 5432)
- **redis** — cache + BullMQ (port 6379)
- **minio** — local S3-compatible storage (port 9000, console: 9001)
- **mailpit** — local email catch (SMTP: 1025, UI: 8025)

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
docker-compose up -d              # start infrastructure
docker-compose down               # stop infrastructure
docker-compose logs -f postgres   # watch postgres logs
docker-compose exec postgres psql -U lottrace  # open psql

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
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| Mailpit (emails) | http://localhost:8025 | — |
| Redis Insight (optional) | http://localhost:8001 | — |

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
docker-compose ps          # check postgres is running
docker-compose up -d postgres
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
