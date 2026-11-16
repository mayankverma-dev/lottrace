/**
 * P1-04 regression tests — the audit list endpoint and audit exports share one
 * organization-scoped filter builder.
 *
 * Requires a disposable local PostgreSQL database whose name ends in `_test`.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) {
  // eslint-disable-next-line global-require
  require('../../test/dbGuard').announceTarget();
}

const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { buildAuditLogQuery, getAuditLogs } = require('./audit.service');

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

describeDb('P1-04 audit log query filters', () => {
  jest.setTimeout(120000);

  let db;

  const seedOrganization = async (label) => {
    const orgId = uuidv4();
    const userId = uuidv4();

    await db('organizations').insert({
      id: orgId,
      name: `P1-04 ${label}`,
      slug: `p1-04-${label}-${orgId.slice(0, 8)}`,
    });

    await db('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: 'P1',
      last_name: label,
      email: `${userId}@example.test`,
      role: 'compliance_manager',
      status: 'active',
    });

    return { orgId, userId };
  };

  const insertAuditLog = async ({
    orgId,
    actorId,
    action,
    entityType = 'lot',
    entityId = uuidv4(),
    createdAt,
  }) => {
    const id = uuidv4();

    await db('audit_log').insert({
      id,
      organization_id: orgId,
      actor_id: actorId,
      actor_type: 'user',
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: JSON.stringify({}),
      ip_address: '127.0.0.1',
      created_at: createdAt,
    });

    return id;
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

  it('scopes by organization and applies every audit filter', async () => {
    const orgA = await seedOrganization('a');
    const orgB = await seedOrganization('b');
    const secondActorId = uuidv4();
    const lotId = uuidv4();

    await db('users').insert({
      id: secondActorId,
      organization_id: orgA.orgId,
      first_name: 'Second',
      last_name: 'Actor',
      email: `${secondActorId}@example.test`,
      role: 'auditor',
      status: 'active',
    });

    const voided = await insertAuditLog({
      orgId: orgA.orgId,
      actorId: orgA.userId,
      action: 'lot.void',
      entityType: 'lot',
      entityId: lotId,
      createdAt: new Date('2026-11-16T10:00:00.000Z'),
    });
    const updated = await insertAuditLog({
      orgId: orgA.orgId,
      actorId: secondActorId,
      action: 'lot.update',
      entityType: 'lot',
      entityId: uuidv4(),
      createdAt: new Date('2026-11-16T10:01:00.000Z'),
    });
    const foreign = await insertAuditLog({
      orgId: orgB.orgId,
      actorId: orgB.userId,
      action: 'lot.void',
      createdAt: new Date('2026-11-16T10:02:00.000Z'),
    });

    const idsFor = async (filters) => (
      await buildAuditLogQuery(filters, orgA.orgId).orderBy('audit_log.created_at', 'asc')
    ).map((row) => row.id);

    expect(await idsFor({})).toEqual([voided, updated]);
    expect(await idsFor({ action: 'lot.void' })).toEqual([voided]);
    expect(await idsFor({ entityType: 'lot', entityId: lotId })).toEqual([voided]);
    expect(await idsFor({ actorId: secondActorId })).toEqual([updated]);
    expect(await idsFor({})).not.toContain(foreign);
  });

  it('uses the same filters through the paginated list service', async () => {
    const org = await seedOrganization('paginated');

    for (let index = 0; index < 3; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await insertAuditLog({
        orgId: org.orgId,
        actorId: org.userId,
        action: 'lot.void',
        createdAt: new Date(`2026-11-16T10:0${index}:00.000Z`),
      });
    }

    await insertAuditLog({
      orgId: org.orgId,
      actorId: org.userId,
      action: 'lot.update',
      createdAt: new Date('2026-11-16T10:04:00.000Z'),
    });

    const result = await getAuditLogs(
      { page: 1, limit: 2, action: 'lot.void' },
      org.orgId,
    );

    expect(result.data).toHaveLength(2);
    expect(result.data.every((row) => row.action === 'lot.void')).toBe(true);
    expect(result.pagination).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });
});
