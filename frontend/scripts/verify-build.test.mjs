import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyFrontendBuild } from './verify-build.mjs';

const VENDOR_CHUNKS = [
  'react-vendor-abc123.js',
  'query-vendor-def456.js',
  'ui-vendor-ghi789.js',
  'charts-vendor-jkl012.js',
];

const createFixture = async (t, { entryBytes = 1024, extraChunks = [] } = {}) => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'lottrace-frontend-build-'));
  t.after(() => rm(distDir, { recursive: true, force: true }));

  const assetsDir = path.join(distDir, 'assets');
  await mkdir(assetsDir);
  await writeFile(
    path.join(distDir, 'index.html'),
    '<script type="module" crossorigin src="/assets/index-entry.js"></script>',
  );
  await writeFile(path.join(assetsDir, 'index-entry.js'), Buffer.alloc(entryBytes));
  await writeFile(path.join(assetsDir, 'index-style.css'), '');

  for (const name of VENDOR_CHUNKS) {
    await writeFile(path.join(assetsDir, name), Buffer.alloc(512));
  }
  for (const chunk of extraChunks) {
    await writeFile(path.join(assetsDir, chunk.name), Buffer.alloc(chunk.bytes));
  }

  return distDir;
};

test('accepts a build with stable vendor chunks inside the size budgets', async (t) => {
  const distDir = await createFixture(t);

  const result = await verifyFrontendBuild(distDir, {
    entryBudget: 2048,
    assetBudget: 2048,
  });

  assert.equal(result.entry.name, 'index-entry.js');
  assert.equal(result.entry.bytes, 1024);
  assert.equal(result.chunks.length, VENDOR_CHUNKS.length + 1);
});

test('rejects a build without the ui vendor chunk', async (t) => {
  const distDir = await createFixture(t);
  await rm(path.join(distDir, 'assets', 'ui-vendor-ghi789.js'));

  await assert.rejects(
    verifyFrontendBuild(distDir, { entryBudget: 2048, assetBudget: 2048 }),
    /missing stable vendor chunk ui-vendor-\*\.js/,
  );
});

test('rejects an entry chunk over its budget', async (t) => {
  const distDir = await createFixture(t, { entryBytes: 4096 });

  await assert.rejects(
    verifyFrontendBuild(distDir, { entryBudget: 1024, assetBudget: 8192 }),
    /entry chunk index-entry\.js is 4096 bytes, budget is 1024/,
  );
});

test('rejects any JS asset over the hard cap', async (t) => {
  const distDir = await createFixture(t, {
    extraChunks: [{ name: 'oversized-page.js', bytes: 4096 }],
  });

  await assert.rejects(
    verifyFrontendBuild(distDir, { entryBudget: 8192, assetBudget: 1024 }),
    /chunk oversized-page\.js is 4096 bytes, hard cap is 1024/,
  );
});

test('rejects a vendor chunk that imports a page chunk', async (t) => {
  const distDir = await createFixture(t);
  await writeFile(
    path.join(distDir, 'assets', 'charts-vendor-jkl012.js'),
    'import { x } from "./DashboardPage-abc123.js"; export { x };',
  );

  await assert.rejects(
    verifyFrontendBuild(distDir, { entryBudget: 2048, assetBudget: 2048 }),
    /vendor chunk charts-vendor-jkl012\.js must not import a page chunk/,
  );
});

test('rejects a build without index.html', async (t) => {
  const distDir = await createFixture(t);
  await rm(path.join(distDir, 'index.html'));

  await assert.rejects(
    verifyFrontendBuild(distDir, { entryBudget: 2048, assetBudget: 2048 }),
    /missing index\.html/,
  );
});

test('rejects a build without a module entry script', async (t) => {
  const distDir = await createFixture(t);
  await writeFile(path.join(distDir, 'index.html'), '<div id="root"></div>');

  await assert.rejects(
    verifyFrontendBuild(distDir, { entryBudget: 2048, assetBudget: 2048 }),
    /must load a module entry script/,
  );
});
