const crypto = require('crypto');

jest.mock('../config/rateLimitRedis', () => ({ call: jest.fn() }));
jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn(),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  })),
}));

const {
  apiKeyGenerator,
  authKeyGenerator,
  userKeyGenerator,
  exportKeyGenerator,
} = require('./rateLimiter');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

describe('apiKeyGenerator', () => {
  it('keys IPv4 clients by address', () => {
    expect(apiKeyGenerator({ ip: '203.0.113.5' })).toBe('ip:203.0.113.5');
  });

  it('groups IPv6 clients by /56', () => {
    expect(apiKeyGenerator({ ip: '2001:db8:abcd:1234::1' })).toBe(
      'ip:2001:db8:abcd:1200::/56'
    );
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(apiKeyGenerator({ ip: '::ffff:203.0.113.5' })).toBe('ip:203.0.113.5');
  });
});

describe('authKeyGenerator', () => {
  it('normalizes and hashes the email, then includes the client IP', () => {
    const key = authKeyGenerator({
      body: { email: '  USER@Example.COM ' },
      ip: '203.0.113.5',
    });

    expect(key).toBe(`email:${sha256('user@example.com')}:203.0.113.5`);
    expect(key).not.toContain('USER@Example.COM');
  });

  it('gives the same key to case and whitespace variants', () => {
    const first = authKeyGenerator({ body: { email: 'User@Example.com' }, ip: '203.0.113.5' });
    const second = authKeyGenerator({ body: { email: ' user@example.COM ' }, ip: '203.0.113.5' });

    expect(first).toBe(second);
  });

  it('gives different emails different keys', () => {
    const first = authKeyGenerator({ body: { email: 'a@example.com' }, ip: '203.0.113.5' });
    const second = authKeyGenerator({ body: { email: 'b@example.com' }, ip: '203.0.113.5' });

    expect(first).not.toBe(second);
  });

  it('falls back to the refresh-token hash', () => {
    const key = authKeyGenerator({
      body: {},
      cookies: { refreshToken: 'raw-refresh-token' },
      ip: '203.0.113.5',
    });

    expect(key).toBe(`refresh:${sha256('raw-refresh-token')}:203.0.113.5`);
    expect(key).not.toContain('raw-refresh-token');
  });

  it('falls back to the body-token hash', () => {
    const key = authKeyGenerator({
      body: { token: 'raw-reset-token' },
      ip: '203.0.113.5',
    });

    expect(key).toBe(`token:${sha256('raw-reset-token')}:203.0.113.5`);
    expect(key).not.toContain('raw-reset-token');
  });

  it('prefers the email over refresh and body tokens', () => {
    const key = authKeyGenerator({
      body: { email: 'a@example.com', token: 'raw-token' },
      cookies: { refreshToken: 'raw-refresh-token' },
      ip: '203.0.113.5',
    });

    expect(key).toBe(`email:${sha256('a@example.com')}:203.0.113.5`);
  });

  it('falls back to the client IP when no identity is present', () => {
    expect(authKeyGenerator({ ip: '2001:db8:abcd:1234::1' })).toBe(
      'ip:2001:db8:abcd:1200::/56'
    );
  });
});

describe('userKeyGenerator', () => {
  it('keys by authenticated user id', () => {
    expect(userKeyGenerator({ user: { id: 'user-1' }, ip: '203.0.113.5' })).toBe('user:user-1');
  });

  it('falls back to the client IP', () => {
    expect(userKeyGenerator({ ip: '203.0.113.5' })).toBe('ip:203.0.113.5');
  });
});

describe('exportKeyGenerator', () => {
  it('keys by organization id', () => {
    expect(
      exportKeyGenerator({
        user: { organizationId: 'org-1' },
        ip: '203.0.113.5',
      })
    ).toBe('org:org-1');
  });

  it('falls back to the client IP', () => {
    expect(exportKeyGenerator({ ip: '203.0.113.5' })).toBe('ip:203.0.113.5');
  });
});
