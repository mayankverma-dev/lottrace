import { useAuthStore } from '../stores/auth.store.js';
import { queryClient } from './queryClient.js';
import { purgeApiCache } from './apiCache.js';

/**
 * Clears every client-side trace of the authenticated session: in-memory auth
 * state, React Query data, and cached API responses. Safe to call on logout,
 * refresh failure, and failed boot authentication.
 *
 * @param {CacheStorage | null | undefined} [cacheStorage]
 * @returns {Promise<void>}
 */
export const clearSessionData = async (cacheStorage) => {
  useAuthStore.getState().clearAuth();
  await queryClient.cancelQueries();
  queryClient.clear();
  await purgeApiCache(cacheStorage);
};
