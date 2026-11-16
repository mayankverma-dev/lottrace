import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exportStatusLabel,
  isExportPolling,
  isExportTerminal,
} from './exportStatus.js';

test('exportStatusLabel labels each export lifecycle state', () => {
  assert.equal(exportStatusLabel('queued'), 'Queued');
  assert.equal(exportStatusLabel('processing'), 'Processing');
  assert.equal(exportStatusLabel('complete'), 'Ready');
  assert.equal(exportStatusLabel('failed'), 'Failed');
});

test('exportStatusLabel falls back to the raw status', () => {
  assert.equal(exportStatusLabel('unknown'), 'unknown');
});

test('isExportTerminal is true only for complete and failed', () => {
  assert.equal(isExportTerminal('complete'), true);
  assert.equal(isExportTerminal('failed'), true);
  assert.equal(isExportTerminal('queued'), false);
  assert.equal(isExportTerminal('processing'), false);
});

test('isExportPolling is true while the worker is active', () => {
  assert.equal(isExportPolling('queued'), true);
  assert.equal(isExportPolling('processing'), true);
  assert.equal(isExportPolling('complete'), false);
  assert.equal(isExportPolling('failed'), false);
});
