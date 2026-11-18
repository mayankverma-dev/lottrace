import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const configPath = new URL('./vite.config.js', import.meta.url);

test('service worker never runtime-caches authenticated API responses', async () => {
  const source = await readFile(configPath, 'utf8');

  assert.equal(source.includes('runtimeCaching'), false);
  assert.equal(source.includes('NetworkFirst'), false);
  assert.equal(source.includes('api-cache'), false);
  assert.equal(source.includes('/api/v1/lots'), false);
});

test('PWA plugin remains registered for app-shell precache', async () => {
  const source = await readFile(configPath, 'utf8');

  assert.equal(source.includes('VitePWA('), true);
});
