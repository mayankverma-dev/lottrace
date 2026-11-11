/**
 * P1-24 regression tests — event status filters must qualify events.status.
 *
 * Both `events` and `users` have a `status` column. `getEvents` applies the
 * filter before joining `users`, so an unqualified `where({ status })` makes
 * PostgreSQL reject the listing with: column reference "status" is ambiguous.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`:
 *
 *   docker exec lottrace-postgres createdb -U lottrace lottrace_p124_test
 *   cd backend
 *   RUN_DB_TESTS=1 \
 *   DATABASE_URL=postgresql://lottrace:lottrace@localhost:5432/lottrace_p124_test \
 *   npx jest --runInBand src/modules/events/events.status-filter.test.js
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

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

const FIXTURE_STATUSES = ['active', 'active', 'amended', 'void'];
const STATUS_COUNTS = { active: 2, amended: 1, void: 1 };

describeDb('P1-24 event status filters', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let hashChain;
  let org;

  const seedOrganization = async (label) => {
    const organizationId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: organizationId,
      name: `P1-24 ${label}`,
      slug: `p1-24-${label}-${organizationId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'P1',
      last_name: 'Status',
      email: `${organizationId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    return { organizationId, userId };
  };

  const seedEvent = async ({ organizationId, userId, status, chainSeq }) => {
    const [event] = await db('events').insert({
      organization_id: organizationId,
      event_type: 'creation',
      event_datetime: new Date(Date.UTC(2026, 10, 11, 10, 0, chainSeq)),
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({ fixture: status }),
      record_hash: `p1-24-hash-${organizationId}-${chainSeq}`,
      prev_hash: chainSeq === 1 ? 'GENESIS' : `p1-24-hash-${organizationId}-${chainSeq - 1}`,
      chain_seq: chainSeq,
      hash_key_id: hashChain.getCurrentHashKeyId(),
      status,
    }).returning('*');

    return event;
  };

  const seedStatusFixture = async ({ organizationId, userId }) => {
    for (let index = 0; index < FIXTURE_STATUSES.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedEvent({
        organizationId,
        userId,
        status: FIXTURE_STATUSES[index],
        chainSeq: index + 1,
      });
    }
  };

  const listByStatus = (status, page = 1, limit = 20) => eventsService.getEvents(
    { page, limit, status },
    org.organizationId,
  );

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    hashChain = require('../../utils/hashChain');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(async () => {
    org = await seedOrganization('filter');
    await seedStatusFixture(org);
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it.each(['active', 'amended', 'void'])(
    'returns only %s events and reports the matching total',
    async (status) => {
      const result = await listByStatus(status);

      expect(result.data).toHaveLength(STATUS_COUNTS[status]);
      expect(result.data.every((event) => event.status === status)).toBe(true);
      expect(result.pagination).toMatchObject({
        total: STATUS_COUNTS[status],
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    },
  );

  it('paginates within the filtered status set', async () => {
    const firstPage = await listByStatus('active', 1, 1);
    const secondPage = await listByStatus('active', 2, 1);

    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.pagination).toMatchObject({
      total: 2,
      page: 1,
      limit: 1,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });

    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.pagination).toMatchObject({
      total: 2,
      page: 2,
      limit: 1,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });

    expect(secondPage.data[0].id).not.toBe(firstPage.data[0].id);
  });
});
