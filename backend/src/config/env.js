const { z } = require('zod');
const { parseTrustProxy } = require('./trustProxy');
const { assertNoDefaultCredentials } = require('./credentialSafety');

const TRUE_VALUES = ['true', '1'];
const FALSE_VALUES = ['false', '0'];

/**
 * Parses a boolean environment variable from an explicit allowlist.
 *
 * `z.coerce.boolean()` applies JavaScript truthiness to the string value, so
 * `"false"`, `"0"`, `"no"` and `"off"` all become `true`. This helper accepts
 * only the documented values and fails startup on anything else.
 *
 * @param {boolean} [defaultValue]
 * @returns {import('zod').ZodEffects<import('zod').ZodOptional<import('zod').ZodString>, boolean, string | undefined>}
 */
const booleanEnv = (defaultValue = false) =>
  z
    .string()
    .optional()
    .superRefine((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return;
      const normalized = raw.trim().toLowerCase();
      if (![...TRUE_VALUES, ...FALSE_VALUES].includes(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Must be one of: true, false, 1, 0',
        });
      }
    })
    .transform((raw) => {
      if (raw === undefined || raw.trim() === '') return defaultValue;
      return TRUE_VALUES.includes(raw.trim().toLowerCase());
    });

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // JWT
  ACCESS_JWT_SECRET: z.string().min(64, 'ACCESS_JWT_SECRET must be at least 64 characters'),
  REFRESH_JWT_SECRET: z.string().min(64, 'REFRESH_JWT_SECRET must be at least 64 characters'),
  REFRESH_TOKEN_ENCRYPTION_KEY: z.string().min(32, 'REFRESH_TOKEN_ENCRYPTION_KEY must be at least 32 characters'),
  ARGON2_SECRET: z.string().min(16, 'ARGON2_SECRET must be at least 16 characters'),

  // Hash chain HMAC keyring. The secret lives only in the environment/KMS,
  // never in the database. `HASH_CHAIN_OLD_KEYS` keeps previous keys for
  // verification after rotation; writers always use the current pair.
  HASH_CHAIN_KEY_ID: z.string().min(1, 'HASH_CHAIN_KEY_ID is required'),
  HASH_CHAIN_SECRET: z.string().min(32, 'HASH_CHAIN_SECRET must be at least 32 characters'),
  HASH_CHAIN_OLD_KEYS: z.string().optional(),

  // Object Storage
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().default('lottrace-dev'),

  // Email (Resend)
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  EMAIL_FROM: z.string().default('LotTrace <onboarding@resend.dev>'),
  DEV_EMAIL_OVERRIDE: z.string().email().optional(), // Redirect ALL emails to this address in dev
  EMAIL_DRY_RUN: booleanEnv(false), // skip Resend API entirely, just log

  // App
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  // Listen address. When absent, development/test bind to loopback and
  // staging/production bind to all interfaces so containers stay reachable.
  API_HOST: z.string().optional(),
  FRONTEND_URL: z.string().default('http://localhost:3001'),
  SCAN_PWA_URL: z.string().default('http://localhost:3002'),

  // Express `trust proxy` setting. Set the exact hop count or a trusted
  // CIDR list when the API is behind a proxy; never trust every hop.
  TRUST_PROXY: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().optional(),
}).superRefine((value, ctx) => {
  const hasAccessKey = Boolean(value.S3_ACCESS_KEY_ID);
  const hasSecretKey = Boolean(value.S3_SECRET_ACCESS_KEY);

  if (hasAccessKey !== hasSecretKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasAccessKey ? 'S3_SECRET_ACCESS_KEY' : 'S3_ACCESS_KEY_ID'],
      message: 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together',
    });
  }
});

/**
 * Parses the optional rotation key map. Values are HMAC secrets for previous
 * key IDs; verification resolves a row's key ID from this map.
 *
 * @param {string|undefined} raw
 * @returns {Object<string, string>}
 */
const parseOldKeys = (raw) => {
  if (raw === undefined || raw.trim() === '') return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    throw new Error('HASH_CHAIN_OLD_KEYS must be a JSON object mapping key IDs to secrets');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('HASH_CHAIN_OLD_KEYS must be a JSON object mapping key IDs to secrets');
  }

  Object.entries(parsed).forEach(([keyId, secret]) => {
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new Error(`HASH_CHAIN_OLD_KEYS["${keyId}"] must be at least 32 characters`);
    }
  });

  return parsed;
};

// Validated environment variables.
// Access all env vars through this module — never use process.env.X directly.
const parsedEnv = envSchema.parse(process.env);
assertNoDefaultCredentials(parsedEnv);

module.exports = {
  ...parsedEnv,
  HASH_CHAIN_OLD_KEYS: parseOldKeys(parsedEnv.HASH_CHAIN_OLD_KEYS),
  TRUST_PROXY: parseTrustProxy(parsedEnv.TRUST_PROXY),
};
