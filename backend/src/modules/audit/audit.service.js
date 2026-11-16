const db = require('../../db/knex');
const { paginate } = require('../../utils/pagination');

/**
 * Builds the organization-scoped audit log query for the list endpoint and
 * audit exports. Callers add ordering and pagination.
 *
 * @param {{ action?: string, entityType?: string, entityId?: string, actorId?: string }} filters
 * @param {string} organizationId
 * @param {import('knex').Knex | import('knex').Knex.Transaction} [qb=db]
 * @returns {import('knex').Knex.QueryBuilder}
 */
const buildAuditLogQuery = (filters = {}, organizationId, qb = db) => {
  const { action, entityType, entityId, actorId } = filters;

  const query = qb('audit_log')
    .where({ 'audit_log.organization_id': organizationId })
    .leftJoin('users', 'audit_log.actor_id', 'users.id')
    .select(
      'audit_log.*',
      'users.first_name as actor_first_name',
      'users.last_name as actor_last_name',
      'users.email as actor_email'
    );

  if (action) query.where('audit_log.action', action);
  if (entityType) query.where('audit_log.entity_type', entityType);
  if (entityId) query.where('audit_log.entity_id', entityId);
  if (actorId) query.where('audit_log.actor_id', actorId);

  return query;
};

const getAuditLogs = async (query, organizationId) => {
  const { page, limit, ...filters } = query;
  const auditQuery = buildAuditLogQuery(filters, organizationId)
    .orderBy('audit_log.created_at', 'desc');

  return paginate(auditQuery, { page, limit });
};

module.exports = {
  buildAuditLogQuery,
  getAuditLogs,
};
