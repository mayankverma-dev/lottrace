const net = require('net');

const LOOPBACK_HOST = '127.0.0.1';
const CONTAINER_HOST = '0.0.0.0';
const PROTECTED_ENVIRONMENTS = new Set(['staging', 'production']);

/**
 * Accepts only a literal IP or `localhost`. A DNS name is not valid for a
 * listen address here: it would hide which interface the API actually binds.
 *
 * @param {string} value
 * @returns {boolean}
 */
const isListenAddress = (value) => value === 'localhost' || net.isIP(value) !== 0;

/**
 * Resolves the address the HTTP server listens on.
 *
 * Development and test bind to loopback so the API is not reachable from the
 * local network. Staging and production default to `0.0.0.0` because a
 * container bound to loopback cannot be reached through its published port.
 * An explicit `API_HOST` always wins, after validation.
 *
 * @param {{ NODE_ENV?: string, API_HOST?: string }} env
 * @returns {string}
 */
const resolveApiHost = (env = {}) => {
  if (env.API_HOST !== undefined && String(env.API_HOST).trim() !== '') {
    const host = String(env.API_HOST).trim();
    if (!isListenAddress(host)) {
      throw new Error(`Invalid API_HOST: ${host}`);
    }
    return host;
  }

  return PROTECTED_ENVIRONMENTS.has(env.NODE_ENV) ? CONTAINER_HOST : LOOPBACK_HOST;
};

module.exports = { resolveApiHost, LOOPBACK_HOST, CONTAINER_HOST };
