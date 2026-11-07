/**
 * P1-17 regression tests — PostgreSQL TLS resolution.
 *
 * These tests do not open a database connection. They verify the connection
 * object that Knex/pg receives, so a future change cannot silently restore
 * `rejectUnauthorized: false` or hostname-substring detection.
 */

const {
  buildDatabaseConnection,
  parseBoolean,
  sanitizeDatabaseUrl,
} = require('./connectionConfig');

const LOCAL_URL = 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test';
const TLS_URL = `${LOCAL_URL}?sslmode=require`;
const NEON_URL = 'postgresql://lottrace:lottrace@ep-test.neon.tech/lottrace_test';

const build = (overrides = {}) =>
  buildDatabaseConnection({
    databaseUrl: LOCAL_URL,
    nodeEnv: 'development',
    ...overrides,
  });

describe('buildDatabaseConnection', () => {
  it('leaves a development URL without SSL as a plain connection string', () => {
    const { connection, tls } = build();

    expect(connection).toBe(LOCAL_URL);
    expect(tls).toMatchObject({
      enabled: false,
      rejectUnauthorized: false,
      insecure: false,
    });
  });

  it('forces verified TLS in production when the URL has no SSL directive', () => {
    const { connection, tls } = build({ nodeEnv: 'production' });

    expect(connection).toEqual({
      connectionString: LOCAL_URL,
      ssl: { rejectUnauthorized: true },
    });
    expect(tls).toMatchObject({
      enabled: true,
      rejectUnauthorized: true,
      mode: 'production-default',
    });
  });

  it('enables verified TLS for sslmode=require', () => {
    const { connection, tls } = build({ databaseUrl: TLS_URL });

    expect(connection.ssl).toEqual({ rejectUnauthorized: true });
    expect(connection.connectionString).not.toMatch(/sslmode=/);
    expect(tls).toMatchObject({
      enabled: true,
      rejectUnauthorized: true,
      mode: 'require',
    });
  });

  it.each(['verify-full', 'verify-ca', 'prefer'])(
    'enables verified TLS for sslmode=%s',
    (mode) => {
      const { connection, tls } = build({
        databaseUrl: `${LOCAL_URL}?sslmode=${mode}`,
      });

      expect(connection.ssl).toEqual({ rejectUnauthorized: true });
      expect(tls.mode).toBe(mode);
    },
  );

  it('honors sslmode=disable in development', () => {
    const { connection, tls } = build({
      databaseUrl: `${LOCAL_URL}?sslmode=disable`,
    });

    expect(connection).toBe(LOCAL_URL);
    expect(tls.enabled).toBe(false);
  });

  it('rejects sslmode=disable in production', () => {
    expect(() =>
      build({
        databaseUrl: `${LOCAL_URL}?sslmode=disable`,
        nodeEnv: 'production',
      }),
    ).toThrow(/TLS must be enabled in production/);
  });

  it('parses ssl=true and ssl=false', () => {
    const enabled = build({ databaseUrl: `${LOCAL_URL}?ssl=true` });
    const disabled = build({ databaseUrl: `${LOCAL_URL}?ssl=false` });

    expect(enabled.connection.ssl.rejectUnauthorized).toBe(true);
    expect(disabled.connection).toBe(LOCAL_URL);
  });

  it('rejects conflicting SSL directives', () => {
    expect(() =>
      build({ databaseUrl: `${LOCAL_URL}?sslmode=require&ssl=false` }),
    ).toThrow(/Conflicting SSL settings/);
  });

  it('requires DB_TLS_INSECURE for sslmode=no-verify', () => {
    expect(() =>
      build({ databaseUrl: `${LOCAL_URL}?sslmode=no-verify` }),
    ).toThrow(/DB_TLS_INSECURE/);
  });

  it('allows sslmode=no-verify with the insecure flag in development', () => {
    const { connection, tls } = build({
      databaseUrl: `${LOCAL_URL}?sslmode=no-verify`,
      tlsInsecure: 'true',
    });

    expect(connection.ssl.rejectUnauthorized).toBe(false);
    expect(tls.insecure).toBe(true);
  });

  it('rejects the insecure flag in staging and production', () => {
    expect(() => build({ nodeEnv: 'staging', tlsInsecure: 'true' })).toThrow(
      /only allowed when NODE_ENV is development or test/,
    );
    expect(() => build({ nodeEnv: 'production', tlsInsecure: 'true' })).toThrow(
      /only allowed when NODE_ENV is development or test/,
    );
  });

  it('rejects the insecure flag with explicit verify modes', () => {
    expect(() =>
      build({
        databaseUrl: `${LOCAL_URL}?sslmode=verify-full`,
        tlsInsecure: 'true',
      }),
    ).toThrow(/cannot be combined with sslmode=verify-full/);
  });

  it('does not infer TLS from a neon.tech hostname', () => {
    const { connection, tls } = build({ databaseUrl: NEON_URL });

    expect(connection).toBe(NEON_URL);
    expect(tls.enabled).toBe(false);
  });

  it('loads an inline CA and keeps verification enabled', () => {
    const ca = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';
    const { connection, tls } = build({ databaseUrl: TLS_URL, sslCa: ca });

    expect(connection.ssl).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    });
    expect(tls.caConfigured).toBe(true);
  });

  it('loads a CA from DB_SSL_CA_PATH', () => {
    const readFile = jest.fn(() => '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----');
    const { connection, tls } = build({
      databaseUrl: TLS_URL,
      sslCaPath: '/certs/ca.pem',
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith('/certs/ca.pem', 'utf8');
    expect(connection.ssl.ca).toContain('BEGIN CERTIFICATE');
    expect(tls.caConfigured).toBe(true);
  });

  it('rejects multiple CA sources', () => {
    expect(() =>
      build({
        databaseUrl: `${TLS_URL}&sslrootcert=/certs/url-ca.pem`,
        sslCaPath: '/certs/env-ca.pem',
      }),
    ).toThrow(/Configure only one CA source/);
  });

  it('loads and strips sslrootcert from the URL', () => {
    const readFile = jest.fn(() => 'URL CA');
    const { connection } = build({
      databaseUrl: `${TLS_URL}&sslrootcert=/certs/url-ca.pem`,
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith('/certs/url-ca.pem', 'utf8');
    expect(connection.ssl.ca).toBe('URL CA');
    expect(connection.connectionString).not.toMatch(/sslrootcert=/);
  });

  it('loads client certificate and key from the URL', () => {
    const readFile = jest
      .fn()
      .mockReturnValueOnce('CLIENT CERT')
      .mockReturnValueOnce('CLIENT KEY');
    const { connection, tls } = build({
      databaseUrl: `${TLS_URL}&sslcert=/certs/client.crt&sslkey=/certs/client.key`,
      readFile,
    });

    expect(connection.ssl.cert).toBe('CLIENT CERT');
    expect(connection.ssl.key).toBe('CLIENT KEY');
    expect(connection.connectionString).not.toMatch(/sslcert=|sslkey=/);
    expect(tls.certConfigured).toBe(true);
  });

  it('rejects a client certificate without a key', () => {
    expect(() =>
      build({ databaseUrl: `${TLS_URL}&sslcert=/certs/client.crt` }),
    ).toThrow(/sslcert and sslkey must be provided together/);
  });

  it('reports the path when a CA file cannot be read', () => {
    const readFile = jest.fn(() => {
      throw new Error('ENOENT: no such file');
    });

    expect(() =>
      build({
        databaseUrl: TLS_URL,
        sslCaPath: '/certs/missing.pem',
        readFile,
      }),
    ).toThrow(/\/certs\/missing\.pem/);
  });

  it('rejects a CA when TLS is disabled', () => {
    expect(() =>
      build({ sslCaPath: '/certs/ca.pem', readFile: () => 'CA' }),
    ).toThrow(/CA configured but TLS is disabled/);
  });

  it('rejects unknown sslmode values', () => {
    expect(() =>
      build({ databaseUrl: `${LOCAL_URL}?sslmode=allow` }),
    ).toThrow(/Unsupported sslmode/);
  });

  it('rejects uselibpqcompat=true', () => {
    expect(() =>
      build({ databaseUrl: `${TLS_URL}&uselibpqcompat=true` }),
    ).toThrow(/uselibpqcompat=true is not supported/);
  });

  it('preserves non-SSL query parameters', () => {
    const { connection } = build({
      databaseUrl: `${TLS_URL}&application_name=lottrace`,
    });

    expect(connection.connectionString).toContain('application_name=lottrace');
    expect(connection.connectionString).not.toContain('sslmode');
  });

  it('rejects invalid boolean values', () => {
    expect(() => parseBoolean('yes', 'DB_TLS_INSECURE')).toThrow(
      /DB_TLS_INSECURE must be one of/,
    );
  });

  it('sanitizes every SSL query parameter', () => {
    const sanitized = sanitizeDatabaseUrl(
      `${LOCAL_URL}?sslmode=require&ssl=true&sslrootcert=/ca.pem&sslcert=/c.crt&sslkey=/c.key&uselibpqcompat=true&application_name=x`,
    );

    expect(sanitized).toContain('application_name=x');
    ['sslmode', 'ssl=', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'].forEach(
      (key) => expect(sanitized).not.toContain(key),
    );
  });
});
