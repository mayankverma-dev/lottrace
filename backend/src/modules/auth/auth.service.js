const crypto = require('crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const knex = require('../../db/knex');
const { withTenantTransaction } = require('../../db/tenantTransaction');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const uuid = require('uuid');
const redis = require('../../config/redis');
const { emailQueue } = require('../../jobs/queues');
const logger = require('../../utils/logger');

const REFRESH_REUSE_GRACE_MS = 10 * 1000;
const TOKEN_CIPHER_ALGORITHM = 'aes-256-gcm';

const encryptionKey = () => crypto.createHash('sha256')
  .update(env.REFRESH_TOKEN_ENCRYPTION_KEY)
  .digest();

const encryptRefreshToken = (token) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.');
};

const decryptRefreshToken = (ciphertext) => {
  const [ivHex, tagHex, encryptedHex] = ciphertext.split('.');
  const decipher = crypto.createDecipheriv(
    TOKEN_CIPHER_ALGORITHM,
    encryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
};

/**
 * Generate a 6-digit OTP string
 * @returns {string}
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Hash an OTP with SHA-256
 * @param {string} otp
 * @returns {string}
 */
const hashOtp = (otp) => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

const generateTokens = (user, sessionFamily = uuid.v4()) => {
  const accessToken = jwt.sign(
    { sub: user.id, orgId: user.organization_id, role: user.role },
    env.ACCESS_JWT_SECRET,
    { expiresIn: '30m' }
  );

  const rawRefreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

  const decodedRefresh = jwt.sign(
    { sub: user.id, family: sessionFamily },
    env.REFRESH_JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, rawRefreshToken, refreshTokenHash, sessionFamily, decodedRefresh };
};

const register = async ({ firstName, lastName, email, password, organizationName }) => {
  const existingUser = await knex.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, true)', ['app.auth_email', email]);
    return trx('users').where({ email }).first();
  });
  if (existingUser) {
    if (existingUser.status === 'invited') {
      throw new AppError(
        'This email has a pending invitation. Accept the invitation from your inbox to continue.',
        'EMAIL_INVITED',
        409,
        [{
          field: 'email',
          message: 'Use the invitation link that was sent to this address instead of signing up.',
        }],
      );
    }

    throw new AppError('Email already in use', 'EMAIL_IN_USE', 400);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  // Generate verification OTP
  const otp = generateOtp();
  const otpHash = hashOtp(otp);

  const pendingPayload = {
    firstName,
    lastName,
    email,
    passwordHash,
    organizationName,
    otpHash
  };

  await redis.set(
    `signup:${email}`,
    JSON.stringify(pendingPayload),
    'EX',
    1800 // 30 minutes
  );

  // Queue verification email
  await emailQueue.add('verification_otp', {
    type: 'verification_otp',
    data: { email, otp, firstName },
  });

  // Don't issue tokens — user must verify email first
  return {
    requiresVerification: true,
    email,
  };
};

