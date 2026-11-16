# LotTrace — Security Rules

> These rules are non-negotiable. Read before touching auth, data access, or any endpoint.

---

## 1. Authentication

### JWT Tokens
- **Access token:** 15-minute expiry, signed with `ACCESS_JWT_SECRET` (min 64 chars)
- **Refresh token:** 30-day opaque UUID, stored as SHA-256 hash in `refresh_tokens` table
- **Refresh token delivery:** httpOnly, Secure, SameSite=Strict cookie — NEVER in response body
- **Access token delivery:** response body only — client stores in memory (not localStorage)

### Refresh Token Rotation
- Each call to `/auth/refresh` issues a NEW refresh token and marks the old one as `is_used = true`
- If an already-used refresh token is replayed → **invalidate ALL tokens in the same `session_family`** → force re-login → flag in audit log
- Session family: all refresh tokens issued from a single original login share one `session_family` UUID

### Token Blacklisting (Logout)
- On logout: store access token `jti` (JWT ID) in Redis with TTL = remaining token expiry
- `authenticate` middleware checks Redis blacklist before accepting token
- Every access token must include a unique `jti` claim

### Password Security
- Hash with **argon2** (not bcrypt) — use `argon2.hash()` with a secret pepper from env
- No arbitrary complexity rules (uppercase + symbol requirements) — these hurt security
- Minimum 12 characters + breached-password check (optional: haveibeenpwned API)
- Lockout: exponential backoff after N failed attempts — NOT permanent lockout
  - 3 failures: 30-second wait
  - 5 failures: 5-minute wait
  - 10 failures: 30-minute wait
  - Track attempts in Redis (`auth:attempts:{email}`, 1-hour TTL)

### Password Reset
- Token: cryptographically random 64-char hex (`crypto.randomBytes(32).toString('hex')`)
- Store: SHA-256 hash in DB, plaintext sent to email
- Expiry: 1 hour
- Single-use: delete after use
- Response: always return 200 regardless of whether email exists (prevent user enumeration)

---

## 2. Multi-Tenant Isolation

### The Golden Rule
`organization_id` comes from `req.user.organizationId` (JWT).
NEVER accept `organization_id` from request body, query params, or URL.

### Implementation Checklist
- [ ] Every DB query that reads tenant data includes `WHERE organization_id = $1`
- [ ] Cross-tenant resource access returns **404** not 403 (don't confirm existence)
- [ ] PostgreSQL RLS enabled and forced on all tenant tables as defense-in-depth
- [ ] Transaction-local `app.current_org_id` set at request start (via `tenantScope` middleware)
- [ ] Runtime API role is not the migration/table-owner role and does not have `BYPASSRLS`
- [ ] Every new table added gets RLS policy in the same migration

### Insecure Direct Object Reference (IDOR) Prevention
```javascript
// ❌ Vulnerable
const lot = await db('lots').where({ id: req.params.lotId }).first();

// ✅ Always scope to org
const lot = await db('lots').where({ id: req.params.lotId, organization_id: req.organizationId }).first();
if (!lot) throw new AppError('Lot not found', 'NOT_FOUND', 404);
```

---

## 3. Input Validation & Injection Prevention

### SQL Injection
- ALWAYS use Knex parameterized queries — never string interpolation
- `db('lots').where({ id: req.params.id })` — safe (parameterized)
- `` db.raw(`SELECT * FROM lots WHERE id = '${id}'`) `` — NEVER do this
- For raw SQL (trace CTEs): use `db.raw('... WHERE id = ?', [id])` with `?` placeholders

### XSS Prevention
- React escapes by default — never use `dangerouslySetInnerHTML`
- `helmet()` middleware sets `X-Content-Type-Options`, `X-Frame-Options`, CSP headers
- All user-supplied lot codes, notes, product names are stored/displayed as text (no HTML render)

### File Upload Security
- Validate MIME type server-side (not just file extension from client)
- Scan file header bytes, not just `Content-Type` header
- Never execute uploaded files — store in S3, serve via signed URL
- Max file size: 50MB for attachments, 100MB for CSV imports
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`,
  `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

### Rate Limiting
- Every auth endpoint rate-limited (see `docs/ARCHITECTURE.md` for limits)
- Rate limits stored in Redis (distributed, works across multiple API instances)
- Rate limit response: 429 with `Retry-After` header
- Rate limit by IP for unauthenticated routes, by `user_id` for authenticated

---

## 4. Secrets & Environment

### Secret Management Rules
- Zero secrets in code — all via environment variables
- Zero secrets in logs — pino `redact` config removes sensitive fields
- Zero secrets in Git — `.env` is in `.gitignore`, only `.env.example` is committed
- Rotate secrets without downtime: new secret added first, old accepted during transition

### Required Secret Rotation Triggers
- Suspected API key leak → revoke immediately, no downtime
- Suspected database credential leak → rotate + audit all queries in last 24h
- Suspected JWT secret leak → rotate secret + invalidate ALL sessions org-wide
- Employee offboarding → revoke their sessions and API key access

### pino Log Redaction
```javascript
// config/logger.js
const logger = pino({
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.password_hash',
            '*.token', '*.refreshToken', '*.key_hash'],
    censor: '[REDACTED]',
  },
});
```

---

## 5. API Security

### CORS
```javascript
// Only allow known origins
cors({
  origin: [process.env.FRONTEND_URL, process.env.SCAN_PWA_URL],
  credentials: true,           // needed for httpOnly cookie refresh token
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
})
```

### Helmet Headers
```javascript
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', process.env.S3_PUBLIC_URL],
      scriptSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
})
```

### Request ID
Every request gets a unique ID in `X-Request-ID` header (set by `requestId` middleware).
Logged with every log line for tracing across logs.

---

## 6. Audit & Compliance

### What Must Be Logged (audit_log)
- User invitations and role changes
- Lot void/recall
- Event amendments and voids
- Compliance export downloads (who downloaded what, when)
- API key creation and revocation
- Super-admin impersonation (with support agent identity)
- Login failures (after 3+ consecutive)
- Org suspension

### Audit Log Must Be Append-Only
- No `UPDATE` or `DELETE` on `audit_log` table in application code
- Consider DB-level trigger to prevent deletion
- Different DB user for audit writes vs. normal app (stricter permissions)

### Hash Chain Integrity
- Event `record_hash` and `prev_hash` make the event log tamper-evident
- Nightly background job re-walks the chain and alerts on any mismatch
- Hash function: SHA-256 over stable JSON serialization (see `backend/AGENTS.md`)
- A failed hash verification must be surfaced to `org_admin` and `compliance_manager`

---

## 7. Super-Admin Security

- Super-admin accounts use a separate authentication path
- Impersonation requires 2FA (TOTP) on the super-admin account
- Every impersonation action is logged with: support agent ID + impersonated user ID + action
- Impersonated actions appear in the org's audit log as `"[Support] AgentName acting as UserName"`
- Impersonation sessions are short-lived (1 hour max)
- Super-admin role is NOT set via the normal user invite flow — only via DB seed/CLI

---

## 8. Security Checklist (Before Any PR)

- [ ] No raw SQL string interpolation
- [ ] All DB queries scoped by `organization_id`
- [ ] Sensitive actions logged to `audit_log`
- [ ] New routes have `authenticate` + `requireRole`
- [ ] New file upload validates MIME type
- [ ] No secrets in response bodies
- [ ] New table has RLS policy
- [ ] Cross-tenant test added (user from Org A cannot access Org B's resource)
