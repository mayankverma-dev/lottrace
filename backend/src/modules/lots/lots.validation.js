const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const createLotSchema = z.object({
  productId: z.string().uuid('Invalid Product ID'),
  traceabilityLotCode: z.string().min(1, 'Lot code is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be positive'),
  uom: z.string().min(1, 'Unit of measure is required').max(20),
  notes: z.string().max(1000).optional().nullable(),
});

const updateLotSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
  quantity: z.coerce.number().positive('Quantity must be positive').optional(),
});

const voidLotSchema = z.object({
  voidReason: z.string().min(1, 'Void reason is required').max(1000),
});

const listLotsSchema = z.object({
  ...paginationSchema.shape,
  productId: z.string().uuid().optional(),
  traceabilityLotCode: z.string().min(1, 'Cannot be empty').max(255).optional(),
  status: z.enum(['active', 'recalled', 'void']).optional(),
  search: z.string().max(255).optional(),
  sort: z.enum(['traceabilityLotCode', 'createdAt', 'quantity', 'status']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

module.exports = {
  createLotSchema,
  updateLotSchema,
  voidLotSchema,
  listLotsSchema,
};
