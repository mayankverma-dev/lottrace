const { parseTrustProxy } = require('./trustProxy');

describe('parseTrustProxy', () => {
  it.each([undefined, '', '   ', 'false', 'FALSE', '0'])(
    'disables trust for %p',
    (raw) => {
      expect(parseTrustProxy(raw)).toBe(false);
    }
  );

  it.each([
    ['1', 1],
    ['2', 2],
    [' 3 ', 3],
  ])('parses hop count %p as %p', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });

  it.each(['true', 'TRUE', 'True', ' true '])(
    'rejects permissive trust %p',
    (raw) => {
      expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY=true is not allowed/);
    }
  );

  it.each([
    '-1',
    '1.5',
    '01',
    '+1',
    'banana',
    '10.0.0.0/33',
    '2001:db8::/129',
    '10.0.0.0/',
    '1,,2',
  ])('rejects invalid value %p', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
  });

  it('normalizes named presets', () => {
    expect(parseTrustProxy('LOOPBACK')).toEqual(['loopback']);
    expect(parseTrustProxy('linklocal, uniquelocal')).toEqual(['linklocal', 'uniquelocal']);
  });

  it('returns a CIDR list as an array', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8, 192.168.1.0/24')).toEqual([
      'loopback',
      '10.0.0.0/8',
      '192.168.1.0/24',
    ]);
  });

  it('accepts bare IPs and IPv6 ranges', () => {
    expect(parseTrustProxy('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(parseTrustProxy('::1')).toEqual(['::1']);
    expect(parseTrustProxy('2001:db8::/32')).toEqual(['2001:db8::/32']);
  });
});
