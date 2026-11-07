const { z } = require('zod');

const TRUE_VALUES = ['true', '1'];
const FALSE_VALUES = ['false', '0'];

/**
 * Parses a boolean environment variable from an explicit allowlist.
 *
 * `z.coerce.boolean()` is unusable here: it applies JavaScript truthiness to the
 * string value, so `"false"`, `"0"`, `"no"` and `"off"` all become `true`.
 *
 * Accepted: true|false|1|0, case-insensitive, trimmed. Unset or empty falls back
 * to `defaultValue`. Anything else fails validation at boot instead of silently
 * picking a direction.
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
  DB_SSL_CA: z.string().optional(),
  DB_SSL_CA_PATH: z.string().optional(),
  DB_TLS_INSECURE: booleanEnv(false),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // JWT
  ACCESS_JWT_SECRET: z.string().min(64, 'ACCESS_JWT_SECRET must be at least 64 characters'),
  REFRESH_JWT_SECRET: z.string().min(64, 'REFRESH_JWT_SECRET must be at least 64 characters'),
  ARGON2_SECRET: z.string().min(16, 'ARGON2_SECRET must be at least 16 characters'),

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
  FRONTEND_URL: z.string().default('http://localhost:3001'),
  SCAN_PWA_URL: z.string().default('http://localhost:3002'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.DB_SSL_CA && value.DB_SSL_CA_PATH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DB_SSL_CA_PATH'],
      message: 'Set only one of DB_SSL_CA or DB_SSL_CA_PATH',
    });
  }
});

/**
 * Validated environment variables.
 * Access all env vars through this module — never use process.env.X directly.
 */
const env = envSchema.parse(process.env);

module.exports = env;
