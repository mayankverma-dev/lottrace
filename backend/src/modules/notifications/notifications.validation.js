const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const getNotificationsQuerySchema = z.object({
  ...paginationSchema.shape,
  unreadOnly: z.enum(['true', 'false']).optional(),
});

const markNotificationReadParamsSchema = z.object({
  id: z.string().uuid(),
});

module.exports = {
  getNotificationsQuerySchema,
  markNotificationReadParamsSchema,
};
