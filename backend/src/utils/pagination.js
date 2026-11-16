const { z } = require('zod');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Builds the single pagination metadata shape used by every paginated endpoint.
 * See docs/API_STANDARDS.md.
 *
 * @param {number} total - Total matching rows
 * @param {number} page - 1-based page number
 * @param {number} limit - Rows per page
 * @returns {{ total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean }}
 */
const buildPagination = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit);

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

/**
 * Reusable pagination helper.
 * Takes a Knex query builder and pagination params,
 * returns { data, pagination } matching the API envelope.
 *
 * @param {import('knex').Knex.QueryBuilder} query - Knex query (before limit/offset)
 * @param {{ page?: number, limit?: number }} params
 * @returns {Promise<{ data: Array, pagination: Object }>}
 */
const paginate = async (query, { page = 1, limit = 20 } = {}) => {
  // Clamp limit
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safeLimit;

  // Clone query for count (before limit/offset applied)
  const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
  const [countResult, data] = await Promise.all([
    countQuery,
    query.limit(safeLimit).offset(offset),
  ]);

  const total = parseInt(countResult.total, 10);

  return {
    data,
    pagination: buildPagination(total, safePage, safeLimit),
  };
};

module.exports = { buildPagination, paginate, paginationSchema };
