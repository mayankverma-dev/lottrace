const {
  normalizeIdempotencyKey,
  requestFingerprint,
} = require('./idempotency');

describe('idempotency helpers', () => {
  it('canonicalizes body key order in the request fingerprint', () => {
    const forward = requestFingerprint({
      method: 'POST',
      path: '/api/v1/events',
      body: { eventType: 'creation', nested: { alpha: 1, beta: 2 }, outputs: [] },
    });
    const reversed = requestFingerprint({
      method: 'POST',
      path: '/api/v1/events',
      body: { outputs: [], nested: { beta: 2, alpha: 1 }, eventType: 'creation' },
    });

    expect(reversed).toBe(forward);
  });

  it('changes the fingerprint when the body changes', () => {
    const first = requestFingerprint({
      method: 'POST',
      path: '/api/v1/events',
      body: { eventType: 'creation', notes: 'first' },
    });
    const second = requestFingerprint({
      method: 'POST',
      path: '/api/v1/events',
      body: { eventType: 'creation', notes: 'second' },
    });

    expect(second).not.toBe(first);
  });

  it('changes the fingerprint when the route changes', () => {
    const create = requestFingerprint({
      method: 'POST',
      path: '/api/v1/events',
      body: { eventType: 'creation' },
    });
    const amend = requestFingerprint({
      method: 'POST',
      path: '/api/v1/events/abc/amend',
      body: { eventType: 'creation' },
    });

    expect(amend).not.toBe(create);
  });

  it('accepts a missing key', () => {
    expect(normalizeIdempotencyKey(undefined)).toEqual({ key: null, error: null });
  });

  it('accepts a bounded key', () => {
    expect(normalizeIdempotencyKey('abc-123')).toEqual({ key: 'abc-123', error: null });
  });

  it('rejects an empty key', () => {
    expect(normalizeIdempotencyKey('')).toEqual({ key: null, error: 'Must not be empty' });
  });

  it('rejects a key longer than 255 characters', () => {
    const result = normalizeIdempotencyKey('a'.repeat(256));

    expect(result.key).toBeNull();
    expect(result.error).toBe('Must be at most 255 characters');
  });
});
