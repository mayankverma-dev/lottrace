/**
 * P1-18 regression tests — failure alerting for hash verification.
 *
 * A failed verification must leave an audit trail, notify the organization,
 * record a completion metric, and reach Sentry.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p118_test \
 *   npx jest --runInBand src/jobs/workers/hash-verifier.alert.test.js
 *
 * The suite drops and recreates the public schema in that database.
 * dbGuard refuses Neon, non-local hosts, and names without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../../modules/trace/trace.service', () => ({
  invalidateTraceCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../queues', () => ({
  connection: {},
}));
jest.mock('../../lib/sentry', () => ({
  initSentry: jest.fn(),
  captureHashVerificationFailure: jest.fn().mockReturnValue(true),
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-18 hash verification failure alerting', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let verifyHashChain;
  let captureHashVerificationFailure;

  const seedOrganization = async () => {
    const orgId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: 'P1-18 alerts',
      slug: `p1-18-alerts-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Alerts',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    return { orgId, userId };
  };

  const createEvent = (org) => eventsService.createEvent({
    eventType: 'creation',
    eventDatetime: '2026-06-01T10:00:00.000Z',
    source: 'manual',
    kdePayload: { sequence: 1 },
    counterpartyInfo: null,
    inputs: [],
    outputs: [],
  }, org.orgId, org.userId);

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('../../modules/events/events.service');
    ({ verifyHashChain } = require('./hash-verifier'));
    ({ captureHashVerificationFailure } = require('../../lib/sentry'));

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('alerts on a tampered payload and records the failure metric', async () => {
    const org = await seedOrganization();
    const event = await createEvent(org);

    await db('events')
      .where({ id: event.id })
      .update({ kde_payload: JSON.stringify({ tampered: true }) });

    const results = await verifyHashChain({ organizationId: org.orgId });

    expect(results).toEqual([
      expect.objectContaining({
        organizationId: org.orgId,
        status: 'failed',
        eventsChecked: 0,
        failure: { eventId: event.id, reason: 'payload_mismatch' },
      }),
    ]);

    const failedAudit = await db('audit_log')
      .where({ organization_id: org.orgId, action: 'hash.verify_failed' })
      .first();
    expect(failedAudit).toMatchObject({
      actor_type: 'system',
      entity_type: 'event',
      entity_id: event.id,
    });
    expect(failedAudit.metadata).toMatchObject({ reason: 'payload_mismatch' });

    const notification = await db('notifications')
      .where({ organization_id: org.orgId, type: 'hash_verification_failed' })
      .first();
    expect(notification).toMatchObject({
      user_id: null,
      entity_type: 'event',
      entity_id: event.id,
      link: '/audit',
    });
    expect(notification.message).toContain(event.id);

    const completedAudit = await db('audit_log')
      .where({ organization_id: org.orgId, action: 'hash.verify_completed' })
      .first();
    expect(completedAudit.metadata).toMatchObject({
      status: 'failed',
      events_checked: 0,
      failure_event_id: event.id,
      failure_reason: 'payload_mismatch',
    });

    expect(captureHashVerificationFailure).toHaveBeenCalledWith({
      organizationId: org.orgId,
      eventId: event.id,
      reason: 'payload_mismatch',
    });
  });

  it('does not alert when the chain verifies', async () => {
    const org = await seedOrganization();
    await createEvent(org);

    captureHashVerificationFailure.mockClear();

    const results = await verifyHashChain({ organizationId: org.orgId });

    expect(results).toEqual([
      expect.objectContaining({ organizationId: org.orgId, status: 'passed', eventsChecked: 1 }),
    ]);
    expect(await db('notifications')
      .where({ organization_id: org.orgId, type: 'hash_verification_failed' })).toHaveLength(0);
    expect(captureHashVerificationFailure).not.toHaveBeenCalled();
  });
});
