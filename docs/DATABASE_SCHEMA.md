# LotTrace — Database Schema (PostgreSQL)

> **RULE:** Always reference this file before writing any DB query.
> Column names, types, indexes, and constraints are the source of truth.
> All IDs are UUID (v4). All timestamps are UTC (timestamptz).

---

## Conventions

| Rule | Detail |
|------|--------|
| ID type | `uuid DEFAULT gen_random_uuid()` |
| Timestamps | `timestamptz NOT NULL DEFAULT NOW()` — always UTC stored |
| Soft delete | `is_active BOOLEAN` or `status ENUM` — never `DELETE` rows with history |
| Tenant isolation | Every tenant-scoped table has `organization_id uuid NOT NULL REFERENCES organizations(id)` |
| JSON storage | `jsonb` for flexible KDE payloads, custom schemas, counterparty info |
| Names | `snake_case` for all column and table names |

---

## Tables

### `organizations`
The tenant entity. One row per customer company.
```sql
CREATE TABLE organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,                    -- url-friendly identifier
  industry_vertical   text NOT NULL DEFAULT 'food',           -- food | pharma | cosmetics
  plan_tier           text NOT NULL DEFAULT 'starter',        -- starter | growth | enterprise
  status              text NOT NULL DEFAULT 'active',         -- active | suspended | closed
  timezone_default    text NOT NULL DEFAULT 'UTC',            -- IANA timezone string
  uom_default         text NOT NULL DEFAULT 'kg',             -- kg | lb | units etc.
  custom_settings     jsonb NOT NULL DEFAULT '{}',            -- org-level misc config
  stripe_customer_id  text,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_organizations_status ON organizations(status);
```

---

### `users`
One row per person. Scoped to one org (v1 — multi-org membership is v2+).
```sql
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  email             text NOT NULL,
  password_hash     text,                                      -- null for SSO-only users (v2)
  role              text NOT NULL,                             -- org_admin | compliance_manager | operator | auditor | super_admin
  status            text NOT NULL DEFAULT 'invited',          -- invited | active | deactivated
  invite_token_hash text,                                      -- hash of invite token, expires
  invite_expires_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email_org ON users(email, organization_id);
CREATE INDEX idx_users_org_status ON users(organization_id, status);
CREATE INDEX idx_users_email ON users(email);                  -- for login lookup
```

**Valid roles:** `org_admin` · `compliance_manager` · `operator` · `auditor` · `super_admin`
**Status flow:** `invited` → `active` → `deactivated`

---

### `refresh_tokens`
One row per active refresh token. Enables session listing and revocation.
```sql
CREATE TABLE refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,                        -- SHA-256 of the opaque token
  session_family  uuid NOT NULL,                               -- groups tokens in a rotation chain
  device_hint     text,                                        -- "Chrome / Mac" (user-agent parsed)
  ip_address      inet,
  is_used         boolean NOT NULL DEFAULT false,              -- true after rotation
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(session_family);
```

---

### `locations`
Physical places where events happen. Includes both own locations and external partner records.
```sql
CREATE TABLE locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name            text NOT NULL,
  type            text NOT NULL,   -- farm | plant | warehouse | distributor | retailer | other
  is_external     boolean NOT NULL DEFAULT false,  -- true = counterparty/partner, no login
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  postal_code     text,
  country         text NOT NULL DEFAULT 'US',
  gln             text,            -- GS1 Global Location Number (optional)
  timezone        text,            -- IANA timezone (e.g. 'America/Chicago'), inherits org default if null
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_locations_org ON locations(organization_id);
CREATE INDEX idx_locations_org_active ON locations(organization_id, is_active);
```

---

### `products`
What is being tracked. Each product can have custom KDE fields.
```sql
CREATE TABLE products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  name                text NOT NULL,
  sku                 text,                   -- internal SKU
  gtin                text,                   -- GS1 GTIN, validated format
  category            text,                   -- free text product category
  is_ftl              boolean NOT NULL DEFAULT false,  -- on FDA Food Traceability List
  default_uom         text NOT NULL DEFAULT 'kg',
  custom_kde_schema   jsonb NOT NULL DEFAULT '[]',    -- array of {name, type, required, label}
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_org ON products(organization_id);
CREATE INDEX idx_products_org_active ON products(organization_id, is_active);
```

