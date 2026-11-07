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
};

const MANAGED_KEYS = [
  ...Object.keys(REQUIRED_ENV),
  'EMAIL_DRY_RUN',
  'PORT',
  'DB_TLS_INSECURE',
  'DB_SSL_CA',
  'DB_SSL_CA_PATH',
];
const ORIGINAL = {};

/**
 * Loads `env.js` with a clean module registry so the schema re-parses process.env.
 * @returns {Object}
 */
const loadEnv = () => {
  let env;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
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
  delete process.env.DB_TLS_INSECURE;
  delete process.env.DB_SSL_CA;
  delete process.env.DB_SSL_CA_PATH;
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
  it('resolves "false" to false (the regression)', () => {
    process.env.EMAIL_DRY_RUN = 'false';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('resolves "FALSE" to false', () => {
    process.env.EMAIL_DRY_RUN = 'FALSE';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    process.env.EMAIL_DRY_RUN = '  false  ';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('resolves "0" to false', () => {
    process.env.EMAIL_DRY_RUN = '0';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('resolves "true" to true', () => {
    process.env.EMAIL_DRY_RUN = 'true';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(true);
  });

  it('resolves "TRUE" to true', () => {
    process.env.EMAIL_DRY_RUN = 'TRUE';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(true);
  });

  it('resolves "1" to true', () => {
    process.env.EMAIL_DRY_RUN = '1';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(true);
  });

  it('defaults to false when unset', () => {
    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('treats an empty string as unset', () => {
    process.env.EMAIL_DRY_RUN = '';

    expect(loadEnv().EMAIL_DRY_RUN).toBe(false);
  });

  it('rejects "yes" with a message naming the variable and allowed values', () => {
    process.env.EMAIL_DRY_RUN = 'yes';

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

  it('rejects "2"', () => {
    process.env.EMAIL_DRY_RUN = '2';

    expect(() => loadEnv()).toThrow(/EMAIL_DRY_RUN/);
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

describe('database TLS environment variables', () => {
  it('defaults DB_TLS_INSECURE to false', () => {
    expect(loadEnv().DB_TLS_INSECURE).toBe(false);
  });

  it.each(['true', '1', 'TRUE'])('resolves DB_TLS_INSECURE=%s to true', (value) => {
    process.env.DB_TLS_INSECURE = value;

    expect(loadEnv().DB_TLS_INSECURE).toBe(true);
  });

  it.each(['false', '0', 'FALSE'])('resolves DB_TLS_INSECURE=%s to false', (value) => {
    process.env.DB_TLS_INSECURE = value;

    expect(loadEnv().DB_TLS_INSECURE).toBe(false);
  });

  it('rejects an invalid DB_TLS_INSECURE value', () => {
    process.env.DB_TLS_INSECURE = 'yes';

    expect(() => loadEnv()).toThrow(/DB_TLS_INSECURE/);
  });

  it('accepts DB_SSL_CA', () => {
    process.env.DB_SSL_CA = 'inline-ca';

    expect(loadEnv().DB_SSL_CA).toBe('inline-ca');
  });

  it('accepts DB_SSL_CA_PATH', () => {
    process.env.DB_SSL_CA_PATH = '/certs/ca.pem';

    expect(loadEnv().DB_SSL_CA_PATH).toBe('/certs/ca.pem');
  });

  it('rejects both CA sources at once', () => {
    process.env.DB_SSL_CA = 'inline-ca';
    process.env.DB_SSL_CA_PATH = '/certs/ca.pem';

    let error;
    try {
      loadEnv();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.issues).toEqual([
      expect.objectContaining({
        path: ['DB_SSL_CA_PATH'],
        message: 'Set only one of DB_SSL_CA or DB_SSL_CA_PATH',
      }),
    ]);
  });
});
