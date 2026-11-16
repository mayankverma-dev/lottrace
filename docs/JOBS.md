# LotTrace — Background Jobs (BullMQ)

---

## Overview

BullMQ runs on top of Redis. All queues share the same Redis instance.
Workers can run in the same Node.js process (development) or a separate process (production).

```
API Request → enqueue job → return jobId to client
              ↓
         BullMQ Queue (Redis)
              ↓
         Worker picks up job
              ↓
         Process (validate CSV rows, generate PDF, etc.)
              ↓
         Update DB record status
              ↓
         Enqueue email notification
```

---

## Queue Registry (`src/jobs/queues.js`)

```javascript
const { Queue } = require('bullmq');
const { redis } = require('../config/redis');

const connection = redis; // shared ioredis instance

const Queues = {
  IMPORT:   new Queue('import',   { connection }),
  EXPORT:   new Queue('export',   { connection }),
  EMAIL:    new Queue('email',    { connection }),
  WEBHOOK:  new Queue('webhook',  { connection }),
  HASH_VERIFY: new Queue('hash-verify', { connection }),
};

module.exports = Queues;
```

---

## Queue 1: `import` — Bulk CSV Import

**File:** `src/jobs/import-processor.js`

**Triggered by:** `POST /api/v1/imports` → after upload saved to S3

**Job Payload:**
```json
{
  "importId": "uuid",
  "organizationId": "uuid",
  "storageKey": "imports/org-uuid/filename.csv",
  "cteType": "receiving",
  "userId": "uuid"
}
```

**Worker Logic:**
```javascript
const { Worker } = require('bullmq');
const { parse } = require('csv-parse');

const worker = new Worker('import', async (job) => {
  const { importId, organizationId, storageKey, cteType } = job.data;

  // 1. Update import status → 'processing'
  await db('imports').where({ id: importId }).update({ status: 'processing', started_at: new Date() });

  // 2. Stream CSV from S3
  const stream = await s3.getObjectStream(storageKey);

  // 3. Parse rows
  const parser = stream.pipe(parse({ columns: true, skip_empty_lines: true, trim: true }));

  let totalRows = 0, validRows = 0;
  const errors = [];

  // 4. Validate + commit per row (not per file)
  for await (const row of parser) {
    totalRows++;
    const result = await validateAndCommitRow(row, cteType, organizationId);
    if (result.success) {
      validRows++;
    } else {
      errors.push({ row: totalRows, ...result.errors });
    }
    // Update progress
    await job.updateProgress(Math.round((totalRows / estimatedTotal) * 100));
  }

  // 5. Generate error report CSV → upload to S3
  let errorReportKey = null;
  if (errors.length > 0) {
    errorReportKey = await generateErrorReport(errors, importId);
  }

  // 6. Update import record → 'complete'
  await db('imports').where({ id: importId }).update({
    status: errors.length === totalRows ? 'failed' : 'complete',
    total_rows: totalRows,
    valid_rows: validRows,
    error_rows: errors.length,
    error_report_key: errorReportKey,
    completed_at: new Date(),
  });

  // 7. Enqueue notification email
  await Queues.EMAIL.add('import-complete', {
    type: 'import_complete',
    userId: job.data.userId,
    organizationId,
    data: { importId, totalRows, validRows, errorRows: errors.length },
  });

}, { connection, concurrency: 2 });
```

**Deduplication Rule:**
```javascript
// Detect likely duplicate rows: same lot_code + event_type + date + location
// Flag for review, never silently commit duplicates
const isDuplicate = await db('events')
  .where({ organization_id: organizationId, event_type: cteType, location_id: locationId })
  .whereRaw("kde_payload->>'source_lot_code' = ?", [row.lot_code])
  .whereRaw("DATE(event_datetime) = ?", [row.date])
  .first();

if (isDuplicate) {
  errors.push({ row: rowNum, field: 'lot_code', message: 'Likely duplicate — same lot, type, date, location' });
  continue;
}
```

---

## Queue 2: `export` — Report Exports

**Files:** `src/jobs/workers/export-generator.js` (BullMQ worker) and
`src/jobs/workers/export-processor.js` (job logic).

**Triggered by:** `POST /api/v1/reports/export` with `type: "events" | "audit"`.
Audit exports also accept `filters` (`action`, `entityType`, `entityId`,
`actorId`).

**Job Payload:**
```json
{ "exportId": "uuid" }
```

The worker reads `report_exports` by ID. The database row is the source of truth
for `organization_id`, `type`, `format`, `filters`, and `requested_by`; job data
cannot choose a different tenant, type, format, or filter.

