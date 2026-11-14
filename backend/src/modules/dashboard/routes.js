const express = require('express');
const router = express.Router();
const controller = require('./controller');
const authenticate = require('../../middleware/authenticate');
const rbac = require('../../middleware/rbac');
const tenantScope = require('../../middleware/tenantScope');

router.use(authenticate, tenantScope);

router.get(
  '/stats',
  rbac(['org_admin', 'compliance_manager', 'operator', 'auditor']),
  controller.getStats
);

router.get(
  '/activity',
  rbac(['org_admin', 'compliance_manager', 'operator', 'auditor']),
  controller.getActivityFeed
);

module.exports = router;
