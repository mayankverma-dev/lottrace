/**
 * P2-48 — credentialed CORS origin allowlist.
 *
 * Pure unit tests: no Express app or HTTP requests are started.
 */

const { resolveCorsOrigins } = require('./corsOrigins');

describe('resolveCorsOrigins', () => {
  it.each(['development', 'test'])('adds loopback equivalents in %p', (nodeEnv) => {
    expect(resolveCorsOrigins({ NODE_ENV: nodeEnv })).toEqual([
      'http://localhost:3001',
      'http://localhost:3002',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3002',
    ]);
  });

  it.each(['staging', 'production'])('uses only configured origins in %p', (nodeEnv) => {
    expect(
      resolveCorsOrigins({
        NODE_ENV: nodeEnv,
        FRONTEND_URL: 'https://app.example.com',
        SCAN_PWA_URL: 'https://scan.example.com',
      }),
    ).toEqual(['https://app.example.com', 'https://scan.example.com']);
  });

  it('never injects loopback origins into a production deploy that uses defaults', () => {
    expect(resolveCorsOrigins({ NODE_ENV: 'production' })).toEqual([
      'http://localhost:3001',
      'http://localhost:3002',
    ]);
  });

  it('adds loopback equivalents for HTTPS local origins', () => {
    expect(
      resolveCorsOrigins({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://localhost:3001',
        SCAN_PWA_URL: 'https://localhost:3002',
      }),
    ).toEqual([
      'https://localhost:3001',
      'https://localhost:3002',
      'https://127.0.0.1:3001',
      'https://127.0.0.1:3002',
    ]);
  });

  it('does not duplicate an explicitly configured loopback origin', () => {
    expect(
      resolveCorsOrigins({
        NODE_ENV: 'development',
        FRONTEND_URL: 'http://127.0.0.1:3001',
        SCAN_PWA_URL: 'http://127.0.0.1:3001',
      }),
    ).toEqual(['http://127.0.0.1:3001']);
  });

  it('strips trailing slashes and trims whitespace', () => {
    expect(
      resolveCorsOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: ' https://app.example.com/ ',
        SCAN_PWA_URL: 'https://scan.example.com///',
      }),
    ).toEqual(['https://app.example.com', 'https://scan.example.com']);
  });

  it.each(['', 'app.example.com', 'ftp://app.example.com', 'https://', null])(
    'rejects invalid origin: %p',
    (value) => {
      expect(() =>
        resolveCorsOrigins({ NODE_ENV: 'development', FRONTEND_URL: value }),
      ).toThrow(/CORS origin|Invalid CORS origin/);
    },
  );
});