**Status lifecycle:** `queued → processing → complete | failed`.

**Worker logic:**
```javascript
// 1. Read the report_exports row and set status = processing, started_at = now.
// 2. Events: read in batches of 500 ordered by chain_seq.
//    Audit: read organization-scoped audit_log rows with the stored filters,
//    ordered by (created_at, id), using an exact-microsecond keyset cursor.
// 3. Append each batch to a temporary CSV or JSON file.
// 4. Upload the temp file with a streamed PutObject (ContentLength from fs.stat).
// 5. Set status = complete, storage_key, row_count, completed_at.
// 6. Insert an export_ready notification with link /reports/exports/:id.
// 7. On failure: set status = failed, error, completed_at; insert export_failed.
```

- Event CSV and JSON contain the same 22 event columns. Audit CSV and JSON
  contain the immutable audit record (actor, action, entity, before/after state,
  metadata, IP, timestamp) without `organization_id`. JSON fields remain
  structured in JSON and are JSON-stringified in CSV.
- CSV scalar cells whose value starts with `=`, `+`, `-`, `@`, TAB, or CR are
  prefixed with a single quote so spreadsheet programs treat them as text, not
  formulas. JSON output is unchanged.
- Empty exports complete with `row_count = 0`; CSV is header-only and JSON is
  `[]`.
- Storage key format: `exports/org_<organizationId>/<exportId>.<ext>`.
- The download endpoint checks `organization_id`, then signs a 5-minute URL with
  `Content-Disposition: attachment`. Raw storage keys are never returned.
- No automatic retries: a failed export is surfaced and can be requested again.
- Exports are capped at 1,000,000 rows or 512 MiB. Exceeding either limit fails
  the export with `error_code = 'EXPORT_LIMIT_EXCEEDED'` and an `export_failed`
  notification; the API returns a safe message and code.
- If enqueueing fails, the API returns `503 EXPORT_QUEUE_UNAVAILABLE`, marks the
  row failed, and still creates the `export_failed` notification so a client that
  timed out has a later signal.

**Retention:** the `export_cleanup` maintenance job runs daily at `03:15 UTC`.
It marks `queued`/`processing` rows older than one hour as failed, then deletes
terminal rows older than 30 days and their S3 objects. Audit log rows remain.
A row whose object cannot be deleted is kept and retried on the next daily run;
the job reports `deleted`, `objectsDeleted`, and `objectsFailed`.

---

## Queue 3: `hash-verify` — Event Hash Chain Verification

**File:** `src/jobs/workers/hash-verifier.js`

**Triggered by:** Nightly cron (BullMQ repeatable job, 2:00 AM UTC)

**Logic:**
```javascript
const keyRing = getKeyRing(); // HASH_CHAIN_OLD_KEYS + current HASH_CHAIN_KEY_ID/SECRET

const worker = new Worker('hash-verify-queue', async (job) => {
  // Walk chain per org
  const orgs = await db('organizations').select('id');

  for (const org of orgs) {
    // chain_seq is the only total order; created_at is the transaction start time.
    const events = await db('events')
      .where({ organization_id: org.id })
      .orderBy('chain_seq', 'asc');

    let prevHash = GENESIS_HASH;

    for (const event of events) {
      if (event.prev_hash !== prevHash) break;              // chain_link_mismatch
      if (event.hash_version !== HASH_VERSION) break;       // unsupported_hash_version
      if (!hasHashKey(event.hash_key_id, keyRing)) break;   // unsupported_hash_key

      const payload = await loadEventHashPayload(db, event.id);
      const expectedHash = computeEventHash(payload, prevHash, event.hash_key_id, keyRing);

      if (expectedHash !== event.record_hash) break;        // payload_mismatch

      // Signed mutable facts: status transitions and attachments.
      if (await verifyEventEvidence(event, keyRing)) break; // evidence_* mismatch
      prevHash = expectedHash;
    }
  }
}, { connection });
```

On the first failing event the worker writes `audit_log` with
`action = 'hash.verify_failed'` and `metadata.reason` set to
`chain_link_mismatch`, `unsupported_hash_version`, `unsupported_hash_key`,
`payload_mismatch`, `evidence_chain_mismatch`, `evidence_payload_mismatch`, or
`evidence_state_mismatch`. It also creates an org-wide `hash_verification_failed`
notification, calls Sentry when `SENTRY_DSN` is configured, and always writes a
`hash.verify_completed` audit row plus a structured pino metric
(`metric: 'hash_verification_completed'`).

---

## Queue 4: `email` — Email Notifications