**`custom_kde_schema` example:**
```json
[
  { "name": "supplier_po_number", "label": "Supplier PO #", "type": "string", "required": true },
  { "name": "batch_temp_c", "label": "Batch Temp (°C)", "type": "number", "required": false }
]
```

---

### `lots`
The central unit being traced. Every event attaches to one or more lots.
```sql
CREATE TABLE lots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  product_id              uuid NOT NULL REFERENCES products(id),
  traceability_lot_code   text NOT NULL,
  quantity                numeric(15, 4) NOT NULL,
  uom                     text NOT NULL,
  status                  text NOT NULL DEFAULT 'active',  -- active | recalled | void
  void_reason             text,
  version                 integer NOT NULL DEFAULT 1,      -- optimistic concurrency
  notes                   text,
  created_by              uuid REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

-- TLC unique per org+product (not globally unique)
CREATE UNIQUE INDEX idx_lots_tlc_org_product ON lots(organization_id, product_id, traceability_lot_code)
  WHERE status != 'void';
CREATE INDEX idx_lots_org ON lots(organization_id);
CREATE INDEX idx_lots_org_status ON lots(organization_id, status);
CREATE INDEX idx_lots_product ON lots(product_id);
```

---

### `events`
**Append-only.** The core supply chain record. Never UPDATE or DELETE rows.
```sql
CREATE TABLE events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  event_type          text NOT NULL,        -- creation | receiving | transformation | shipping
  location_id         uuid REFERENCES locations(id),
  counterparty_info   jsonb,                -- external partner details (name, address, lot code as-given)
  event_datetime      timestamptz NOT NULL, -- when it physically happened (client-supplied, converted to UTC)
  recorded_by         uuid NOT NULL REFERENCES users(id),
  recorded_at         timestamptz NOT NULL DEFAULT NOW(), -- server timestamp, never client-supplied
  source              text NOT NULL DEFAULT 'manual', -- manual | scan | import | api
  kde_payload         jsonb NOT NULL DEFAULT '{}',    -- all KDE fields for this event
  compliance_gaps     jsonb,               -- [{field, message}] if required KDEs missing
  has_compliance_gaps boolean NOT NULL GENERATED ALWAYS AS (compliance_gaps IS NOT NULL AND jsonb_array_length(compliance_gaps) > 0) STORED,
  notes               text,
  idempotency_key     text UNIQUE,         -- client-provided idempotency key
  record_hash         text NOT NULL,       -- HMAC-SHA256 of the canonical event payload + prev_hash
  prev_hash           text NOT NULL,       -- hash of previous event in org's chain (or 'GENESIS')
  chain_seq           bigint NOT NULL,     -- monotonic per-org chain position (see note below)
  hash_version        smallint NOT NULL DEFAULT 3, -- payload version; only the current version is verifiable
  hash_key_id         text NOT NULL,       -- key ID used for this HMAC, resolved from the env/KMS keyring
  status              text NOT NULL DEFAULT 'active',     -- active | amended | void
  supersedes_event_id uuid REFERENCES events(id),        -- if this is an amendment
  void_reason         text,
  created_at          timestamptz NOT NULL DEFAULT NOW()
  -- NO updated_at — events are immutable
);

CREATE INDEX idx_events_org ON events(organization_id);
CREATE INDEX idx_events_org_type ON events(organization_id, event_type);
CREATE INDEX idx_events_org_datetime ON events(organization_id, event_datetime DESC);
CREATE INDEX idx_events_org_status ON events(organization_id, status);
CREATE INDEX idx_events_location ON events(location_id);
CREATE INDEX idx_events_compliance_gaps ON events(organization_id, has_compliance_gaps) WHERE has_compliance_gaps = true;
CREATE INDEX idx_events_recorded_by ON events(recorded_by);
-- Chain order + tip lookup. Unique per organization; never order the chain by created_at.
CREATE UNIQUE INDEX idx_events_org_chain_seq ON events(organization_id, chain_seq);
```

