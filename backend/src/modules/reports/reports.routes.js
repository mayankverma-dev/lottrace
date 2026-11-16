const express = require('express');
const router = express.Router();
const reportsController = require('./reports.controller');
const reportsValidation = require('./reports.validation');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const rbac = require('../../middleware/rbac');
const validate = require('../../middleware/validate');
const auditLogger = require('../../middleware/auditLogger');
const { exportLimiter } = require('../../middleware/rateLimiter');

router.use(authenticate);
router.use(tenantScope);

// Any role may read compliance gaps. Auditors are read-only.
router.get(
  '/compliance-gaps',
  rbac(['org_admin', 'compliance_manager', 'operator', 'auditor']),
  validate({ query: reportsValidation.listComplianceGapsSchema }),
  reportsController.getComplianceGaps
);

// Only roles that may export data. Auditors are read-only per docs/RBAC.md.
router.post(
  '/export',
  rbac(['org_admin', 'compliance_manager']),
  exportLimiter,
  validate({ body: reportsValidation.requestExportSchema }),
  auditLogger('report'),
  reportsController.requestExport
);

router.get(
  '/exports/:exportId',
  rbac(['org_admin', 'compliance_manager']),
  validate({ params: reportsValidation.exportIdParamsSchema }),
  reportsController.getExport
);

router.get(
  '/exports/:exportId/download',
  rbac(['org_admin', 'compliance_manager']),
  validate({ params: reportsValidation.exportIdParamsSchema }),
  auditLogger('report'),
  reportsController.downloadExport
);

module.exports = router;
