const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const auditLogFilterFields = {
  action: z.string().min(1).max(200).optional(),
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
};

const auditLogFiltersSchema = z.object(auditLogFilterFields).strict();

const getAuditLogQuerySchema = z.object({
  ...paginationSchema.shape,
  ...auditLogFilterFields,
});

module.exports = {
  auditLogFiltersSchema,
  getAuditLogQuerySchema,
};
