const crypto = require('crypto');
const argon2 = require('argon2');
const uuid = require('uuid');

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
const SYSTEM_ORGANIZATION_SLUG = 'lottrace-system';
const SUPER_ADMIN_EMAIL = 'admin@lottrace.com';
const MIN_PASSWORD_LENGTH = 12;

/**
 * Parses an explicit opt-in flag. Anything other than true/1 (case-insensitive)
 * is treated as false so a typo never enables a remote write.
 * @param {string|boolean|undefined} value
 * @returns {boolean}
 */
const parseSeedFlag = (value) => {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['true', '1'].includes(value.trim().toLowerCase());
};

/**
 * Parses DATABASE_URL without exposing credentials in logs.
 * @param {string} databaseUrl
 * @returns {{ host: string, port: string, database: string, display: string }}
 */
const parseDatabaseTarget = (databaseUrl) => {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    throw new Error('DATABASE_URL is required to run the seed.');
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const display = host
    ? `${url.hostname}${url.port ? `:${url.port}` : ''}/${database}`
    : `(local socket)/${database}`;

  return { host, port: url.port || '', database, display };
};

/**
 * @param {string} host
 * @returns {boolean}
 */
const isLocalDatabaseHost = (host) => {
  if (!host) return false;
  return LOCAL_DATABASE_HOSTS.has(host.toLowerCase());
};

/**
 * Refuses production and unconfirmed remote databases before the seed touches
 * the database. Local disposable databases run directly.
 * @param {{
 *   databaseUrl: string,
 *   nodeEnv?: string,
 *   allowDestructiveSeed?: string|boolean,
 *   confirmRemote?: string|boolean,
 *   isInteractive?: boolean,
 * }} options
 * @returns {{ host: string, port: string, database: string, display: string, needsConfirmation: boolean }}
 */
const assertSeedingAllowed = ({
  databaseUrl,
  nodeEnv = 'development',
  allowDestructiveSeed,
  confirmRemote,
  isInteractive = false,
} = {}) => {
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to run the seed with NODE_ENV=production. Seeds are only for disposable development/test databases.'
    );
  }

  const target = parseDatabaseTarget(databaseUrl);

  if (isLocalDatabaseHost(target.host)) {
    return { ...target, needsConfirmation: false };
  }

  if (!parseSeedFlag(allowDestructiveSeed)) {
    throw new Error(
      `Refusing to seed remote database ${target.display}. Set ALLOW_DESTRUCTIVE_SEED=true only if you intend to write to it.`
    );
  }

  if (parseSeedFlag(confirmRemote)) {
    return { ...target, needsConfirmation: false };
  }

  if (!isInteractive) {
    throw new Error(
      'Remote seed requires confirmation. Re-run interactively or set SEED_CONFIRM_REMOTE=true for non-interactive runs.'
    );
  }

  return { ...target, needsConfirmation: true };
};

/**
 * @returns {string} A random password that satisfies the auth module's length rule.
 */
const generatePassword = () => crypto.randomBytes(24).toString('base64url');

/**
 * Decides whether the super-admin password should be provided, generated, or
 * preserved. Existing passwords are never reset unless explicitly requested.
 * @param {{
 *   providedPassword?: string,
 *   existingUser?: Object|null,
 *   passwordGenerator?: () => string,
 * }} options
 * @returns {{ password: string|null, generated: boolean, mode: 'provided'|'generated'|'preserved' }}
 */
