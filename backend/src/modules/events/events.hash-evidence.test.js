/**
 * P1-18 regression tests — signed evidence for mutable event facts.
 *
 * Status transitions and attachment additions happen after an event hash is
 * sealed. They are recorded in the append-only `event_evidence` chain rooted at
 * `events.record_hash`, so tampering is detectable without re-sealing the event.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p118_test \
 *   npx jest --runInBand src/modules/events/events.hash-evidence.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../trace/trace.service', () => ({
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
}));
jest.mock('../../lib/sentry', () => ({
  initSentry: jest.fn(),
  captureHashVerificationFailure: jest.fn().mockReturnValue(false),
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-18 signed event evidence', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let verifyHashChain;
  let hashChain;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-18 ${label}`,
      slug: `p1-18-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Evidence',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P1-18 Product ${label}`,
      is_ftl: false,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([]),
    });

    const lotIds = Array.from({ length: 3 }, () => uuidv4()).sort();
    await db('lots').insert(lotIds.map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P1-18-${label}-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    })));

    return { orgId, userId, productId, lotIds };
  };

  const createLinkedEvent = (org, overrides = {}) => eventsService.createEvent({
    eventType: 'transformation',
    eventDatetime: '2026-05-01T10:00:00Z',
    source: 'manual',
    kdePayload: {},
    counterpartyInfo: null,
    inputs: [{ lotId: org.lotIds[0], quantity: 1, uom: 'kg' }],
    outputs: [{ lotId: org.lotIds[1], quantity: 0.5, uom: 'kg' }],
    ...overrides,
  }, org.orgId, org.userId);

  const evidenceRows = (eventId) => db('event_evidence')
    .where({ event_id: eventId })
    .orderBy('seq', 'asc');

  const failedAudits = (orgId) => db('audit_log')
    .where({ organization_id: orgId, action: 'hash.verify_failed' });

  const failureReason = async (orgId) => {
    await verifyHashChain({ organizationId: orgId });
    const failures = await failedAudits(orgId);
    expect(failures).toHaveLength(1);
    return failures[0].metadata.reason;
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    ({ verifyHashChain } = require('../../jobs/workers/hash-verifier'));
    hashChain = require('../../utils/hashChain');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('signs a void transition and keeps the chain verifiable', async () => {
    const org = await seedOrganization('void');
    const event = await createLinkedEvent(org);

    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId, org.userId);

    const rows = await evidenceRows(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: org.orgId,
      seq: 1,
      kind: 'status_change',
      prev_hash: event.record_hash,
      hash_version: 3,
      hash_key_id: hashChain.getCurrentHashKeyId(),
    });
    expect(rows[0].payload).toEqual({
      fromStatus: 'active',
      toStatus: 'void',
      reason: 'wrong lot recorded',
      actorId: org.userId,
    });

    const expected = hashChain.computeEventEvidenceHash(
      hashChain.buildEventEvidenceHashPayload(rows[0]),
      event.record_hash,
    );
    expect(rows[0].record_hash).toBe(expected);

    await verifyHashChain({ organizationId: org.orgId });
    expect(await failedAudits(org.orgId)).toHaveLength(0);

    const completed = await db('audit_log')
      .where({ organization_id: org.orgId, action: 'hash.verify_completed' })
      .first();
    expect(completed.metadata).toMatchObject({ status: 'passed', events_checked: 1 });
  });

  it('detects tampering with a status evidence payload', async () => {
    const org = await seedOrganization('tamper-payload');
    const event = await createLinkedEvent(org);
    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId, org.userId);

    await db('event_evidence')
      .where({ event_id: event.id })
      .update({ payload: JSON.stringify({ fromStatus: 'active', toStatus: 'void', reason: 'edited', actorId: null }) });

    expect(await failureReason(org.orgId)).toBe('evidence_payload_mismatch');
  });

  it('detects deleting status evidence and leaving the event void', async () => {
    const org = await seedOrganization('delete-evidence');
    const event = await createLinkedEvent(org);
    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId, org.userId);

    await db('event_evidence').where({ event_id: event.id }).del();

    expect(await failureReason(org.orgId)).toBe('evidence_state_mismatch');
  });

  it('detects a materialized status changed without evidence', async () => {
    const org = await seedOrganization('tamper-status');
    const event = await createLinkedEvent(org);
    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId, org.userId);

    await db('events')
      .where({ id: event.id })
      .update({ status: 'active', void_reason: null });

    expect(await failureReason(org.orgId)).toBe('evidence_state_mismatch');
  });

  it('detects an evidence sequence tamper', async () => {
    const org = await seedOrganization('tamper-seq');
    const event = await createLinkedEvent(org);
    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId, org.userId);

    await db('event_evidence').where({ event_id: event.id }).update({ seq: 2 });

    expect(await failureReason(org.orgId)).toBe('evidence_chain_mismatch');
  });

  it('detects an evidence prev_hash tamper', async () => {
    const org = await seedOrganization('tamper-prev');
    const event = await createLinkedEvent(org);
    await eventsService.voidEvent(event.id, 'wrong lot recorded', org.orgId, org.userId);

    await db('event_evidence').where({ event_id: event.id }).update({ prev_hash: 'GENESIS' });

    expect(await failureReason(org.orgId)).toBe('evidence_chain_mismatch');
  });

  it('signs an amendment and keeps both events verifiable', async () => {
    const org = await seedOrganization('amend');
    const event = await createLinkedEvent(org);

    const replacement = await eventsService.amendEvent(event.id, {
      eventType: 'transformation',
      eventDatetime: '2026-05-02T10:00:00Z',
      source: 'manual',
      kdePayload: {},
      counterpartyInfo: null,
      inputs: [{ lotId: org.lotIds[0], quantity: 1, uom: 'kg' }],
      outputs: [{ lotId: org.lotIds[1], quantity: 0.5, uom: 'kg' }],
      voidReason: 'corrected quantity',
    }, org.orgId, org.userId);

    expect(Number(replacement.chain_seq)).toBe(2);
    expect(replacement.supersedes_event_id).toBe(event.id);

    const amended = await db('events').where({ id: event.id }).first();
    expect(amended.status).toBe('amended');
    expect(amended.void_reason).toBe('corrected quantity');

    const rows = await evidenceRows(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      fromStatus: 'active',
      toStatus: 'amended',
      reason: 'corrected quantity',
    });

    await verifyHashChain({ organizationId: org.orgId });
    expect(await failedAudits(org.orgId)).toHaveLength(0);
  });

  it('signs attachment additions and detects a deleted attachment', async () => {
    const org = await seedOrganization('attachment');
    const event = await createLinkedEvent(org);

    const attachment = await eventsService.addAttachment(event.id, {
      key: 'attachments/photo.jpg',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    }, org.orgId, org.userId);

    const rows = await evidenceRows(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, kind: 'attachment_added', prev_hash: event.record_hash });
    expect(rows[0].payload).toMatchObject({
      attachmentId: attachment.id,
      storageKey: 'attachments/photo.jpg',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: '1024',
      uploadedBy: org.userId,
    });

    await verifyHashChain({ organizationId: org.orgId });
    expect(await failedAudits(org.orgId)).toHaveLength(0);

    await db('attachments').where({ id: attachment.id }).del();

    expect(await failureReason(org.orgId)).toBe('evidence_state_mismatch');
  });

  it('detects attachment metadata tampering', async () => {
    const org = await seedOrganization('tamper-attachment');
    const event = await createLinkedEvent(org);

    const attachment = await eventsService.addAttachment(event.id, {
      key: 'attachments/photo.jpg',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    }, org.orgId, org.userId);

    await db('attachments').where({ id: attachment.id }).update({ filename: 'replaced.jpg' });

    expect(await failureReason(org.orgId)).toBe('evidence_state_mismatch');
  });
});
