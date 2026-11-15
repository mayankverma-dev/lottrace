/**
 * Check required product KDE fields for an event.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {Object} data
 * @param {string} organizationId
 * @returns {Promise<Array<{field: string, message: string}>|null>}
 */
const checkComplianceGaps = async (qb, data, organizationId) => {
  const lotIds = [...(data.inputs || []), ...(data.outputs || [])].map(lot => lot.lotId);
  if (lotIds.length === 0) return null;

  const lots = await qb('lots')
    .join('products', 'lots.product_id', 'products.id')
    .whereIn('lots.id', lotIds)
    .andWhere('lots.organization_id', organizationId)
    .select('products.custom_kde_schema');

  const gaps = [];

  lots.forEach((lot) => {
    if (lot.custom_kde_schema) {
      const schema = typeof lot.custom_kde_schema === 'string'
        ? JSON.parse(lot.custom_kde_schema)
        : lot.custom_kde_schema;

      schema.forEach((field) => {
        if (field.required && !data.kdePayload?.[field.name]) {
          if (!gaps.find(gap => gap.field === field.name)) {
            gaps.push({ field: field.name, message: `${field.label || field.name} is required` });
          }
        }
      });
    }
  });

  return gaps.length > 0 ? gaps : null;
};

module.exports = { checkComplianceGaps };
