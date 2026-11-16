const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const kdeSchemaItemSchema = z.object({
  name: z.string().min(1, 'Field name is required').max(100).regex(/^[a-z][a-z0-9_]*$/, 'Field name must be snake_case'),
  label: z.string().min(1, 'Field label is required').max(200),
  type: z.enum(['string', 'number', 'boolean', 'date'], {
    errorMap: () => ({ message: 'Type must be one of: string, number, boolean, date' }),
  }),
  required: z.boolean().optional().default(false),
});

const createProductSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  sku: z.string().max(100).optional().nullable(),
  gtin: z.string().max(14).optional().nullable(),
  category: z.string().max(255).optional().nullable(),
  isFtl: z.boolean().optional().default(false),
  defaultUom: z.string().min(1).max(20).optional().default('kg'),
  customKdeSchema: z.array(kdeSchemaItemSchema).optional().default([]),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sku: z.string().max(100).optional().nullable(),
  gtin: z.string().max(14).optional().nullable(),
  category: z.string().max(255).optional().nullable(),
  isFtl: z.boolean().optional(),
  defaultUom: z.string().min(1).max(20).optional(),
  customKdeSchema: z.array(kdeSchemaItemSchema).optional(),
});

const listProductsSchema = z.object({
  ...paginationSchema.shape,
  category: z.string().max(255).optional(),
  isFtl: z.enum(['true', 'false']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  search: z.string().max(255).optional(),
  sort: z.enum(['name', 'createdAt', 'category', 'sku']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  kdeSchemaItemSchema,
};
