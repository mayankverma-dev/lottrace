const { z } = require('zod');
const { auditLogFiltersSchema } = require('../audit/audit.validation');
const { paginationSchema } = require('../../utils/pagination');

const listComplianceGapsSchema = z.object({
  ...paginationSchema.shape,
});

const requestExportSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('events'),
    format: z.enum(['csv', 'json']).optional().default('csv'),
  }).strict(),
  z.object({
    type: z.literal('audit'),
    format: z.enum(['csv', 'json']).optional().default('csv'),
    filters: auditLogFiltersSchema.optional().default({}),
  }).strict(),
]);

const exportIdParamsSchema = z.object({
  exportId: z.string().uuid('Must be a valid export ID'),
});

module.exports = {
  listComplianceGapsSchema,
  requestExportSchema,
  exportIdParamsSchema,
};
