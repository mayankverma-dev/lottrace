/**
 * P1-17 regression tests — Knex environment wiring.
 *
 * The audit found `backend/knexfile.js` hardcoding
 * `ssl: { rejectUnauthorized: false }` for production. These tests load the
 * real knexfile and assert the resolved production connection verifies
 * certificates.
 */

const ENV_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'DB_TLS_INSECURE',
  'DB_SSL_CA',
  'DB_SSL_CA_PATH',
];

const LOCAL_URL = 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test';
const TLS_URL = `${LOCAL_URL}?sslmode=require`;
const NEON_URL = 'postgresql://lottrace:lottrace@ep-test.neon.tech/lottrace_test';

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const restoreEnv = () => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  });
};

const loadKnexfile = (overrides = {}) => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
  Object.entries(overrides).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  let config;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    config = require('../../knexfile');
  });
  return config;
};

describe('knexfile TLS wiring', () => {
  afterEach(() => {
    restoreEnv();
    jest.restoreAllMocks();
  });

  it('verifies certificates in the production connection', () => {
    const config = loadKnexfile({
      NODE_ENV: 'production',
      DATABASE_URL: TLS_URL,
      DB_TLS_INSECURE: undefined,
    });

    expect(config.production.connection.ssl.rejectUnauthorized).toBe(true);
    expect(config.production.connection.connectionString).not.toMatch(/sslmode=/);
  });

  it('never emits rejectUnauthorized:false for production', () => {
    const config = loadKnexfile({
      NODE_ENV: 'production',
      DATABASE_URL: TLS_URL,
      DB_TLS_INSECURE: undefined,
    });

    expect(JSON.stringify(config.production.connection)).not.toContain(
      '"rejectUnauthorized":false',
    );
  });

  it('warns when the insecure flag is active in development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadKnexfile({
      NODE_ENV: 'development',
      DATABASE_URL: TLS_URL,
      DB_TLS_INSECURE: 'true',
    });

    expect(config.development.connection.ssl.rejectUnauthorized).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/DB_TLS_INSECURE.*verification is DISABLED/),
    );
  });

  it('rejects the insecure flag in production', () => {
    const config = loadKnexfile({
      NODE_ENV: 'production',
      DATABASE_URL: TLS_URL,
      DB_TLS_INSECURE: 'true',
    });

    expect(() => config.production).toThrow(/DB_TLS_INSECURE/);
  });

  it('does not infer TLS from a neon.tech hostname in development', () => {
    const config = loadKnexfile({
      NODE_ENV: 'development',
      DATABASE_URL: NEON_URL,
      DB_TLS_INSECURE: undefined,
    });

    expect(config.development.connection).toBe(NEON_URL);
  });

  it('keeps the existing pool sizes', () => {
    const config = loadKnexfile({
      NODE_ENV: 'development',
      DATABASE_URL: LOCAL_URL,
      DB_TLS_INSECURE: undefined,
    });

    expect(config.development.pool).toEqual({ min: 2, max: 10 });
    expect(config.test.pool).toEqual({ min: 2, max: 10 });
    expect(config.staging.pool).toEqual({ min: 2, max: 20 });
    expect(config.production.pool).toEqual({ min: 5, max: 30 });
  });
});
