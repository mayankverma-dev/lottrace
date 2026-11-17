const apiResponse = require('../utils/apiResponse');
const db = require('../db/knex');
const {
  runTenantPostCommit,
  runWithTenantTransaction,
} = require('../db/tenantContext');
const logger = require('../utils/logger');

/**
 * Tenant scope middleware.
 * Ensures the request is scoped to an organization (from the JWT).
 * Attaches req.organizationId for downstream use.
 */
const tenantScope = async (req, res, next) => {
  if (!req.user || !req.user.organizationId) {
    return apiResponse.unauthorized(res, 'Organization scope missing');
  }

  const organizationId = req.user.organizationId;
  req.organizationId = organizationId;

  const transaction = await db.transaction();
  let completed = false;
  const postCommit = [];

  try {
    await transaction.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', organizationId]);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  const complete = async (commit) => {
    if (completed) return;
    completed = true;
    if (commit) {
      await transaction.commit();
      await runTenantPostCommit(postCommit, (error) => {
        if (req.log?.error) {
          req.log.error({ error }, 'Tenant post-commit callback failed');
        } else {
          logger.error({ error }, 'Tenant post-commit callback failed');
        }
      });
    } else {
      postCommit.length = 0;
      await transaction.rollback();
    }
  };

  res.once('finish', () => {
    const commit = res.statusCode < 400;
    complete(commit).catch(error => req.log?.error(
      { error, commit, statusCode: res.statusCode },
      commit ? 'Tenant transaction commit failed' : 'Tenant transaction rollback failed',
    ));
  });
  res.once('close', () => complete(false).catch(error => req.log?.error({ error }, 'Tenant transaction rollback failed')));

  return runWithTenantTransaction(transaction, () => next(), postCommit);
};

module.exports = tenantScope;
