export const API_CACHE_NAME = 'api-cache';

/**
 * Deletes the Cache Storage bucket that older PWA builds used for lot
 * responses. Only the API cache is removed; the Workbox precache for the app
 * shell is kept so the PWA can still load offline.
 *
 * @param {CacheStorage | null | undefined} cacheStorage
 * @returns {Promise<boolean>} true when a cache was deleted
 */
export const purgeApiCache = async (cacheStorage = globalThis.caches) => {
  if (!cacheStorage || typeof cacheStorage.delete !== 'function') return false;

  try {
    return await cacheStorage.delete(API_CACHE_NAME);
  } catch (err) {
    console.error('Failed to purge API cache', err);
    return false;
  }
};
