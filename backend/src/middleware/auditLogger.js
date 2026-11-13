const { writeAuditLog } = require('../utils/auditTrail');

/**
 * Middleware to log actions to audit_log.
 * @param {string} actionPrefix - e.g. 'event', 'lot'
 */
const auditLogger = (actionPrefix) => {
  return async (req, res, next) => {
    // Intercept res.json to log after successful request
    const originalJson = res.json;
    res.json = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setImmediate(async () => {
          try {
            let specificAction = `${actionPrefix}.${req.method.toLowerCase()}`;
            if (req.path.includes('/void')) specificAction = `${actionPrefix}.void`;
            if (req.path.includes('/amend')) specificAction = `${actionPrefix}.amend`;
            if (req.path.includes('/deactivate')) specificAction = `${actionPrefix}.deactivate`;
            if (req.path.includes('/reactivate')) specificAction = `${actionPrefix}.reactivate`;
            if (req.path.includes('/resend-invite')) specificAction = `${actionPrefix}.resend_invite`;
            if (req.path === '/invite' || req.path.endsWith('/invite')) specificAction = `${actionPrefix}.invite`;

            const targetId = req.params.id || req.params[`${actionPrefix}Id`];
            let entityId = targetId || body?.data?.id;
            const metadata = { url: req.originalUrl, query: req.query, body: req.body };

            // An amendment writes a new event; the audit row must point at the
            // replacement, with the superseded id kept for traceability.
            if (specificAction === `${actionPrefix}.amend` && body?.data?.id) {
              entityId = body.data.id;
              metadata.supersededEventId = targetId;
            }

            await writeAuditLog({
              organizationId: req.organizationId,
              actorId: req.user?.id,
              actorType: 'user',
              action: specificAction,
              entityType: actionPrefix,
              entityId,
              metadata,
              ipAddress: req.ip
            });
          } catch (err) {
            if (req.log && req.log.error) {
              req.log.error({ err }, 'Failed to write audit log from middleware');
            } else {
              console.error('Failed to write audit log from middleware:', err);
            }
          }
        });
      }
      originalJson.call(this, body);
    };
    next();
  };
};

module.exports = auditLogger;
