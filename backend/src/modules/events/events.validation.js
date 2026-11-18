const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const lotLinkSchema = z.object({
  lotId: z.string().uuid(),
  quantity: z.number().positive(),
  uom: z.string().min(1),
});

const createEventSchema = z.object({
  eventType: z.enum(['creation', 'receiving', 'transformation', 'shipping']),
  locationId: z.string().uuid().optional(),
  eventDatetime: z.string().datetime(),
  source: z.enum(['manual', 'scan', 'import', 'api']).default('manual'),
  kdePayload: z.record(z.any()).default({}),
  notes: z.string().optional(),
  counterpartyInfo: z.record(z.any()).optional(),
  inputs: z.array(lotLinkSchema).default([]),
  outputs: z.array(lotLinkSchema).default([]),
}).refine(data => {
  if (data.eventType === 'creation') {
    return data.outputs.length > 0;
  }
  if (data.eventType === 'receiving') {
    return data.inputs.length > 0;
  }
  if (data.eventType === 'transformation') {
    return data.inputs.length > 0 && data.outputs.length > 0;
  }
  if (data.eventType === 'shipping') {
    return data.inputs.length > 0;
  }
  return true;
}, {
  message: "Invalid inputs/outputs for the specified eventType",
}).refine(data => data.eventType !== 'shipping' || data.outputs.length === 0, {
  message: "Shipping events have no output lots",
  path: ["outputs"],
}).refine(data => data.eventType !== 'receiving' || data.outputs.length === 0, {
  message: "Receiving events have no output lots",
  path: ["outputs"],
}).refine(data => data.eventType !== 'receiving' || Boolean(data.locationId), {
  message: "Receiving location is required",
  path: ["locationId"],
});

const amendEventSchema = createEventSchema.and(z.object({
  amendReason: z.string().min(1, "Reason is required to amend an event"),
}));

const voidEventSchema = z.object({
  voidReason: z.string().min(1, "Void reason is required"),
});

const attachmentUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
}).strict();

const addAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
}).strict();

const attachmentIdParamsSchema = z.object({
  attachmentId: z.string().uuid(),
}).strict();

const listAttachmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const getEventsQuerySchema = z.object({
  ...paginationSchema.shape,
  eventType: z.enum(['creation', 'receiving', 'transformation', 'shipping']).optional(),
  status: z.enum(['active', 'amended', 'void']).optional(),
  source: z.enum(['manual', 'scan', 'import', 'api']).optional(),
  locationId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

module.exports = {
  createEventSchema,
  amendEventSchema,
  voidEventSchema,
  attachmentUploadSchema,
  addAttachmentSchema,
  attachmentIdParamsSchema,
  listAttachmentsQuerySchema,
  getEventsQuerySchema,
};
