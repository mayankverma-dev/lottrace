const crypto = require('crypto');

/** Header name documented in `docs/API_STANDARDS.md`. */
const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Hard bound documented in `docs/API_STANDARDS.md`. */
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** How long a completed response is replayable. */
const IDEMPOTENCY_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long an unfinished claim blocks a duplicate request. A crashed writer
 * leaves a claim that expires after this window, so the key becomes usable
 * again without waiting for the 24-hour result TTL.
 */
const IDEMPOTENCY_CLAIM_TTL_MS = 5 * 60 * 1000;

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const sortedKeys = Object.keys(value).sort();
  return `{${sortedKeys.map((key) => `"${key}":${stableStringify(value[key])}`).join(',')}}`;
};

/**
 * Validates the `Idempotency-Key` request header.
 *
 * @param {string|string[]|undefined} value
 * @returns {{ key: string|null, error: string|null }}
 */
const normalizeIdempotencyKey = (value) => {
  if (value === undefined || value === null) return { key: null, error: null };

  const key = Array.isArray(value) ? value[0] : String(value);
  if (key.length === 0) {
    return { key: null, error: 'Must not be empty' };
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { key: null, error: `Must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters` };
  }

  return { key, error: null };
};

/**
 * Fingerprints one logical request: method, route, and the validated body.
 * The body is canonicalized so JSON key order cannot cause a false mismatch.
 *
 * @param {{ method: string, path: string, body: * }} request
 * @returns {string} SHA-256 hex digest
 */
const requestFingerprint = ({ method, path, body }) => crypto
  .createHash('sha256')
  .update(`${method}\n${path}\n${stableStringify(body ?? null)}`)
  .digest('hex');

/**
 * Deletes expired idempotency rows. Safe to call from a worker or a test.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} [qb]
 * @returns {Promise<number>} deleted row count
 */
const purgeExpiredIdempotencyKeys = async (qb) => {
  const knex = qb || require('../db/knex');
  return knex('idempotency_keys')
    .where('expires_at', '<=', knex.fn.now())
    .del();
};

module.exports = {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_RESULT_TTL_MS,
  IDEMPOTENCY_CLAIM_TTL_MS,
  stableStringify,
  normalizeIdempotencyKey,
  requestFingerprint,
  purgeExpiredIdempotencyKeys,
};
