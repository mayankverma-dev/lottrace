/* eslint-disable no-console */
const crypto = require('crypto');
const uuid = require('uuid');
const argon2 = require('argon2');

const { assertSeedAllowed } = require('../seedGuard');

const SYSTEM_ORG = {
  name: 'LotTrace System',
  slug: 'lottrace-system',
  industryVertical: 'software',
  planTier: 'enterprise',
  status: 'active',
};

const SUPER_ADMIN_EMAIL = 'admin@lottrace.com';
const MIN_SEED_PASSWORD_LENGTH = 12;

const hashPassword = (password) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

const hasPasswordOverride = (env = process.env) =>
  env.SEED_SUPER_ADMIN_PASSWORD !== undefined && env.SEED_SUPER_ADMIN_PASSWORD !== '';

/**
 * Returns the password to apply on first insert, or when the operator explicitly
 * sets SEED_SUPER_ADMIN_PASSWORD. Existing passwords are never reset implicitly.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ value: string, source: 'env' | 'generated' }}
 */
const resolveSeedPassword = (env = process.env) => {
  if (hasPasswordOverride(env)) {
    const value = env.SEED_SUPER_ADMIN_PASSWORD;
    if (value.length < MIN_SEED_PASSWORD_LENGTH) {
      throw new Error(
        `SEED_SUPER_ADMIN_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`,
      );
    }
    return { value, source: 'env' };
  }

  return { value: crypto.randomBytes(18).toString('base64url'), source: 'generated' };
};

const upsertOrganization = async (trx) => {
  const existing = await trx('organizations').where({ slug: SYSTEM_ORG.slug }).first();

  if (!existing) {
    const [created] = await trx('organizations')
      .insert({
        id: uuid.v4(),
        name: SYSTEM_ORG.name,
        slug: SYSTEM_ORG.slug,
        industry_vertical: SYSTEM_ORG.industryVertical,
        plan_tier: SYSTEM_ORG.planTier,
        status: SYSTEM_ORG.status,
      })
      .returning('*');
    return created;
  }

  const [updated] = await trx('organizations')
    .where({ id: existing.id })
    .update({
      name: SYSTEM_ORG.name,
      industry_vertical: SYSTEM_ORG.industryVertical,
      plan_tier: SYSTEM_ORG.planTier,
      status: SYSTEM_ORG.status,
      updated_at: trx.fn.now(),
    })
    .returning('*');

  return updated;
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function (knex) {
  const target = await assertSeedAllowed();
  console.log(`[seed] Seeding ${target.database} @ ${target.host}:${target.port}`);

  await knex.transaction(async (trx) => {
    const org = await upsertOrganization(trx);
    const existingUser = await trx('users').where({ email: SUPER_ADMIN_EMAIL }).first();

    if (existingUser && existingUser.organization_id !== org.id) {
      throw new Error(
        `Seed user ${SUPER_ADMIN_EMAIL} already belongs to organization ` +
          `${existingUser.organization_id}; refusing to move or hijack it.`,
      );
    }

    if (!existingUser) {
      const credentials = resolveSeedPassword();
      const passwordHash = await hashPassword(credentials.value);

      await trx('users').insert({
        id: uuid.v4(),
        organization_id: org.id,
        first_name: 'Super',
        last_name: 'Admin',
        email: SUPER_ADMIN_EMAIL,
        password_hash: passwordHash,
        role: 'super_admin',
        status: 'active',
      });

      console.log(`[seed] Created super admin ${SUPER_ADMIN_EMAIL}.`);
      if (credentials.source === 'generated') {
        console.log(`[seed] One-time password: ${credentials.value}`);
        console.log('[seed] Store it now; it will not be printed again.');
      } else {
        console.log('[seed] Password set from SEED_SUPER_ADMIN_PASSWORD.');
      }
      return;
    }

    const updates = {
      first_name: 'Super',
      last_name: 'Admin',
      role: 'super_admin',
      status: 'active',
      updated_at: trx.fn.now(),
    };

    if (hasPasswordOverride()) {
      const credentials = resolveSeedPassword();
      updates.password_hash = await hashPassword(credentials.value);
      console.log('[seed] Super admin password reset from SEED_SUPER_ADMIN_PASSWORD.');
    } else {
      console.log(`[seed] Super admin ${SUPER_ADMIN_EMAIL} already exists; password preserved.`);
    }

    await trx('users').where({ id: existingUser.id }).update(updates);
  });
};

exports.resolveSeedPassword = resolveSeedPassword;
