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
  HASH_CHAIN_KEY_ID: 'test-k1',
  HASH_CHAIN_SECRET: 'd'.repeat(64),
  NODE_ENV: 'test',
};

const MANAGED_KEYS = [
  ...Object.keys(REQUIRED_ENV),
  'EMAIL_DRY_RUN',
  'HASH_CHAIN_OLD_KEYS',
  'PORT',
];
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
  delete process.env.HASH_CHAIN_OLD_KEYS;
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

describe('hash chain keyring', () => {
  it('requires HASH_CHAIN_KEY_ID', () => {
    delete process.env.HASH_CHAIN_KEY_ID;

    expect(loadEnv).toThrow();
  });

  it('requires HASH_CHAIN_SECRET of at least 32 characters', () => {
    process.env.HASH_CHAIN_SECRET = 'short';

    expect(loadEnv).toThrow();
  });

  it('rejects invalid HASH_CHAIN_OLD_KEYS JSON', () => {
    process.env.HASH_CHAIN_OLD_KEYS = '{not-json';

    expect(loadEnv).toThrow(/HASH_CHAIN_OLD_KEYS must be a JSON object/);
  });

  it('rejects old keys with short secrets', () => {
    process.env.HASH_CHAIN_OLD_KEYS = JSON.stringify({ 'test-k0': 'short' });

    expect(loadEnv).toThrow(/must be at least 32 characters/);
  });

  it('parses the rotation keyring into an object', () => {
    process.env.HASH_CHAIN_OLD_KEYS = JSON.stringify({
      'test-k0': 'e'.repeat(64),
      'test-k-1': 'f'.repeat(64),
    });

    const env = loadEnv();

    expect(env.HASH_CHAIN_KEY_ID).toBe('test-k1');
    expect(env.HASH_CHAIN_SECRET).toBe('d'.repeat(64));
    expect(env.HASH_CHAIN_OLD_KEYS).toEqual({
      'test-k0': 'e'.repeat(64),
      'test-k-1': 'f'.repeat(64),
    });
  });

  it('defaults an absent rotation map to an empty object', () => {
    delete process.env.HASH_CHAIN_OLD_KEYS;

    expect(loadEnv().HASH_CHAIN_OLD_KEYS).toEqual({});
  });
});