const resolvePasswordDecision = ({
  providedPassword,
  existingUser,
  passwordGenerator = generatePassword,
} = {}) => {
  if (providedPassword !== undefined && providedPassword !== null && providedPassword !== '') {
    if (typeof providedPassword !== 'string' || providedPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `SEED_SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
    }
    return { password: providedPassword, generated: false, mode: 'provided' };
  }

  if (!existingUser || !existingUser.password_hash) {
    return { password: passwordGenerator(), generated: true, mode: 'generated' };
  }

  return { password: null, generated: false, mode: 'preserved' };
};

/**
 * Idempotently creates the LotTrace system organization and its super admin.
 * Never truncates or deletes rows.
 * @param {import('knex').Knex} knex
 * @param {{
 *   databaseUrl: string,
 *   nodeEnv?: string,
 *   allowDestructiveSeed?: string|boolean,
 *   confirmRemote?: string|boolean,
 *   isInteractive?: boolean,
 *   superAdminPassword?: string,
 *   confirmHost?: (target: Object) => Promise<boolean>|boolean,
 *   passwordGenerator?: () => string,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<{ organization: Object, user: Object, generatedPassword: string|null }>}
 */
const seedSuperAdmin = async (knex, options = {}) => {
  const target = assertSeedingAllowed(options);
  const log = typeof options.log === 'function' ? options.log : () => {};

  log(`Seed target: ${target.display}`);

  if (target.needsConfirmation) {
    if (typeof options.confirmHost !== 'function') {
      throw new Error('Remote seed confirmation is required but no confirmation handler was provided.');
    }
    const confirmed = await options.confirmHost(target);
    if (!confirmed) {
      throw new Error('Seed cancelled: remote database was not confirmed.');
    }
  }

  const result = await knex.transaction(async (trx) => {
    const [organization] = await trx('organizations')
      .insert({
        id: uuid.v4(),
        name: 'LotTrace System',
        slug: SYSTEM_ORGANIZATION_SLUG,
        industry_vertical: 'software',
        plan_tier: 'enterprise',
        status: 'active',
      })
      .onConflict('slug')
      .merge({
        name: 'LotTrace System',
        industry_vertical: 'software',
        plan_tier: 'enterprise',
        status: 'active',
        updated_at: trx.fn.now(),
      })
      .returning('*');

    const existingUser = await trx('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    if (existingUser && existingUser.organization_id !== organization.id) {
      throw new Error(
        `Cannot seed super admin: ${SUPER_ADMIN_EMAIL} already belongs to organization ${existingUser.organization_id}.`
      );
    }

    const passwordDecision = resolvePasswordDecision({
      providedPassword: options.superAdminPassword,
      existingUser,
      passwordGenerator: options.passwordGenerator,
    });

    const passwordHash = passwordDecision.password
      ? await argon2.hash(passwordDecision.password, { type: argon2.argon2id })
      : null;

    let user;

    if (existingUser) {
      const update = {
        organization_id: organization.id,
        first_name: 'Super',
        last_name: 'Admin',
        role: 'super_admin',
        status: 'active',
        updated_at: trx.fn.now(),
      };

      if (passwordHash) {
        update.password_hash = passwordHash;
      }

      [user] = await trx('users').where({ id: existingUser.id }).update(update).returning('*');
    } else {
      [user] = await trx('users')
        .insert({
          id: uuid.v4(),
          organization_id: organization.id,
          first_name: 'Super',
          last_name: 'Admin',
          email: SUPER_ADMIN_EMAIL,
          password_hash: passwordHash,
          role: 'super_admin',
          status: 'active',
        })
        .returning('*');
    }

    return { organization, user, passwordDecision };
  });

  log(
    `Seed complete: organization ${result.organization.slug} (${result.organization.id}); super admin ${result.user.email} (${result.user.id}).`
  );

  if (result.passwordDecision.mode === 'generated') {
    log(`Generated super admin password (shown once): ${result.passwordDecision.password}`);
    log('Save it now. Set SEED_SUPER_ADMIN_PASSWORD to choose a specific password.');
  } else if (result.passwordDecision.mode === 'provided') {
    log('Super admin password was set from SEED_SUPER_ADMIN_PASSWORD.');
  } else {
    log('Existing super admin password preserved.');
  }

  return {
    organization: result.organization,
    user: result.user,
    generatedPassword:
      result.passwordDecision.mode === 'generated' ? result.passwordDecision.password : null,
  };
};

module.exports = {
  LOCAL_DATABASE_HOSTS,
  MIN_PASSWORD_LENGTH,
  SUPER_ADMIN_EMAIL,
  SYSTEM_ORGANIZATION_SLUG,
  assertSeedingAllowed,
  generatePassword,
  isLocalDatabaseHost,
  parseDatabaseTarget,
  parseSeedFlag,
  resolvePasswordDecision,
  seedSuperAdmin,
};
