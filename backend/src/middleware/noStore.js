/**
 * Marks API responses as non-storable. Authenticated payloads must never be
 * kept by browser HTTP caches, service workers, or intermediary caches.
 *
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

module.exports = noStore;
