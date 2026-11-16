const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const VALID_ROLES = ['org_admin', 'compliance_manager', 'operator', 'auditor'];

const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  role: z.enum(VALID_ROLES, { errorMap: () => ({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` }) }),
}).strict();

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  role: z.enum(VALID_ROLES, { errorMap: () => ({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` }) }).optional(),
}).strict();

const listUsersQuerySchema = z.object({
  ...paginationSchema.shape,
  status: z.enum(['invited', 'active', 'deactivated']).optional(),
  role: z.enum([...VALID_ROLES, 'super_admin']).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(['createdAt', 'firstName', 'lastName', 'email', 'role', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  inviteUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
};
