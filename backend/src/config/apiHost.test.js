/**
 * P2-42 — API listen address selection.
 *
 * Pure unit tests: no database, Redis, or HTTP server is started.
 */

const { resolveApiHost, LOOPBACK_HOST, CONTAINER_HOST } = require('./apiHost');

describe('resolveApiHost', () => {
  it.each(['development', 'test', undefined])('defaults to loopback for %p', (nodeEnv) => {
    expect(resolveApiHost({ NODE_ENV: nodeEnv })).toBe(LOOPBACK_HOST);
  });

  it.each(['staging', 'production'])('defaults to all interfaces for %p', (nodeEnv) => {
    expect(resolveApiHost({ NODE_ENV: nodeEnv })).toBe(CONTAINER_HOST);
  });

  it('honors an explicit loopback override in production', () => {
    expect(resolveApiHost({ NODE_ENV: 'production', API_HOST: '127.0.0.1' })).toBe(LOOPBACK_HOST);
  });

  it('honors an explicit all-interfaces override in development', () => {
    expect(resolveApiHost({ NODE_ENV: 'development', API_HOST: '0.0.0.0' })).toBe(CONTAINER_HOST);
  });

  it('accepts localhost and IPv6 literal addresses', () => {
    expect(resolveApiHost({ NODE_ENV: 'development', API_HOST: 'localhost' })).toBe('localhost');
    expect(resolveApiHost({ NODE_ENV: 'production', API_HOST: '::' })).toBe('::');
  });

  it('trims an explicit value', () => {
    expect(resolveApiHost({ NODE_ENV: 'test', API_HOST: '  127.0.0.1  ' })).toBe(LOOPBACK_HOST);
  });

  it.each(['', '   ', 'example.com', '0.0.0.0:3000', 'true'])(
    'ignores blank values and rejects invalid addresses: %p',
    (value) => {
      if (String(value).trim() === '') {
        expect(resolveApiHost({ NODE_ENV: 'test', API_HOST: value })).toBe(LOOPBACK_HOST);
      } else {
        expect(() => resolveApiHost({ NODE_ENV: 'test', API_HOST: value })).toThrow(
          /Invalid API_HOST/,
        );
      }
    },
  );
});
