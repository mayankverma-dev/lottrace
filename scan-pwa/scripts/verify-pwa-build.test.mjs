import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPngSize, verifyPwaBuild } from './verify-pwa-build.mjs';

const png = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return buffer;
};

const manifest = {
  name: 'LotTrace Scanner',
  short_name: 'LotTrace',
  start_url: '/scan',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#3b82f6',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};

const serviceWorker = [
  'self.precacheAndRoute([',
  '{url:"index.html"},',
  '{url:"registerSW.js"},',
  '{url:"manifest.webmanifest"},',
  '{url:"icon-192.png"},',
  '{url:"icon-512.png"}',
  ']);',
].join('');

const createFixture = async (t) => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'lottrace-pwa-build-'));
  t.after(() => rm(distDir, { recursive: true, force: true }));

  await writeFile(
    path.join(distDir, 'index.html'),
    [
      '<!doctype html>',
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>',
    ].join('\n'),
  );
  await writeFile(path.join(distDir, 'registerSW.js'), "navigator.serviceWorker.register('/sw.js', { scope: '/' })");
  await writeFile(path.join(distDir, 'manifest.webmanifest'), JSON.stringify(manifest));
  await writeFile(path.join(distDir, 'sw.js'), serviceWorker);
  await writeFile(path.join(distDir, 'workbox-abc123.js'), '');
  await writeFile(path.join(distDir, 'icon-192.png'), png(192, 192));
  await writeFile(path.join(distDir, 'icon-512.png'), png(512, 512));

  return distDir;
};

test('accepts a complete PWA build', async (t) => {
  const distDir = await createFixture(t);
  const result = await verifyPwaBuild(distDir);

  assert.equal(result.precacheCount, 5);
  assert.deepEqual(result.icons, ['/icon-192.png', '/icon-512.png']);
});

test('rejects a build without the registration script', async (t) => {
  const distDir = await createFixture(t);
  await rm(path.join(distDir, 'registerSW.js'));

  await assert.rejects(verifyPwaBuild(distDir), /missing registerSW\.js/);
});

test('rejects an icon whose actual dimensions do not match the manifest', async (t) => {
  const distDir = await createFixture(t);
  await writeFile(path.join(distDir, 'icon-192.png'), png(128, 128));

  await assert.rejects(verifyPwaBuild(distDir), /icon-192\.png is 128px wide, expected 192px/);
});

test('rejects a manifest that omits the 512px icon', async (t) => {
  const distDir = await createFixture(t);
  await writeFile(
    path.join(distDir, 'manifest.webmanifest'),
    JSON.stringify({ ...manifest, icons: manifest.icons.slice(0, 1) }),
  );

  await assert.rejects(verifyPwaBuild(distDir), /manifest must include a 512x512 icon/);
});

test('rejects a service worker that adds API runtime caching', async (t) => {
  const distDir = await createFixture(t);
  await writeFile(
    path.join(distDir, 'sw.js'),
    `${serviceWorker}\nregisterRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkFirst({ cacheName: 'api-cache' }));`,
  );

  await assert.rejects(verifyPwaBuild(distDir), /must not reference API routes/);
});

test('reads PNG dimensions from the IHDR chunk', () => {
  assert.deepEqual(readPngSize(png(192, 512)), { width: 192, height: 512 });
});
