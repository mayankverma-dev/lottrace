/**
 * P2-06 unit tests — default infrastructure credential guard.
 *
 * These tests do not load `env.js`, so no database or Redis connection is
 * required. They pin the staging/production refusal and the development
 * warning path.
 */

const {
  DEFAULT_SECRETS,
  isDefaultSecret,
  findDatabaseCredentialIssues,
  findCredentialIssues,
  assertNoDefaultCredentials,
  assertNoDefaultDatabaseCredentials,
} = require('./credentialSafety');

const STRONG_DB = 'postgresql://lottrace:4f8a2c9e7b1d6a3f@127.0.0.1:5432/lottrace';
const STRONG_REDIS = 'redis://:9c2e5a7b1f4d8c6e@127.0.0.1:6379';

const strongEnv = (overrides = {}) => ({
  NODE_ENV: 'production',
  DATABASE_URL: STRONG_DB,
  REDIS_URL: STRONG_REDIS,
  S3_ACCESS_KEY_ID: 'lottrace-minio',
  S3_SECRET_ACCESS_KEY: '8d1f4b7a2c5e9f3a',
  ...overrides,
});

describe('isDefaultSecret', () => {
  it.each(['lottrace', 'LOTTRACE', '  minioadmin  ', 'admin123', 'password'])(
    'flags the known default %p',
    (value) => {
      expect(isDefaultSecret(value)).toBe(true);
    },
  );

  it.each(['4f8a2c9e7b1d6a3f', 'lottrace-minio', '', undefined])('does not flag %p', (value) => {
    expect(isDefaultSecret(value)).toBe(false);
  });

  it('exposes the default list for documentation and tests', () => {
    expect(DEFAULT_SECRETS.has('lottrace')).toBe(true);
    expect(DEFAULT_SECRETS.has('minioadmin')).toBe(true);
  });
});

