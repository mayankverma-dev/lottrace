#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));
const DEFAULT_ENTRY_BUDGET = 250 * 1024;
const DEFAULT_ASSET_BUDGET = 500 * 1024;
const DEFAULT_REQUIRED_CHUNKS = [
  'react-vendor-',
  'query-vendor-',
  'ui-vendor-',
  'charts-vendor-',
];

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

const parseScriptSrc = (indexHtml) => {
  for (const match of indexHtml.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc=["']([^"']+\.js)["']/i)?.[1];
    if (src) return src;
  }
  return null;
};

const resolveDistAsset = (distDir, src) => {
  assert.ok(src.startsWith('/'), `entry script must be root-relative: ${src}`);
  const resolved = path.resolve(distDir, `.${src}`);
  assert.ok(resolved.startsWith(`${distDir}${path.sep}`), `entry script escapes dist: ${src}`);
  return resolved;
};

const listJsAssets = async (assetsDir) => {
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name);

  return Promise.all(files.map(async (name) => {
    const filePath = path.join(assetsDir, name);
    return {
      name,
      bytes: (await stat(filePath)).size,
      source: (await readFile(filePath)).toString('utf8'),
    };
  }));
};

/**
 * Verifies the production frontend output. Fails when the entry chunk grows
 * past its budget, a stable vendor group disappears, or any JS asset exceeds
 * the hard per-asset cap.
 *
 * @param {string} [distDir]
 * @param {{ entryBudget?: number, assetBudget?: number, requiredChunks?: string[] }} [budgets]
 * @returns {Promise<{ entry: { name: string, bytes: number }, chunks: Array<{ name: string, bytes: number }> }>}
 */
export async function verifyFrontendBuild(distDir = DEFAULT_DIST_DIR, budgets = {}) {
  const {
    entryBudget = DEFAULT_ENTRY_BUDGET,
    assetBudget = DEFAULT_ASSET_BUDGET,
    requiredChunks = DEFAULT_REQUIRED_CHUNKS,
  } = budgets;

  const root = path.resolve(distDir);
  const indexHtml = (await readRequired(path.join(root, 'index.html'), 'index.html')).toString('utf8');
  const entrySrc = parseScriptSrc(indexHtml);
  assert.ok(entrySrc, 'index.html must load a module entry script');

  const entryPath = resolveDistAsset(root, entrySrc);
  const entryBytes = (await stat(entryPath)).size;
  assert.ok(
    entryBytes <= entryBudget,
    `entry chunk ${path.basename(entryPath)} is ${entryBytes} bytes, budget is ${entryBudget}`,
  );

  const chunks = await listJsAssets(path.join(root, 'assets'));
  assert.ok(chunks.length > 0, 'dist/assets must contain at least one JS chunk');

  for (const prefix of requiredChunks) {
    assert.ok(
      chunks.some((chunk) => chunk.name.startsWith(prefix)),
      `missing stable vendor chunk ${prefix}*.js`,
    );
  }

  for (const chunk of chunks) {
    if (chunk.name.includes('-vendor-')) {
      assert.doesNotMatch(
        chunk.source,
        /from\s+["']\.\/[^"']*Page-[^"']*\.js["']/,
        `vendor chunk ${chunk.name} must not import a page chunk`,
      );
    }
    assert.ok(
      chunk.bytes <= assetBudget,
      `chunk ${chunk.name} is ${chunk.bytes} bytes, hard cap is ${assetBudget}`,
    );
  }

  return {
    entry: { name: path.basename(entryPath), bytes: entryBytes },
    chunks: chunks.map(({ source, ...chunk }) => chunk),
  };
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIST_DIR;

  try {
    const result = await verifyFrontendBuild(target);
    const largest = result.chunks.reduce((max, chunk) => Math.max(max, chunk.bytes), 0);
    console.log(
      `✓ frontend build verified: entry ${result.entry.name} ${result.entry.bytes} bytes, `
      + `${result.chunks.length} JS chunks, largest ${largest} bytes`,
    );
  } catch (error) {
    console.error(`\n✗ frontend build verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
