const apiResponse = require('../../utils/apiResponse');
const lotsService = require('./lots.service');

const createLot = async (req, res) => {
  const lot = await lotsService.createLot(
    req.validatedBody,
    req.organizationId,
    req.user.id,
    { ipAddress: req.ip }
  );
  return apiResponse.created(res, lot, 'Lot created successfully');
};

const listLots = async (req, res) => {
  const { data, pagination } = await lotsService.listLots(req.validatedQuery, req.organizationId);
  return apiResponse.paginated(res, data, pagination, 'Lots fetched successfully');
};

const getLot = async (req, res) => {
  const lot = await lotsService.getLot(req.params.lotId, req.organizationId);
  return apiResponse.success(res, lot, 'Lot fetched successfully');
};

const updateLot = async (req, res) => {
  const lot = await lotsService.updateLot(
    req.params.lotId,
    req.validatedBody,
    req.organizationId,
    req.user.id,
    { ipAddress: req.ip }
  );
  return apiResponse.success(res, lot, 'Lot updated successfully');
};

const voidLot = async (req, res) => {
  const lot = await lotsService.voidLot(
    req.params.lotId,
    req.validatedBody.voidReason,
    req.organizationId,
    req.user.id,
    { ipAddress: req.ip }
  );
  return apiResponse.success(res, lot, 'Lot voided successfully');
};

module.exports = {
  createLot,
  listLots,
  getLot,
  updateLot,
  voidLot,
};
