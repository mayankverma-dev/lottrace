/**
 * JSONB columns arrive already parsed from the API. Parse only strings and
 * pass everything else through, so a jsonb array is never handed to JSON.parse.
 *
 * @param {unknown} value
 * @param {unknown} [fallback=null]
 * @returns {unknown}
 */
export const parseMaybeJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/**
 * @param {unknown} value
 * @returns {Array}
 */
export const parseJsonArray = (value) => {
  const parsed = parseMaybeJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * @param {unknown} value
 * @returns {Object}
 */
export const parseJsonObject = (value) => {
  const parsed = parseMaybeJson(value, {});
  const isPlainObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  return isPlainObject ? parsed : {};
};
