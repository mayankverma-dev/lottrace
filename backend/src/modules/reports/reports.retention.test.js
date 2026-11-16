/**
 * P1-02 retention tests. Requires a disposable local PostgreSQL database whose
 * name ends in `_test`.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

process.env.HASH_CHAIN_KEY_ID = process.env.HASH_CHAIN_KEY_ID || 'p102-test-k1';
process.env.HASH_CHAIN_SECRET = process.env.HASH_CHAIN_SECRET || 'd'.repeat(64);

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

jest.mock('../../lib/storage', () => ({
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { deleteObject } = require('../../lib/storage');
const {
  failStuckExports,
  purgeExpiredExports,
} = require('./reports.retention');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-02 export retention', () => {
  jest.setTimeout(120000);

  let db;
  const now = new Date('2026-11-16T12:00:00.000Z');

  const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-02 retention ${label}`,
      slug: `p1-02-retention-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: 'Retention',
      email: `${userId}@example.test`,
      role: 'compliance_manager',
      status: 'active',
    });

    return { orgId, userId };
  };

  const insertExport = async (org, overrides = {}) => {
    const [record] = await db('report_exports')
      .insert({
        organization_id: org.orgId,
        requested_by: org.userId,
        type: 'events',
        format: 'csv',
        status: 'complete',
        ...overrides,
      })
      .returning('*');

    return record;
  };

  beforeAll(async () => {
    db = require('../../db/knex');

    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  beforeEach(() => {
    deleteObject.mockClear();
  });

  it('deletes terminal exports older than 30 days and keeps recent ones', async () => {
    const org = await seedOrganization('purge');
    const oldComplete = await insertExport(org, {
      status: 'complete',
      storage_key: `exports/org_${org.orgId}/old.csv`,
      created_at: daysAgo(31),
      completed_at: daysAgo(31),
    });
    const oldFailed = await insertExport(org, {
      status: 'failed',
      error: 'failed',
      created_at: daysAgo(31),
      completed_at: daysAgo(31),
    });
    const recent = await insertExport(org, {
      status: 'complete',
      storage_key: `exports/org_${org.orgId}/recent.csv`,
      created_at: daysAgo(1),
    });

    const result = await purgeExpiredExports({ now });

    expect(result).toEqual({ deleted: 2, objectsDeleted: 1 });
    expect(deleteObject).toHaveBeenCalledWith(`exports/org_${org.orgId}/old.csv`);

    const remaining = await db('report_exports')
      .where({ organization_id: org.orgId })
      .select('id');
    expect(remaining.map((row) => row.id)).toEqual([recent.id]);
    expect(remaining.map((row) => row.id)).not.toContain(oldComplete.id);
    expect(remaining.map((row) => row.id)).not.toContain(oldFailed.id);
  });

  it('fails stuck queued and processing exports and notifies the requester', async () => {
    const org = await seedOrganization('stuck');
    const queued = await insertExport(org, {
      status: 'queued',
      created_at: hoursAgo(2),
    });
    const processing = await insertExport(org, {
      status: 'processing',
      created_at: hoursAgo(2),
      started_at: hoursAgo(2),
    });

    const failedCount = await failStuckExports({ now });

    expect(failedCount).toBe(2);

    const rows = await db('report_exports')
      .whereIn('id', [queued.id, processing.id])
      .orderBy('created_at', 'asc');
    expect(rows.map((row) => row.status)).toEqual(['failed', 'failed']);
    expect(rows.every((row) => row.error === 'Export timed out')).toBe(true);
    expect(rows.every((row) => row.completed_at !== null)).toBe(true);

    const notifications = await db('notifications')
      .whereIn('entity_id', [queued.id, processing.id]);
    expect(notifications).toHaveLength(2);
    expect(notifications.every((row) => row.type === 'export_failed')).toBe(true);
    expect(notifications.every((row) => row.user_id === org.userId)).toBe(true);
  });

  it('does not delete audit log rows', async () => {
    const org = await seedOrganization('audit');
    const oldExport = await insertExport(org, {
      status: 'complete',
      storage_key: `exports/org_${org.orgId}/audit.csv`,
      created_at: daysAgo(31),
    });

    await db('audit_log').insert({
      organization_id: org.orgId,
      actor_id: org.userId,
      action: 'report.export',
      entity_type: 'report',
      entity_id: oldExport.id,
      created_at: daysAgo(31),
    });

    await purgeExpiredExports({ now });

    const auditRows = await db('audit_log')
      .where({ organization_id: org.orgId, entity_id: oldExport.id });
    expect(auditRows).toHaveLength(1);
  });
});
