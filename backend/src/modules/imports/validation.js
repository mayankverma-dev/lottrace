const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const CTE_TYPES = ['creation', 'receiving', 'transformation', 'shipping'];

const createImportSchema = z.object({
  cte_type: z.enum(CTE_TYPES, { message: 'cte_type must be one of: creation, receiving, transformation, shipping' }),
});

const listImportsSchema = z.object({
  ...paginationSchema.shape,
  status: z.enum(['pending', 'processing', 'complete', 'complete_with_errors', 'failed']).optional(),
  cteType: z.enum(CTE_TYPES).optional(),
});

const getImportErrorsSchema = z.object({
  ...paginationSchema.shape,
});

const templateParamsSchema = z.object({
  cteType: z.enum(CTE_TYPES, { message: 'Invalid CTE type' }),
});

module.exports = {
  createImportSchema,
  listImportsSchema,
  getImportErrorsSchema,
  templateParamsSchema,
};