**Event status and trace** — the trace engine traverses only `status = 'active'` events.
`amended` rows (superseded by a replacement linked through `supersedes_event_id`) and `void`
rows stay available through the event endpoints and audit log, but never appear in forward,
backward, or full trace results. Lot-level `status = 'void'` does not remove the lot from a
trace; it is returned as a node with its status flag.

**Chain ordering (`events.chain_seq`)** — the hash chain is ordered by `chain_seq`, **never** by
`created_at`. `created_at` defaults to `CURRENT_TIMESTAMP`, which PostgreSQL evaluates once per
transaction (transaction start time), so a transaction that waits on the organization advisory lock
can be stamped earlier than the event it follows. Writers must:

1. `SELECT pg_advisory_xact_lock(org_lock_id)` inside the transaction,
2. read the tip with `getChainTip()` from `backend/src/utils/hashChain.js`
   (`ORDER BY chain_seq DESC`),
3. insert with `chain_seq = nextChainSeq(tip)`.

The verifier reads with `ORDER BY chain_seq ASC`. `chain_seq` may be included in the hash payload if
that makes the canonical format cleaner; there is no old-hash compatibility constraint.

Under the greenfield policy, no backfill is required: reset the development database and build the
chain from scratch. The existing P0-02 migration's `prev_hash`-following backfill is historical, not
a requirement for future schema changes.

**Hash versions** (`events.hash_version`) — writers set the current version and the verifier
treats any other value as a verification failure (`metadata.reason = 'unsupported_hash_version'`).
Under the greenfield policy only the current version must work:

| Value | Meaning | Verifiable? |
|-------|---------|-------------|
| `3` | HMAC-SHA256 over `lottrace:event:v3`, `prev_hash`, and the full immutable field set from persisted values (quantities as `numeric(15,4)` text such as `"1.0000"`, links sorted by `lot_id`, datetimes normalized to ISO-8601 UTC). The secret comes from `HASH_CHAIN_SECRET` (env/KMS, never the database); `hash_key_id` names the key. | Yes — payload, key, and chain linkage. |
| `1`, `2` | Removed with the greenfield P1-18 change. No verifier exists. | No. |

**Hash sealing** — the hash covers persisted values, so writers insert the event with
`record_hash = 'PENDING'` and `hash_key_id = 'PENDING'`, insert `event_lot_links`, then call
`sealEventHash(trx, eventId, prevHash)` inside the same transaction, which computes the HMAC from
the persisted row and links and replaces both sentinels. A conditional update
(`WHERE record_hash = 'PENDING'`) makes the hash seal-once. The row is never rewritten after commit;
there is no re-seal migration.

Do not write a re-seal migration or archive old hashes. When the payload changes, bump
`hash_version`, update the canonical serializer and verifier together, and reset the development
database.

### `event_evidence`
Append-only signed evidence for mutable facts that happen after an event is sealed: status
transitions (`void`, `amend`) and attachment additions. The chain is rooted at the parent event's
`record_hash`, so an edit to `events.status`, `events.void_reason`, or attachment metadata is
detectable without re-sealing the event. Written by
`appendEventEvidence()` in `backend/src/utils/hashChain.js`. The database enforces the
append-only rule: a `BEFORE UPDATE OR DELETE` trigger rejects every change to a sealed row. The
only permitted update is the one-time seal that replaces the `PENDING` placeholders on the row
that was just inserted.

```sql
CREATE TABLE event_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  seq             integer NOT NULL,      -- 1-based per event
  kind            text NOT NULL,         -- status_change | attachment_added
  payload         jsonb NOT NULL,        -- the mutable fact being signed
  record_hash     text NOT NULL,         -- HMAC-SHA256 over the evidence payload + prev_hash
  prev_hash       text NOT NULL,         -- event.record_hash for seq 1, else previous evidence hash
  hash_version    smallint NOT NULL DEFAULT 3,
  hash_key_id     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT idx_event_evidence_event_seq UNIQUE (event_id, seq),
  CONSTRAINT event_evidence_seq_positive CHECK (seq >= 1)
);

CREATE INDEX idx_event_evidence_org_event ON event_evidence(organization_id, event_id);

-- Append-only enforcement: sealed rows cannot be updated or deleted.
CREATE TRIGGER event_evidence_immutable
BEFORE UPDATE OR DELETE ON event_evidence
FOR EACH ROW EXECUTE FUNCTION reject_event_evidence_mutation();
```

