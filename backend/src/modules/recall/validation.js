const { z } = require('zod');
const { paginationSchema } = require('../../utils/pagination');

const runSimulationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  triggeringLotId: z.string().uuid('Invalid lot ID'),
  params: z.record(z.any()).optional().default({}),
});

const listSimulationsQuerySchema = paginationSchema;

module.exports = {
  runSimulationSchema,
  listSimulationsQuerySchema,
};
