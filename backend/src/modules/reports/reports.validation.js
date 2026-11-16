const { z } = require('zod');
const { auditLogFiltersSchema } = require('../audit/audit.validation');

const listComplianceGapsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
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