**File:** `src/jobs/email-sender.js`

**Triggered by:** Other workers enqueue email jobs

**Email Types + Templates:**

| Type | Recipient | Template |
|------|-----------|---------|
| `invite_user` | Invited email | "You've been invited to LotTrace" |
| `forgot_password` | User email | "Reset your password" |
| `import_complete` | Uploader | "Import complete: X valid, Y errors" |
| `export_ready` | Requester | "Your export is ready to download" |
| `compliance_gap_digest` | Admin + Compliance Mgr | Weekly digest of open gaps |
| `integrity_failure` | Org Admin | "Hash chain verification failed" |

**Digest Batching (anti-storm):**
```javascript
// Instead of 200 individual emails for 200 compliance gaps,
// collect gaps per org and send one digest per org per period
const DIGEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// When a compliance gap is detected:
await Queues.EMAIL.add(`digest-${organizationId}`, {
  type: 'compliance_gap_digest',
  organizationId,
}, {
  delay: DIGEST_INTERVAL_MS,
  jobId: `digest-${organizationId}`, // deduplicates — only one digest job per org at a time
});
```

---

## Queue 5: `webhook` — Outbound Webhook Dispatcher

**File:** `src/jobs/webhook-dispatcher.js`

**Triggered by:** Events that have subscribed webhooks

**Job Payload:**
```json
{
  "event": "event.created",
  "organizationId": "uuid",
  "payload": { "eventId": "uuid", "eventType": "receiving", "lotId": "uuid" }
}
```

**Retry Strategy:**
```javascript
// Retry with exponential backoff, max 5 attempts
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s, 32s
};

const worker = new Worker('webhook', async (job) => {
  const { event, organizationId, payload } = job.data;

  const webhooks = await db('webhooks')
    .where({ organization_id: organizationId, status: 'active' })
    .whereRaw('? = ANY(subscribed_events)', [event]);

  for (const webhook of webhooks) {
    const signature = computeWebhookSignature(payload, webhook.secret);
    try {
      await axios.post(webhook.url, { event, data: payload }, {
        headers: { 'X-LotTrace-Signature': signature, 'X-LotTrace-Event': event },
        timeout: 10000, // 10 second timeout
      });
      await db('webhooks').where({ id: webhook.id }).update({ last_success_at: new Date(), failure_count: 0 });
    } catch (err) {
      await db('webhooks').where({ id: webhook.id }).increment('failure_count');
      // After 10 consecutive failures: auto-disable webhook and notify admin
      const updated = await db('webhooks').where({ id: webhook.id }).first();
      if (updated.failure_count >= 10) {
        await db('webhooks').where({ id: webhook.id }).update({ status: 'inactive' });
        await Queues.EMAIL.add('webhook-disabled', {
          type: 'webhook_disabled', organizationId, data: { webhookId: webhook.id, url: webhook.url },
        });
      }
      throw err; // let BullMQ retry
    }
  }
}, { connection });
```

---

## Queue 6: `maintenance` — Bounded Housekeeping

**File:** `src/jobs/workers/maintenance.js`

The worker dispatches by `job.name`:

| Job | Schedule | Work |
|---|---|---|
| `idempotency_cleanup` | Hourly at `:15` | Delete expired HTTP idempotency rows. |
| `export_cleanup` | Daily at `03:15 UTC` | Fail stuck exports, delete terminal exports older than 30 days and their S3 objects. |

Unknown job names throw, so a new maintenance task cannot silently run the wrong
cleanup.

---

## Firing Webhooks from Event Handlers

```javascript
// In events.service.js, after creating an event:
const { Queues } = require('../../jobs/queues');

const triggerWebhooks = async (eventName, organizationId, payload) => {
  // Check if org has any active webhooks for this event type (fast Redis check)
  await Queues.WEBHOOK.add(eventName, { event: eventName, organizationId, payload }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  });
};

// Usage:
await triggerWebhooks('event.created', organizationId, { eventId: event.id, ... });
```

---

## BullMQ Dashboard (Dev)
For monitoring queues locally, optionally use `@bull-board/express`:
```bash
pnpm add --filter backend @bull-board/api @bull-board/express
# Access: http://localhost:3000/admin/queues (super_admin only)
```

---

## Job Monitoring Alerts

| Condition | Action |
|-----------|--------|
| Job fails after max retries | Log to `audit_log`, notify super_admin |
| Import job stuck > 30 min | Auto-mark import as 'failed' via cleanup cron |
| Hash verify failure | Urgent email to org admins |
| Webhook disabled (10 failures) | Email to org admin |
