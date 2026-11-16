const { z } = require('zod');

const listComplianceGapsSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

const requestExportSchema = z.object({
  format: z.enum(['csv', 'json']).optional().default('csv'),
}).strict();

const exportIdParamsSchema = z.object({
  exportId: z.string().uuid('Must be a valid export ID'),
});

module.exports = {
  listComplianceGapsSchema,
  requestExportSchema,
  exportIdParamsSchema,
};