describe('findCredentialIssues', () => {
  it('returns no issues for strong infrastructure credentials', () => {
    expect(findCredentialIssues(strongEnv())).toEqual([]);
  });

  it('flags the local database password', () => {
    const issues = findCredentialIssues(
      strongEnv({ DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace' }),
    );

    expect(issues).toContain('DATABASE_URL uses a default password');
  });

  it('flags the runtime app URL in the full guard', () => {
    const issues = findCredentialIssues(
      strongEnv({
        APP_DATABASE_URL: 'postgresql://lottrace_app:lottrace@127.0.0.1:5432/lottrace',
      }),
    );

    expect(issues).toContain('APP_DATABASE_URL uses a default password');
  });

  it('flags a database URL without a password', () => {
    const issues = findCredentialIssues(
      strongEnv({ DATABASE_URL: 'postgresql://lottrace@127.0.0.1:5432/lottrace' }),
    );

    expect(issues).toContain('DATABASE_URL has no password');
  });

  it('flags a missing Redis password', () => {
    const issues = findCredentialIssues(strongEnv({ REDIS_URL: 'redis://127.0.0.1:6379' }));

    expect(issues).toContain('REDIS_URL has no password');
  });

  it('flags a Redis password equal to the username', () => {
    const issues = findCredentialIssues(
      strongEnv({ REDIS_URL: 'redis://redis:redis@127.0.0.1:6379' }),
    );

    expect(issues).toContain('REDIS_URL uses a default password');
  });

  it('flags the MinIO root credentials', () => {
    const issues = findCredentialIssues(
      strongEnv({ S3_ACCESS_KEY_ID: 'minioadmin', S3_SECRET_ACCESS_KEY: 'minioadmin' }),
    );

    expect(issues).toEqual([
      'S3_ACCESS_KEY_ID uses a default value',
      'S3_SECRET_ACCESS_KEY uses a default value',
    ]);
  });

  it('flags invalid connection URLs without leaking their contents', () => {
    const issues = findCredentialIssues(strongEnv({ DATABASE_URL: 'not-a-url' }));

    expect(issues).toContain('DATABASE_URL is not a valid URL');
    expect(issues.join(' ')).not.toContain('not-a-url');
  });
});

describe('findDatabaseCredentialIssues', () => {
  it('returns no issues for strong database URLs', () => {
    expect(findDatabaseCredentialIssues(strongEnv())).toEqual([]);
  });

  it('ignores an absent runtime app URL', () => {
    expect(findDatabaseCredentialIssues(strongEnv({ APP_DATABASE_URL: undefined }))).toEqual([]);
  });

  it('flags a default runtime app URL', () => {
    const issues = findDatabaseCredentialIssues(
      strongEnv({ APP_DATABASE_URL: 'postgresql://lottrace_app:lottrace@127.0.0.1:5432/lottrace' }),
    );

    expect(issues).toEqual(['APP_DATABASE_URL uses a default password']);
  });

  it('ignores Redis and S3 problems in the scoped check', () => {
    expect(
      findDatabaseCredentialIssues(
        strongEnv({ REDIS_URL: 'redis://127.0.0.1:6379', S3_ACCESS_KEY_ID: 'minioadmin' }),
      ),
    ).toEqual([]);
  });
});

describe('assertNoDefaultDatabaseCredentials', () => {
  it.each(['development', 'test'])('allows local defaults in %p', (nodeEnv) => {
    expect(() =>
      assertNoDefaultDatabaseCredentials({
        NODE_ENV: nodeEnv,
        DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace_test',
      }),
    ).not.toThrow();
  });

  it.each(['staging', 'production'])('rejects a default owner URL in %p', (nodeEnv) => {
    expect(() =>
      assertNoDefaultDatabaseCredentials(
        strongEnv({
          NODE_ENV: nodeEnv,
          DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace',
        }),
      ),
    ).toThrow(/Refusing to run database tooling in .* with default or missing credentials/);
  });

  it('rejects a default runtime app URL in production', () => {
    expect(() =>
      assertNoDefaultDatabaseCredentials(
        strongEnv({
          APP_DATABASE_URL: 'postgresql://lottrace_app:lottrace@127.0.0.1:5432/lottrace',
        }),
      ),
    ).toThrow(/APP_DATABASE_URL uses a default password/);
  });

  it('accepts strong database URLs in production', () => {
    expect(() =>
      assertNoDefaultDatabaseCredentials(
        strongEnv({
          APP_DATABASE_URL: 'postgresql://lottrace_app:7b1e4f8a2c9d6e3f@127.0.0.1:5432/lottrace',
        }),
      ),
    ).not.toThrow();
  });
});

describe('assertNoDefaultCredentials', () => {
  it('allows local defaults in development', () => {
    expect(() =>
      assertNoDefaultCredentials({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace',
        REDIS_URL: 'redis://127.0.0.1:6379',
        S3_ACCESS_KEY_ID: 'minioadmin',
        S3_SECRET_ACCESS_KEY: 'minioadmin',
      }),
    ).not.toThrow();
  });

  it('allows local defaults in test', () => {
    expect(() =>
      assertNoDefaultCredentials({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace_test',
        REDIS_URL: 'redis://127.0.0.1:6379',
      }),
    ).not.toThrow();
  });

  it.each(['staging', 'production'])('rejects default credentials in %s', (nodeEnv) => {
    expect(() =>
      assertNoDefaultCredentials(
        strongEnv({
          NODE_ENV: nodeEnv,
          DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace',
        }),
      ),
    ).toThrow(/Refusing to start in .* with default or missing infrastructure credentials/);
  });

  it('names the offending variable without echoing the secret', () => {
    let error;
    try {
      assertNoDefaultCredentials(
        strongEnv({ DATABASE_URL: 'postgresql://lottrace:lottrace@127.0.0.1:5432/lottrace' }),
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain('DATABASE_URL uses a default password');
    expect(error.message).not.toContain('lottrace:lottrace');
  });

  it('accepts strong credentials in production', () => {
    expect(() => assertNoDefaultCredentials(strongEnv())).not.toThrow();
  });
});
