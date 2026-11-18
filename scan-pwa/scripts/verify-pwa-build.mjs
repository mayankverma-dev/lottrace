#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));
const PNG_SIGNATURE = '89504e470d0a1a0a';
const REQUIRED_PRECACHE = ['index.html', 'registerSW.js', 'manifest.webmanifest'];

const readRequired = async (filePath, label) => {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`missing ${label} at ${filePath}`);
    }
    throw error;
  }
};

const parseAttributes = (tag) => {
  const attributes = {};
  const source = tag.replace(/^<\s*[\w:-]+/, '').replace(/\/?>\s*$/, '');

  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const [, name, doubleQuoted, singleQuoted, bareValue] = match;
    if (!name || name === '/') continue;
    attributes[name.toLowerCase()] = doubleQuoted ?? singleQuoted ?? bareValue ?? '';
  }

  return attributes;
};

/**
 * Reads the dimensions from a PNG IHDR chunk. The build verifier only needs
 * the header, so avoid adding an image-processing dependency to the PWA.
 *
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number }}
 */
export const readPngSize = (buffer) => {
  assert.ok(buffer.length >= 24, 'PNG is too small to contain an IHDR chunk');
  assert.equal(buffer.subarray(0, 8).toString('hex'), PNG_SIGNATURE, 'file is not a PNG');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', 'PNG is missing its IHDR chunk');

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

const resolveManifestAsset = (distDir, src) => {
  assert.equal(typeof src, 'string', 'manifest icon src must be a string');
  assert.ok(src.startsWith('/'), `manifest icon src must be root-relative: ${src}`);

  const resolved = path.resolve(distDir, `.${src}`);
  assert.ok(resolved.startsWith(`${distDir}${path.sep}`), `manifest icon escapes dist: ${src}`);
  return resolved;
};

/**
 * Verifies the production PWA output. Fails when Vite/Rolldown drops the
 * registration script or manifest, when the manifest references missing or
 * incorrectly sized icons, or when the service worker starts caching API data.
 *
 * @param {string} [distDir]
 * @returns {Promise<{ distDir: string, icons: string[], precacheCount: number }>}
 */
export async function verifyPwaBuild(distDir = DEFAULT_DIST_DIR) {
  const root = path.resolve(distDir);
  const indexHtml = (await readRequired(path.join(root, 'index.html'), 'index.html')).toString('utf8');
  const registerSw = (await readRequired(path.join(root, 'registerSW.js'), 'registerSW.js')).toString('utf8');
  const manifestSource = (
    await readRequired(path.join(root, 'manifest.webmanifest'), 'manifest.webmanifest')
  ).toString('utf8');
  const serviceWorker = (await readRequired(path.join(root, 'sw.js'), 'sw.js')).toString('utf8');

  const linkTags = [...indexHtml.matchAll(/<link\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
  const manifestLink = linkTags.find((attributes) => attributes.rel === 'manifest');
  assert.ok(manifestLink, 'index.html must link to the web app manifest');
  assert.equal(manifestLink.href, '/manifest.webmanifest', 'index.html must reference /manifest.webmanifest');

  const scriptTags = [...indexHtml.matchAll(/<script\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
  assert.ok(
    scriptTags.some((attributes) => attributes.src === '/registerSW.js'),
    'index.html must load /registerSW.js for automatic service worker registration',
  );

  assert.match(
    registerSw,
    /navigator\.serviceWorker\.register\(\s*['"]\/sw\.js['"]/,
    'registerSW.js must register /sw.js',
  );

  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    throw new Error(`manifest.webmanifest is not valid JSON: ${error.message}`);
  }

  assert.ok(typeof manifest.name === 'string' && manifest.name.trim(), 'manifest must declare a name');
  assert.ok(
    typeof manifest.short_name === 'string' && manifest.short_name.trim(),
    'manifest must declare a short_name',
  );
  assert.ok(
    typeof manifest.start_url === 'string' && manifest.start_url.startsWith('/'),
    'manifest start_url must be root-relative',
  );
  assert.equal(manifest.display, 'standalone', 'manifest display must be standalone');
  assert.ok(manifest.theme_color, 'manifest must declare a theme_color');
  assert.ok(manifest.background_color, 'manifest must declare a background_color');
  assert.ok(Array.isArray(manifest.icons), 'manifest must declare icons');

  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry && entry.sizes === `${size}x${size}`);
    assert.ok(icon, `manifest must include a ${size}x${size} icon`);
    assert.equal(icon.type, 'image/png', `${size}x${size} icon must be a PNG`);

    if (icon.purpose !== undefined) {
      const purposes = String(icon.purpose).split(/\s+/);
      assert.ok(
        purposes.includes('any') || purposes.includes('maskable'),
        `${size}x${size} icon purpose must include any or maskable`,
      );
    }

    const iconBuffer = await readRequired(resolveManifestAsset(root, icon.src), `${size}x${size} manifest icon`);
    const { width, height } = readPngSize(iconBuffer);
    assert.equal(width, size, `manifest icon ${icon.src} is ${width}px wide, expected ${size}px`);
    assert.equal(height, size, `manifest icon ${icon.src} is ${height}px high, expected ${size}px`);
    assert.ok(
      serviceWorker.includes(icon.src.replace(/^\//, '')),
      `sw.js must precache ${icon.src}`,
    );
  }

  for (const url of REQUIRED_PRECACHE) {
    assert.ok(serviceWorker.includes(url), `sw.js must precache ${url}`);
  }

  assert.equal(serviceWorker.includes('/api/'), false, 'sw.js must not reference API routes');
  assert.equal(serviceWorker.includes('api-cache'), false, 'sw.js must not create an api-cache bucket');
  assert.equal(serviceWorker.includes('NetworkFirst'), false, 'sw.js must not use NetworkFirst');
  assert.equal(serviceWorker.includes('runtimeCaching'), false, 'sw.js must not declare runtime caching');

  const distEntries = await readdir(root, { withFileTypes: true });
  assert.ok(
    distEntries.some((entry) => entry.isFile() && /^workbox-[a-f0-9]+\.js$/.test(entry.name)),
    'dist must include the Workbox runtime chunk',
  );

  return {
    distDir: root,
    icons: manifest.icons.map((icon) => icon.src),
    precacheCount: (serviceWorker.match(/\{url:/g) || []).length,
  };
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIST_DIR;

  try {
    const result = await verifyPwaBuild(target);
    console.log(
      `✓ PWA build verified: ${result.precacheCount} precache entries, icons ${result.icons.join(', ')}`,
    );
  } catch (error) {
    console.error(`\n✗ PWA build verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
