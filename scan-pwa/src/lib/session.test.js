import assert from 'node:assert/strict';
import test from 'node:test';

import { API_CACHE_NAME, purgeApiCache } from './apiCache.js';
import { clearSessionData } from './session.js';
import { queryClient } from './queryClient.js';
import { useAuthStore } from '../stores/auth.store.js';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const createCacheStorage = (names) => {
  const entries = new Set(names);

  return {
    keys: async () => [...entries],
    delete: async (name) => entries.delete(name),
  };
};

test('clearSessionData clears auth, query data, and cached API responses', async () => {
  useAuthStore.getState().setAuth(
    { id: 'user-a', organizationId: 'org-a' },
    'access-token-a',
  );
  queryClient.setQueryData(['lots', 'list', {}], {
    data: [{ traceabilityLotCode: 'ORG-A-LOT' }],
  });

  const cacheStorage = createCacheStorage([
    API_CACHE_NAME,
    'workbox-precache-v2-http://localhost:3002/',
  ]);

  await clearSessionData(cacheStorage);

  assert.equal(useAuthStore.getState().user, null);
  assert.equal(useAuthStore.getState().accessToken, null);
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
  assert.deepEqual(await cacheStorage.keys(), ['workbox-precache-v2-http://localhost:3002/']);
});

test('purgeApiCache succeeds when Cache Storage is unavailable', async () => {
  assert.equal(await purgeApiCache(null), false);
  assert.equal(await purgeApiCache({}), false);
});

test('purgeApiCache swallows cache deletion failures', async () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const cacheStorage = {
      delete: async () => {
        throw new Error('cache unavailable');
      },
    };

    assert.equal(await purgeApiCache(cacheStorage), false);
  } finally {
    console.error = originalError;
  }
});
