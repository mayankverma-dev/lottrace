const { z } = require('zod');

const auditLogFilterFields = {
  action: z.string().min(1).max(200).optional(),
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
};

const auditLogFiltersSchema = z.object(auditLogFilterFields).strict();

const getAuditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  ...auditLogFilterFields,
});

module.exports = {
  auditLogFiltersSchema,
  getAuditLogQuerySchema,
};