The verifier re-walks each event's evidence chain and cross-checks the signed facts against the
materialized `events.status` / `events.void_reason` and `attachments` rows. Mismatches fail with
`evidence_chain_mismatch`, `evidence_payload_mismatch`, or `evidence_state_mismatch`.

---

### `event_lot_links`
Many-to-many between events and lots. Enables trace traversal.
```sql
CREATE TABLE event_lot_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id    uuid NOT NULL,
  lot_id      uuid NOT NULL,
  direction   text NOT NULL,       -- input | output
  quantity    numeric(15, 4),
  uom         text,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

-- Tenant-safe relationship constraints. Parent IDs are unique with their
-- organization so a link cannot cross organization boundaries.
ALTER TABLE event_lot_links
  ADD FOREIGN KEY (event_id, organization_id)
  REFERENCES events(id, organization_id),
  ADD FOREIGN KEY (lot_id, organization_id)
  REFERENCES lots(id, organization_id);

CREATE UNIQUE INDEX uq_lots_id_org ON lots(id, organization_id);
CREATE UNIQUE INDEX uq_events_id_org ON events(id, organization_id);

-- Critical indexes for the recursive trace CTEs
CREATE INDEX idx_ell_event ON event_lot_links(event_id);
CREATE INDEX idx_ell_lot ON event_lot_links(lot_id);
CREATE INDEX idx_ell_lot_direction ON event_lot_links(lot_id, direction);  -- trace traversal
CREATE INDEX idx_ell_event_direction ON event_lot_links(event_id, direction);

-- No duplicate lot+direction per event
CREATE UNIQUE INDEX idx_ell_event_lot_direction ON event_lot_links(event_id, lot_id, direction);
```

---

### `attachments`
Files attached to events or lots (photos, BOL, COA).
```sql
CREATE TABLE attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  parent_type     text NOT NULL,   -- event | lot
  parent_id       uuid NOT NULL,
  storage_key     text NOT NULL,   -- S3 object key (not full URL — URL generated via presigned)
  filename        text NOT NULL,   -- original filename
  content_type    text NOT NULL,   -- MIME type
  size_bytes      bigint,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_parent ON attachments(parent_type, parent_id);
CREATE INDEX idx_attachments_org ON attachments(organization_id);
```

---

### `audit_log`
Tracks ALL system actions (not supply chain events). Who did what, when.
```sql
CREATE TABLE audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),    -- null for platform actions
  actor_id        uuid REFERENCES users(id),            -- null for API key or system
  actor_type      text NOT NULL DEFAULT 'user',         -- user | api_key | system | super_admin
  actor_label     text,                                  -- email or API key label for display
  action          text NOT NULL,                         -- e.g. 'lot.void', 'user.invite', 'export.download'
  entity_type     text,                                  -- 'lot', 'event', 'user', etc.
  entity_id       uuid,
  before_state    jsonb,                                 -- state before action (for updates)
  after_state     jsonb,                                 -- state after action
  metadata        jsonb,                                 -- additional context (IP, user-agent, etc.)
  ip_address      inet,
  created_at      timestamptz NOT NULL DEFAULT NOW()
  -- append-only: no updated_at, no soft delete
);

CREATE INDEX idx_audit_org ON audit_log(organization_id);
CREATE INDEX idx_audit_org_created ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
```

---

### `imports`
Tracks CSV bulk import jobs.
```sql
CREATE TABLE imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  filename            text NOT NULL,
  storage_key         text NOT NULL,         -- where raw CSV is stored in S3
  cte_type            text NOT NULL,         -- creation | receiving | transformation | shipping
  status              text NOT NULL DEFAULT 'pending',  -- pending | processing | complete | failed
  total_rows          integer,
  valid_rows          integer,
  error_rows          integer,
  error_report_key    text,                  -- S3 key for error report CSV
  job_id              text,                  -- BullMQ job ID
  created_by          uuid NOT NULL REFERENCES users(id),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_imports_org ON imports(organization_id);
CREATE INDEX idx_imports_org_status ON imports(organization_id, status);
```

