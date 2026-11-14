/**
 * P2-02 regression tests — compliance-gap service returns the standard shape.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

const path = require('path');
const { v4: uuid } = require('uuid');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');
const PAGINATION_KEYS = [
  'hasNextPage',
  'hasPrevPage',
  'limit',
  'page',
  'total',
  'totalPages',
];

describeDb('P2-02 compliance-gap pagination shape', () => {
  jest.setTimeout(120000);

  let db;
  let reportsService;
  let organizationId;
  let otherOrganizationId;
  let userId;

  beforeAll(async () => {
    db = require('../../db/knex');
    reportsService = require('./reports.service');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  beforeEach(async () => {
    organizationId = uuid();
    otherOrganizationId = uuid();
    userId = uuid();

    await db('organizations').insert([
      { id: organizationId, name: 'P2-02 A', slug: `p2-02-a-${organizationId.slice(0, 8)}` },
      { id: otherOrganizationId, name: 'P2-02 B', slug: `p2-02-b-${otherOrganizationId.slice(0, 8)}` },
    ]);
    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'P2',
      last_name: 'Tester',
      email: `${userId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });

    const events = [1, 2, 3].map((chainSeq) => ({
      organization_id: organizationId,
      event_type: 'creation',
      event_datetime: new Date(Date.UTC(2026, 10, 14, 10, chainSeq)),
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({ fixture: 'p2-02' }),
      compliance_gaps: JSON.stringify([{ field: 'locationId', message: 'required' }]),
      record_hash: `p2-02-hash-${organizationId}-${chainSeq}`,
      prev_hash: chainSeq === 1 ? 'GENESIS' : `p2-02-hash-${organizationId}-${chainSeq - 1}`,
      chain_seq: chainSeq,
      hash_key_id: 'p2-02-test-key',
    }));
    await db('events').insert(events);

    await db('events').insert({
      organization_id: otherOrganizationId,
      event_type: 'creation',
      event_datetime: new Date(Date.UTC(2026, 10, 14, 10, 4)),
      recorded_by: userId,
      source: 'manual',
      kde_payload: JSON.stringify({ fixture: 'p2-02-other' }),
      compliance_gaps: JSON.stringify([{ field: 'locationId', message: 'required' }]),
      record_hash: `p2-02-other-${otherOrganizationId}`,
      prev_hash: 'GENESIS',
      chain_seq: 1,
      hash_key_id: 'p2-02-test-key',
    });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('returns the exact six-field shape and tenant-scoped pages', async () => {
    const first = await reportsService.getComplianceGaps(organizationId, { page: 1, limit: 2 });
    const second = await reportsService.getComplianceGaps(organizationId, { page: 2, limit: 2 });

    expect(Object.keys(first.pagination).sort()).toEqual(PAGINATION_KEYS);
    expect(first.data).toHaveLength(2);
    expect(first.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
    expect(second.data).toHaveLength(1);
    expect(second.pagination).toEqual({
      total: 3,
      page: 2,
      limit: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
    expect(first.meta).toBeUndefined();
    expect(second.meta).toBeUndefined();
  });
});
