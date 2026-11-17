const net = require('net');

const PRESET_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Validates one IP or CIDR entry.
 *
 * @param {string} value
 * @returns {boolean}
 */
const isIpOrCidr = (value) => {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0) return false;

  const family = net.isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;

  const maxPrefix = family === 4 ? 32 : 128;
  const prefixLength = Number(prefix);

  return prefixLength >= 0 && prefixLength <= maxPrefix;
};

/**
 * Parses the TRUST_PROXY environment value into a value accepted by
 * Express's `trust proxy` setting.
 *
 * Accepts an exact hop count, a named proxy range, or a comma-separated
 * list of IPs/CIDRs. Rejects `true` because trusting every proxy hop lets
 * clients spoof X-Forwarded-For and bypass rate limits.
 *
 * @param {string|undefined} raw
 * @returns {false|number|string[]}
 */
const parseTrustProxy = (raw) => {
  if (raw === undefined) return false;

  const value = String(raw).trim();
  if (value === '') return false;

  const lower = value.toLowerCase();
  if (lower === 'false' || value === '0') return false;

  if (lower === 'true') {
    throw new Error(
      'TRUST_PROXY=true is not allowed; set the exact proxy hop count or a trusted CIDR list'
    );
  }

  if (/^[1-9]\d*$/.test(value)) {
    return Number(value);
  }

  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.some((token) => token === '')) {
    throw new Error('TRUST_PROXY contains an empty entry');
  }

  return tokens.map((token) => {
    const normalized = token.toLowerCase();
    if (PRESET_RANGES.has(normalized)) return normalized;
    if (!isIpOrCidr(token)) {
      throw new Error(`Invalid TRUST_PROXY entry: ${token}`);
    }
    return token;
  });
};

module.exports = { parseTrustProxy };
