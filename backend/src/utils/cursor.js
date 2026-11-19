const AppError = require('./AppError');

const TIMESTAMP_PATTERN = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CHAIN_SEQ_PATTERN = /^\d{1,19}$/;
const MAX_CHAIN_SEQ = 9223372036854775807n;

const invalidCursor = () => new AppError(
  'Invalid cursor',
  'VALIDATION_ERROR',
  422,
  [{ field: 'cursor', message: 'Invalid cursor' }],
);

const isValidTimestamp = (value) => {
  if (!TIMESTAMP_PATTERN.test(value)) return false;

  // Validate the calendar date without losing the microsecond text. Date only
  // accepts milliseconds, so compare the millisecond prefix after parsing.
  const millisecondValue = `${value.slice(0, 23)}Z`;
  const parsed = new Date(millisecondValue);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === millisecondValue;
};

/**
 * Encodes an opaque keyset cursor. `t` is the exact microsecond timestamp and
 * `s` is the bigint chain position as a string.
 *
 * @param {{ t: string, s: string }} payload
 * @returns {string}
 */
const encodeCursor = ({ t, s }) => Buffer
  .from(JSON.stringify({ t, s }), 'utf8')
  .toString('base64url');

/**
 * Decodes and validates an opaque keyset cursor.
 *
 * @param {string} value
 * @returns {{ t: string, s: string }}
 */
const decodeCursor = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalidCursor();
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidCursor();
  }

  const { t, s } = payload;
  if (!isValidTimestamp(t) || !CHAIN_SEQ_PATTERN.test(s)) {
    throw invalidCursor();
  }

  const chainSeq = BigInt(s);
  if (chainSeq < 1n || chainSeq > MAX_CHAIN_SEQ) {
    throw invalidCursor();
  }

  return { t, s };
};

module.exports = { encodeCursor, decodeCursor };
