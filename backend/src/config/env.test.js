/**
 * P1-15 regression tests — boolean environment parsing.
 *
 * The bug: `z.coerce.boolean()` applied JavaScript truthiness to the raw string,
 * so `EMAIL_DRY_RUN=false` resolved to `true` and suppressed every email.
 *
 * Each case loads a fresh copy of `env.js` because the module validates and
 * caches `process.env` at require time.
 */

const REQUIRED_ENV = {
  DATABASE_URL: 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test',
  REDIS_URL: 'redis://localhost:6379',
  ACCESS_JWT_SECRET: 'a'.repeat(64),
  REFRESH_JWT_SECRET: 'b'.repeat(64),
  ARGON2_SECRET: 'c'.repeat(32),
  RESEND_API_KEY: 're_test_key',
  NODE_ENV: 'test',
};

const MANAGED_KEYS = [...Object.keys(REQUIRED_ENV), 'EMAIL_DRY_RUN', 'PORT'];
const ORIGINAL = {};

/**
 * Loads `env.js` with a clean module registry so the schema re-parses process.env.
 * @returns {Object}
 */
const loadEnv = () => {
  let env;
  jest.isolateModules(() => {
    env = require('./env');
  });
  return env;
};

beforeAll(() => {
  MANAGED_KEYS.forEach((key) => {
    ORIGINAL[key] = process.env[key];
  });
});

beforeEach(() => {
  Object.entries(REQUIRED_ENV).forEach(([key, value]) => {
    process.env[key] = value;
  });
  delete process.env.EMAIL_DRY_RUN;
  delete process.env.PORT;
});

afterAll(() => {
  MANAGED_KEYS.forEach((key) => {
    if (ORIGINAL[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL[key];
    }
  });
});

describe('EMAIL_DRY_RUN parsing', () => {
  it.each([
    ['false', false],
    ['FALSE', false],
    ['False', false],
    ['  false  ', false],
    ['0', false],
    ['true', true],
    ['TRUE', true],
    ['  true  ', true],
    ['1', true],
  ])('resolves %p to %p', (raw, expected) => {
    process.env.EMAIL_DRY_RUN = raw;

    expect(loadEnv().EMAIL_DRY_RUN).toBe(expected);
  });

  it('defaults to false when unset', () => {
    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('treats an empty string as unset', () => {
    process.env.EMAIL_DRY_RUN = '';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it.each(['yes', 'no', 'off', '2'])('rejects %p with a clear validation error', (raw) => {
    process.env.EMAIL_DRY_RUN = raw;

    let error;
    try {
      loadEnv();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.issues).toEqual([
      expect.objectContaining({
        path: ['EMAIL_DRY_RUN'],
        message: 'Must be one of: true, false, 1, 0',
      }),
    ]);
  });

  it('accepts NODE_ENV=test for the Jest environment', () => {
    expect(loadEnv().NODE_ENV).toBe('test');
  });
});

describe('env schema still coerces other types', () => {
  it('coerces PORT to a number and keeps the default', () => {
    const env = loadEnv();

    expect(env.PORT).toBe(3000);
  });

  it('coerces a provided PORT to a number', () => {
    process.env.PORT = '4321';

    expect(loadEnv().PORT).toBe(4321);
  });
});
