const AppError = require('./AppError');

/**
 * Ensures every referenced lot belongs to the organization.
 *
 * Cross-tenant and unknown lot IDs must be indistinguishable: both throw the
 * same 404 so callers cannot probe another tenant's lot UUIDs.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {Array<string>} lotIds
 * @param {string} organizationId
 * @returns {Promise<void>}
 */
const assertLotsBelongToOrganization = async (qb, lotIds, organizationId) => {
  const uniqueLotIds = [...new Set(lotIds)];
  if (uniqueLotIds.length === 0) return;

  const rows = await qb('lots')
    .whereIn('id', uniqueLotIds)
    .andWhere('organization_id', organizationId)
    .select('id');

  if (rows.length !== uniqueLotIds.length) {
    throw new AppError('Lot not found', 'NOT_FOUND', 404);
  }
};

module.exports = { assertLotsBelongToOrganization };
