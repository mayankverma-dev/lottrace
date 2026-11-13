/**
 * P1-26 regression tests — compliance-gap email leaves the transaction.
 *
 * The event is the compliance record; the email is a best-effort notification.
 * It must be queued only after commit, and a queue outage must never roll back
 * or fail an event that was already written.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p004_test \
 *   npx jest --runInBand src/modules/events/events.compliance-alert.test.js
 *
 * Redis is replaced with an in-memory map and BullMQ with a mock queue, so the
 * suite needs no live Redis. dbGuard refuses Neon, non-local hosts, and names
 * without the `_test` suffix.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../../config/redis', () => {
  const store = new Map();
  return {
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async () => 0),
    __store: store,
  };
});
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('../../jobs/queues', () => ({
  connection: {},
  emailQueue: { add: jest.fn() },
}));
jest.mock('../../lib/sentry', () => ({
  initSentry: jest.fn(),
  captureHashVerificationFailure: jest.fn().mockReturnValue(false),
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-26 compliance-gap alert after commit', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let emailQueue;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();
    const managerId = uuidv4();
    const productId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-26 ${label}`,
      slug: `p1-26-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert([{
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Owner',
      email: `${orgId}@example.test`,
      role: 'org_admin',
      status: 'active',
    }, {
      id: managerId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Manager',
      email: `manager-${orgId}@example.test`,
      role: 'compliance_manager',
      status: 'active',
    }]);

    // A required custom KDE field that the event payload omits produces a gap.
    await db('products').insert({
      id: productId,
      organization_id: orgId,
      name: `P1-26 Product ${label}`,
      is_ftl: true,
      default_uom: 'kg',
      custom_kde_schema: JSON.stringify([
        { name: 'harvestDate', required: true, label: 'Harvest Date' },
      ]),
    });

    const lotIds = [uuidv4(), uuidv4(), uuidv4()];
    await db('lots').insert(lotIds.map((id, index) => ({
      id,
      organization_id: orgId,
      product_id: productId,
      traceability_lot_code: `P1-26-${label}-LOT-${index + 1}`,
      quantity: 100,
      uom: 'kg',
      created_by: userId,
    })));

    return {
      orgId,
      userId,
      managerId,
      inputLotId: lotIds[0],
      outputLotId: lotIds[1],
      spareLotId: lotIds[2],
    };
  };

  const eventPayload = (org, overrides = {}) => ({
    eventType: 'transformation',
    eventDatetime: '2026-11-13T09:00:00.000Z',
    source: 'manual',
    kdePayload: {},
    counterpartyInfo: null,
    inputs: [{ lotId: org.inputLotId, quantity: 10, uom: 'kg' }],
    outputs: [{ lotId: org.outputLotId, quantity: 9, uom: 'kg' }],
    ...overrides,
  });

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    ({ emailQueue } = require('../../jobs/queues'));

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(() => {
    emailQueue.add.mockReset();
    emailQueue.add.mockResolvedValue({ id: 'job' });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('queues one alert per compliance manager only after the event commits', async () => {
    const org = await seedOrganization('commit');
    const visibleOnOtherConnection = [];

    emailQueue.add.mockImplementation(async (name, job) => {
      const row = await db('events').where({ id: job.data.eventId }).first();
      visibleOnOtherConnection.push(Boolean(row));
      return { id: 'job' };
    });

    const event = await eventsService.createEvent(eventPayload(org), org.orgId, org.userId);

    expect(event.compliance_gaps).not.toBeNull();
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
    expect(visibleOnOtherConnection).toEqual([true]);

    const [name, job] = emailQueue.add.mock.calls[0];
    expect(name).toBe('compliance_gap_alert');
    expect(job.data).toMatchObject({
      email: `manager-${org.orgId}@example.test`,
      eventId: event.id,
      locationName: 'Unknown Location',
      eventType: 'transformation',
      timestamp: '2026-11-13T09:00:00.000Z',
    });
    expect(job.data.gaps).toEqual([
      { field: 'harvestDate', message: 'Harvest Date is required' },
    ]);
  });

  it('keeps the committed event when the email queue rejects', async () => {
    const org = await seedOrganization('queue-down');
    emailQueue.add.mockRejectedValue(new Error('redis down'));

    const event = await eventsService.createEvent(eventPayload(org), org.orgId, org.userId);

    expect(await db('events').where({ id: event.id }).first()).toBeTruthy();
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('queues no alert when the event transaction rolls back', async () => {
    const org = await seedOrganization('rollback');

    await expect(
      eventsService.createEvent(
        eventPayload(org, { outputs: [{ lotId: uuidv4(), quantity: 9, uom: 'kg' }] }),
        org.orgId,
        org.userId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(await db('events').where({ organization_id: org.orgId })).toHaveLength(0);
  });

  it('queues the alert for the replacement event after an amendment commits', async () => {
    const org = await seedOrganization('amend');
    const original = await eventsService.createEvent(eventPayload(org), org.orgId, org.userId);
    emailQueue.add.mockClear();

    const replacement = await eventsService.amendEvent(
      original.id,
      eventPayload(org, { voidReason: 'corrected quantity' }),
      org.orgId,
      org.userId,
    );

    expect(replacement.compliance_gaps).not.toBeNull();
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
    expect(emailQueue.add.mock.calls[0][1].data.eventId).toBe(replacement.id);
    expect(await db('events').where({ supersedes_event_id: original.id })).toHaveLength(1);
  });
});