const login = async ({ email, password }) => {
  const user = await knex.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, true)', ['app.auth_email', email]);
    return trx('users').where({ email, status: 'active' }).first();
  });
  if (!user || !user.password_hash) {
    throw new AppError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    throw new AppError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
  }

  // Pending unverified users are now in Redis and won't exist in PostgreSQL.
  // We can remove the old !user.email_verified check here.

  const tokens = generateTokens(user);
  await withTenantTransaction(user.organization_id, async (trx) => {
    await trx('users').where({ id: user.id, organization_id: user.organization_id })
      .update({ last_login_at: trx.fn.now() });
    await trx('refresh_tokens').insert({
      user_id: user.id,
      token_hash: tokens.refreshTokenHash,
      session_family: tokens.sessionFamily,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  });

  return {
    user: { id: user.id, email: user.email, role: user.role, organizationId: user.organization_id },
    accessToken: tokens.accessToken,
    refreshToken: tokens.rawRefreshToken,
  };
};

/**
 * Verify email with 6-digit OTP
 * @param {{ email: string, otp: string }} params
 */
const verifyEmail = async ({ email, otp }) => {
  const otpHash = hashOtp(otp);

  const pendingStr = await redis.get(`signup:${email}`);
  if (!pendingStr) {
    throw new AppError('Invalid or expired verification code', 'INVALID_VERIFICATION_CODE', 400);
  }

  const payload = JSON.parse(pendingStr);
  if (payload.otpHash !== otpHash) {
    throw new AppError('Invalid verification code', 'INVALID_VERIFICATION_CODE', 400);
  }

  const result = await knex.transaction(async (trx) => {
    const orgId = uuid.v4();
    const orgSlug = payload.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    await trx('organizations').insert({
      id: orgId,
      name: payload.organizationName,
      slug: orgSlug + '-' + crypto.randomBytes(4).toString('hex'),
      plan_tier: 'starter',
      status: 'active',
    });
    await trx.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', orgId]);

    const userId = uuid.v4();

    const [user] = await trx('users').insert({
      id: userId,
      organization_id: orgId,
      first_name: payload.firstName,
      last_name: payload.lastName,
      email: payload.email,
      password_hash: payload.passwordHash,
      role: 'org_admin',
      status: 'active',
      last_login_at: trx.fn.now()
    }).returning('*');

    const tokens = generateTokens(user);

    await trx('refresh_tokens').insert({
      user_id: user.id,
      token_hash: tokens.refreshTokenHash,
      session_family: tokens.sessionFamily,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Queue welcome email
    await emailQueue.add('welcome', {
      type: 'welcome',
      data: {
        email: user.email,
        firstName: user.first_name,
        organizationName: payload.organizationName,
      },
    });

    await redis.del(`signup:${email}`);

    return {
      user: { id: user.id, email: user.email, role: user.role, organizationId: user.organization_id },
      accessToken: tokens.accessToken,
      refreshToken: tokens.rawRefreshToken,
    };
  });

  return result;
};

/**
 * Resend verification OTP
 * @param {{ email: string }} params
 */
const resendVerification = async ({ email }) => {
  const pendingStr = await redis.get(`signup:${email}`);

  if (!pendingStr) {
    // Silent success to prevent email enumeration
    return;
  }

  const ttl = await redis.ttl(`signup:${email}`);

  // Rate limit: don't resend if last OTP was sent < 2 minutes ago
  // Max TTL is 900. If current TTL > 780 (900 - 120), then < 2 mins have passed.
  if (ttl > 780) {
    throw new AppError(
      'Please wait before requesting a new verification code.',
      'RATE_LIMITED',
      429
    );
  }

  const payload = JSON.parse(pendingStr);
  const otp = generateOtp();
  payload.otpHash = hashOtp(otp);

  await redis.set(
    `signup:${email}`,
    JSON.stringify(payload),
    'EX',
    900 // reset 15 minutes
  );

  await emailQueue.add('verification_otp', {
    type: 'verification_otp',
    data: { email: payload.email, otp, firstName: payload.firstName },
  });
};

const refresh = async ({ refreshToken }) => {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const result = await knex.transaction(async (trx) => {
    const storedToken = await trx('refresh_tokens')
      .where({ token_hash: tokenHash })
      .forUpdate()
      .first();

    if (!storedToken) {
      throw new AppError('Invalid refresh token', 'INVALID_TOKEN', 401);
    }

    await trx.raw('SELECT set_config(?, ?, true)', ['app.auth_user_id', storedToken.user_id]);
    const user = await trx('users').where({ id: storedToken.user_id, status: 'active' }).first();
    if (!user) {
      throw new AppError('User not found or inactive', 'USER_INVALID', 401);
    }

    await trx.raw('SELECT set_config(?, ?, true)', ['app.current_org_id', user.organization_id]);

    if (new Date() > new Date(storedToken.expires_at)) {
      throw new AppError('Refresh token expired', 'TOKEN_EXPIRED', 401);
    }

    if (storedToken.is_used) {
      const rotatedAt = storedToken.rotated_at && new Date(storedToken.rotated_at).getTime();
      const withinGrace = rotatedAt && Date.now() - rotatedAt <= REFRESH_REUSE_GRACE_MS;
      if (withinGrace && storedToken.replacement_token_ciphertext) {
        const replacementRefreshToken = decryptRefreshToken(storedToken.replacement_token_ciphertext);
        const accessToken = jwt.sign(
          { sub: user.id, orgId: user.organization_id, role: user.role },
          env.ACCESS_JWT_SECRET,
          { expiresIn: '30m' }
        );
        return {
          user: { id: user.id, email: user.email, role: user.role, organizationId: user.organization_id },
          accessToken,
          refreshToken: replacementRefreshToken,
        };
      }

      await trx('refresh_tokens').where({ session_family: storedToken.session_family }).del();
      return { revoked: true };
    }

    const replacementId = uuid.v4();
    const tokens = generateTokens(user, storedToken.session_family);

    await trx('refresh_tokens').insert({
      id: replacementId,
      user_id: user.id,
      token_hash: tokens.refreshTokenHash,
      session_family: tokens.sessionFamily,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const affectedRows = await trx('refresh_tokens')
      .where({ id: storedToken.id, is_used: false })
      .update({
        is_used: true,
        replaced_by_token_id: replacementId,
        rotated_at: trx.fn.now(),
        replacement_token_ciphertext: encryptRefreshToken(tokens.rawRefreshToken),
      });
    if (affectedRows !== 1) {
      throw new AppError('Token reuse detected. Please login again.', 'TOKEN_REUSE', 401);
    }

    return {
      user: { id: user.id, email: user.email, role: user.role, organizationId: user.organization_id },
      accessToken: tokens.accessToken,
      refreshToken: tokens.rawRefreshToken,
    };
  });

  if (result.revoked) {
    throw new AppError('Token reuse detected. Please login again.', 'TOKEN_REUSE', 401);
  }

  return result;
};

const logout = async ({ refreshToken, accessToken }) => {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await knex('refresh_tokens').where({ token_hash: tokenHash }).update({ is_used: true });

  if (accessToken) {
    try {
      const decoded = jwt.decode(accessToken);
      if (decoded && decoded.exp) {
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
        if (expiresIn > 0) {
          await redis.set(`bl_${accessToken}`, 'revoked', 'EX', expiresIn);
        }
      }
    } catch (err) {
      // Ignore JWT decode errors on logout
    }
  }
};

const forgotPassword = async ({ email }) => {
  const user = await knex.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, true)', ['app.auth_email', email]);
    return trx('users').where({ email, status: 'active' }).first();
  });
  if (!user) {
    // Silently succeed to prevent email enumeration
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await withTenantTransaction(user.organization_id, (trx) => trx('users')
    .where({ id: user.id, organization_id: user.organization_id })
    .update({
      password_reset_token_hash: resetTokenHash,
      password_reset_expires_at: resetExpiresAt,
      updated_at: trx.fn.now()
    }));

  const emailService = require('../../utils/email');
  await emailService.sendPasswordResetEmail(user.email, resetToken);
};

const resetPassword = async ({ token, newPassword }) => {
  const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const user = await knex('users')
    .where({ password_reset_token_hash: resetTokenHash, status: 'active' })
    .first();

  if (!user || !user.password_reset_expires_at || new Date() > new Date(user.password_reset_expires_at)) {
    throw new AppError('Invalid or expired password reset token', 'INVALID_TOKEN', 400);
  }

  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

  return knex.transaction(async (trx) => {
    await trx('users')
      .where({ id: user.id })
      .update({
        password_hash: passwordHash,
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        updated_at: trx.fn.now()
      });

    await trx('refresh_tokens')
      .where({ user_id: user.id })
      .update({ is_used: true });
  });
};

/**
 * Accept an invite by setting a password and activating the account.
 * Mirrors shape of verifyEmail with token-based lookup.
 * @param {{ token: string, email: string, password: string }} params
 */
const acceptInvite = async ({ token, email, password }) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const user = await knex.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, true)', ['app.auth_email', email]);
    return trx('users').where({ email, invite_token_hash: tokenHash, status: 'invited' }).first();
  });

  if (!user || !user.invite_expires_at || new Date() > new Date(user.invite_expires_at)) {
    throw new AppError('Invalid or expired invitation', 'INVALID_TOKEN', 400);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  return withTenantTransaction(user.organization_id, async (trx) => {
    await trx('users')
      .where({ id: user.id })
      .update({
        password_hash: passwordHash,
        status: 'active',
        invite_token_hash: null,
        invite_expires_at: null,
        last_login_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    const tokens = generateTokens(user);

    await trx('refresh_tokens').insert({
      user_id: user.id,
      token_hash: tokens.refreshTokenHash,
      session_family: tokens.sessionFamily,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return {
      user: { id: user.id, email: user.email, role: user.role, organizationId: user.organization_id },
      accessToken: tokens.accessToken,
      refreshToken: tokens.rawRefreshToken,
    };
  });
};

module.exports = {
  register,
  login,
  verifyEmail,
  resendVerification,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  acceptInvite,
};
