const reportsService = require('./reports.service');
const apiResponse = require('../../utils/apiResponse');

const getComplianceGaps = async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const result = await reportsService.getComplianceGaps(req.user.organizationId, { page, limit });

  return apiResponse.paginated(res, result.data, result.pagination, 'Compliance gaps retrieved');
};

const requestExport = async (req, res) => {
  const record = await reportsService.requestExport(
    req.validatedBody,
    req.organizationId,
    req.user.id,
  );

  return apiResponse.success(res, record, 'Export queued', 202);
};

const getExport = async (req, res) => {
  const record = await reportsService.getExport(
    req.validatedParams.exportId,
    req.organizationId,
  );

  return apiResponse.success(res, record, 'Export retrieved');
};

const downloadExport = async (req, res) => {
  const download = await reportsService.getExportDownload(
    req.validatedParams.exportId,
    req.organizationId,
  );

  return apiResponse.success(res, download, 'Download URL generated');
};

module.exports = {
  getComplianceGaps,
  requestExport,
  getExport,
  downloadExport,
};
