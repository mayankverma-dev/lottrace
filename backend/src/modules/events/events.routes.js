const express = require('express');
const authenticate = require('../../middleware/authenticate');
const tenantScope = require('../../middleware/tenantScope');
const validate = require('../../middleware/validate');
const rbac = require('../../middleware/rbac');
const auditLogger = require('../../middleware/auditLogger');
const idempotency = require('../../middleware/idempotency');
const eventsController = require('./events.controller');
const {
  createEventSchema,
  voidEventSchema,
  amendEventSchema,
  attachmentUploadSchema,
  addAttachmentSchema,
} = require('./events.validation');

const router = express.Router();

router.use(authenticate);
router.use(tenantScope);

router.post(
  '/',
  rbac(['org_admin', 'compliance_manager', 'operator']),
  validate(createEventSchema),
  idempotency,
  eventsController.createEvent
);

router.get(
  '/',
  rbac(['org_admin', 'compliance_manager', 'auditor']),
  eventsController.getEvents
);

router.get(
  '/:eventId',
  rbac(['org_admin', 'compliance_manager', 'auditor']),
  eventsController.getEvent
);

router.post(
  '/:eventId/void',
  rbac(['org_admin', 'compliance_manager']),
  validate(voidEventSchema),
  idempotency,
  auditLogger('event'),
  eventsController.voidEvent
);

router.post(
  '/:eventId/amend',
  rbac(['org_admin', 'compliance_manager']),
  validate(amendEventSchema),
  idempotency,
  auditLogger('event'),
  eventsController.amendEvent
);

router.post(
  '/:eventId/attachments/presigned-url',
  rbac(['org_admin', 'compliance_manager', 'operator']),
  validate(attachmentUploadSchema),
  idempotency,
  eventsController.generateAttachmentUploadUrl
);

router.post(
  '/:eventId/attachments',
  rbac(['org_admin', 'compliance_manager', 'operator']),
  validate(addAttachmentSchema),
  idempotency,
  eventsController.addAttachment
);

module.exports = router;
