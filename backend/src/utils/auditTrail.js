const db = require('../db/knex');
const { v4: uuidv4 } = require('uuid');

/**
 * Writes an entry to the audit_log table.
 * @param {Object} params
 * @param {string} [params.organizationId]
 * @param {string} [params.actorId]
 * @param {string} [params.actorType='user'] - 'user' | 'api_key' | 'system' | 'super_admin'
 * @param {string} params.action - e.g., 'event.void', 'lot.amend'
 * @param {string} [params.entityType]
 * @param {string} [params.entityId]
 * @param {Object} [params.beforeState]
 * @param {Object} [params.afterState]
 * @param {Object} [params.metadata]
 * @param {string} [params.ipAddress]
 * @param {import('knex').Knex | import('knex').Knex.Transaction} [qb=db] - caller transaction, if any
 */
const writeAuditLog = async (params, qb = db) => {
  await qb('audit_log').insert({
    id: uuidv4(),
    organization_id: params.organizationId || null,
    actor_id: params.actorId || null,
    actor_type: params.actorType || 'user',
    action: params.action,
    entity_type: params.entityType || null,
    entity_id: params.entityId || null,
    before_state: params.beforeState ? JSON.stringify(params.beforeState) : null,
    after_state: params.afterState ? JSON.stringify(params.afterState) : null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ip_address: params.ipAddress || null,
  });
};

module.exports = { writeAuditLog };
