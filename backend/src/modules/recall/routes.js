const express = require('express');
const router = express.Router();
const controller = require('./controller');
const authenticate = require('../../middleware/authenticate');
const rbac = require('../../middleware/rbac');
const tenantScope = require('../../middleware/tenantScope');
const validate = require('../../middleware/validate');
const { runSimulationSchema, listSimulationsQuerySchema } = require('./validation');

router.use(authenticate, tenantScope);

router.post(
  '/',
  rbac(['org_admin', 'compliance_manager']),
  validate({ body: runSimulationSchema }),
  controller.runSimulation
);

router.get(
  '/',
  rbac(['org_admin', 'compliance_manager', 'auditor']),
  validate({ query: listSimulationsQuerySchema }),
  controller.listSimulations
);

router.get(
  '/:id',
  rbac(['org_admin', 'compliance_manager', 'auditor']),
  controller.getSimulation
);

module.exports = router;
