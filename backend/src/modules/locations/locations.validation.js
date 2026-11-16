const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const LOCATION_TYPES = ['farm', 'plant', 'warehouse', 'distributor', 'retailer', 'other'];

const createLocationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(LOCATION_TYPES, { errorMap: () => ({ message: `Type must be one of: ${LOCATION_TYPES.join(', ')}` }) }),
  isExternal: z.boolean().optional().default(false),
  addressLine1: z.string().max(500).optional().nullable(),
  addressLine2: z.string().max(500).optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  state: z.string().max(255).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().max(2).optional().default('US'),
  gln: z.string().max(13).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
});

const updateLocationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  isExternal: z.boolean().optional(),
  addressLine1: z.string().max(500).optional().nullable(),
  addressLine2: z.string().max(500).optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  state: z.string().max(255).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().max(2).optional(),
  gln: z.string().max(13).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
});

const listLocationsSchema = z.object({
  ...paginationSchema.shape,
  type: z.enum(LOCATION_TYPES).optional(),
  isExternal: z.enum(['true', 'false']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  search: z.string().max(255).optional(),
  sort: z.enum(['name', 'createdAt', 'city', 'type']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

module.exports = {
  createLocationSchema,
  updateLocationSchema,
  listLocationsSchema,
  LOCATION_TYPES,
};
