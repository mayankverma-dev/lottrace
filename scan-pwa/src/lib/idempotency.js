/**
 * Generates a UUID v4 for the `Idempotency-Key` request header.
 *
 * `crypto.randomUUID()` requires a secure context. Field devices may open the
 * app over plain HTTP on a LAN, where only `crypto.getRandomValues()` is
 * available, so fall back to an RFC 4122 v4 builder.
 *
 * @returns {string}
 */
export const newIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
};
