const db = require('../db/knex');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_RESULT_TTL_MS,
  IDEMPOTENCY_CLAIM_TTL_MS,
  normalizeIdempotencyKey,
  requestFingerprint,
} = require('../utils/idempotency');

/**
 * Reads the live idempotency row for this organization and key.
 * Expired rows are invisible: the caller may reclaim them.
 *
 * @param {string} organizationId
 * @param {string} key
 * @returns {Promise<Object|undefined>}
 */
const findLiveRow = (organizationId, key) => db('idempotency_keys')
  .where({ organization_id: organizationId, key })
  .andWhere('expires_at', '>', db.fn.now())
  .first();

/**
 * Claims the key for this request. Expired rows for the same key are deleted
 * first so an expired key executes anew. The unique `(organization_id, key)`
 * index makes exactly one concurrent claimant win.
 *
 * @param {string} organizationId
 * @param {string} key
 * @param {string} requestHash
 * @returns {Promise<boolean>} true when this request owns the claim
 */
const claimKey = async (organizationId, key, requestHash) => {
  await db('idempotency_keys')
    .where({ organization_id: organizationId, key })
    .andWhere('expires_at', '<=', db.fn.now())
    .del();

  const inserted = await db('idempotency_keys')
    .insert({
      organization_id: organizationId,
      key,
      request_hash: requestHash,
      response_status: null,
      response_body: null,
      expires_at: new Date(Date.now() + IDEMPOTENCY_CLAIM_TTL_MS),
    })
    .onConflict(['organization_id', 'key'])
    .ignore()
    .returning('id');

  return inserted.length === 1;
};

/**
 * Request idempotency for event creation.
 *
 * Must run AFTER authentication, tenant scope, and body validation, and BEFORE
 * the controller. Only 2xx responses are stored; any other status releases the
 * claim so the client can correct the request and retry with the same key.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const idempotency = async (req, res, next) => {
  const { key, error } = normalizeIdempotencyKey(req.headers[IDEMPOTENCY_HEADER]);

  if (error) {
    return apiResponse.validationError(res, [{ field: 'Idempotency-Key', message: error }]);
  }
  if (!key) return next();

  const organizationId = req.organizationId;
  if (!organizationId) {
    // Should be applied after tenantScope middleware.
    return next();
  }

  const requestHash = requestFingerprint({
    method: req.method,
    path: `${req.baseUrl}${req.path}`,
    body: req.validatedBody,
  });

  try {
    const existing = await findLiveRow(organizationId, key);

    if (existing) {
      if (existing.request_hash !== requestHash) {
        return apiResponse.error(
          res,
          'Idempotency key was already used with a different request',
          'IDEMPOTENCY_KEY_REUSED',
          409,
        );
      }
      if (existing.response_status === null) {
        return apiResponse.error(
          res,
          'An identical request is still being processed; retry with the same Idempotency-Key',
          'IDEMPOTENCY_KEY_IN_PROGRESS',
          409,
        );
      }
      return res.status(existing.response_status).json(existing.response_body);
    }

    const claimed = await claimKey(organizationId, key, requestHash);
    if (!claimed) {
      // Lost the insert race: re-read the winner.
      const winner = await findLiveRow(organizationId, key);
      if (winner && winner.request_hash !== requestHash) {
        return apiResponse.error(
          res,
          'Idempotency key was already used with a different request',
          'IDEMPOTENCY_KEY_REUSED',
          409,
        );
      }
      return apiResponse.error(
        res,
        'An identical request is still being processed; retry with the same Idempotency-Key',
        'IDEMPOTENCY_KEY_IN_PROGRESS',
        409,
      );
    }

    // This request owns the claim. Finalize it before the response leaves so a
    // retry that arrives immediately after sees a complete row.
    let responded = false;
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      if (responded) return originalJson(body);
      responded = true;

      const status = res.statusCode;
      const finalize = status >= 200 && status < 300
        ? db('idempotency_keys')
          .where({ organization_id: organizationId, key })
          .update({
            response_status: status,
            response_body: body,
            expires_at: new Date(Date.now() + IDEMPOTENCY_RESULT_TTL_MS),
          })
        : db('idempotency_keys')
          .where({ organization_id: organizationId, key })
          .del();

      finalize
        .catch((err) => {
          logger.error({ err, requestId: req.id }, 'Failed to finalize idempotency key');
        })
        .finally(() => originalJson(body));

      return res;
    };

    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = idempotency;
