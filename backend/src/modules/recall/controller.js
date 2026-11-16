const service = require('./service');
const apiResponse = require('../../utils/apiResponse');

const runSimulation = async (req, res) => {
  const sim = await service.runSimulation(req.user.organizationId, req.user.id, req.body);
  return apiResponse.success(res, sim, 'Recall simulation completed', 201);
};

const listSimulations = async (req, res) => {
  const { data, pagination } = await service.listSimulations(req.user.organizationId, req.validatedQuery);
  return apiResponse.paginated(res, data, pagination, 'Simulations retrieved');
};

const getSimulation = async (req, res) => {
  const sim = await service.getSimulation(req.user.organizationId, req.params.id);
  return apiResponse.success(res, sim, 'Simulation retrieved');
};

module.exports = {
  runSimulation,
  listSimulations,
  getSimulation
};
