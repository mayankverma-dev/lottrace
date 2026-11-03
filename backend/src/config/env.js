const { z } = require('zod');

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

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
  EMAIL_DRY_RUN: z.coerce.boolean().default(false), // skip Resend API entirely, just log

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
});

/**
 * Validated environment variables.
 * Access all env vars through this module — never use process.env.X directly.
 */
const env = envSchema.parse(process.env);

module.exports = env;