---

### `recall_simulations`
Saved recall simulation runs.
```sql
CREATE TABLE recall_simulations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  name                text NOT NULL,
  triggering_lot_id   uuid NOT NULL REFERENCES lots(id),
  params              jsonb NOT NULL DEFAULT '{}',    -- simulation parameters
  result_summary      jsonb,                          -- aggregated result stats
  result_storage_key  text,                           -- full result in S3 (can be large)
  status              text NOT NULL DEFAULT 'pending', -- pending | running | complete | failed
  run_by              uuid NOT NULL REFERENCES users(id),
  run_at              timestamptz NOT NULL DEFAULT NOW(),
  completed_at        timestamptz
);

CREATE INDEX idx_simulations_org ON recall_simulations(organization_id);
```

---

### `api_keys`
Scoped API keys for integrations.
```sql
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  label           text NOT NULL,
  key_prefix      text NOT NULL,     -- first 8 chars of key shown in UI (e.g. "ltk_a1b2")
  key_hash        text NOT NULL,     -- SHA-256 of full key
  scopes          text[] NOT NULL DEFAULT '{}',  -- ['read', 'write:events', etc.]
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
```

---

### `webhooks`
Outbound webhook configurations.
```sql
CREATE TABLE webhooks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  url                 text NOT NULL,
  subscribed_events   text[] NOT NULL DEFAULT '{}',  -- ['event.created', 'gap.detected']
  secret_hash         text NOT NULL,   -- HMAC secret for signature verification (store hashed)
  status              text NOT NULL DEFAULT 'active',  -- active | inactive
  failure_count       integer NOT NULL DEFAULT 0,
  last_triggered_at   timestamptz,
  last_success_at     timestamptz,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_org ON webhooks(organization_id, status);
```

---

### `notifications`
In-app notifications for users.
```sql
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id         uuid REFERENCES users(id),       -- null = org-wide
  type            text NOT NULL,                    -- compliance_gap | import_complete | export_ready | recall_simulation
  title           text NOT NULL,
  message         text NOT NULL,
  link            text,                             -- deep link to relevant entity
  entity_type     text,
  entity_id       uuid,
  is_read         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_org ON notifications(organization_id, created_at DESC);
```

---

### `subscriptions`
Billing and plan information.
```sql
CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL UNIQUE REFERENCES organizations(id),
  stripe_subscription_id text,
  stripe_customer_id    text,
  plan_tier             text NOT NULL DEFAULT 'starter',  -- starter | growth | enterprise
  status                text NOT NULL DEFAULT 'trialing',  -- trialing | active | past_due | canceled | paused
  location_limit        integer,         -- max locations allowed on this plan
  event_volume_limit    integer,         -- max events/month on this plan
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  trial_ends_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);
```

---

### `idempotency_keys`
Used to prevent duplicate event creation from retried requests.
```sql
CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  response_status integer NOT NULL,
  response_body   jsonb NOT NULL,
  expires_at      timestamptz NOT NULL,  -- 24 hours from creation
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_idempotency_org_key ON idempotency_keys(organization_id, key);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);  -- for cleanup job
```

---

## Row-Level Security (RLS) Policies

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_lot_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policy template (repeat for each table)
CREATE POLICY tenant_isolation ON lots
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- The API sets this at the start of each transaction:
-- SET LOCAL app.current_org_id = '<uuid>';
```

---

## Knex Migration File Naming
```
migrations/
  20240101000001_create_organizations.js
  20240101000002_create_users.js
  20240101000003_create_refresh_tokens.js
  20240101000004_create_locations.js
  20240101000005_create_products.js
  20240101000006_create_lots.js
  20240101000007_create_events.js
  20240101000008_create_event_lot_links.js
  20240101000009_create_attachments.js
  20240101000010_create_audit_log.js
  20240101000011_create_imports.js
  20240101000012_create_recall_simulations.js
  20240101000013_create_api_keys.js
  20240101000014_create_webhooks.js
  20240101000015_create_notifications.js
  20240101000016_create_subscriptions.js
  20240101000017_create_idempotency_keys.js
  20240101000018_add_rls_policies.js
```
