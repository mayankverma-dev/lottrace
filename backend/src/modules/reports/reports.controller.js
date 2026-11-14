const reportsService = require('./reports.service');
const apiResponse = require('../../utils/apiResponse');
const { exportQueue } = require('../../jobs/queues');

const getComplianceGaps = async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const result = await reportsService.getComplianceGaps(req.user.organizationId, { page, limit });

  return apiResponse.paginated(res, result.data, result.meta, 'Compliance gaps retrieved');
};

const requestExport = async (req, res) => {
  const { format } = req.validatedBody;

  const job = await exportQueue.add('export-events', {
    organizationId: req.user.organizationId,
    userId: req.user.id,
    format,
  });

  return apiResponse.success(res, { jobId: job.id }, 'Export job started', 202);
};

module.exports = {
  getComplianceGaps,
  requestExport,
};
