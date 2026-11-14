import assert from 'node:assert/strict';
import test from 'node:test';

import { toPageParam } from './pagination.js';

test('toPageParam reads the page number DataTable emits', () => {
  assert.equal(toPageParam({ page: 2, totalPages: 2 }), 2);
});

test('toPageParam ignores TanStack pageIndex and pageSize fields', () => {
  assert.equal(toPageParam({ pageIndex: 1, pageSize: 20 }), 1);
});

test('toPageParam returns a number when given the full pagination object', () => {
  const page = toPageParam({ page: 2, total: 21, limit: 20, totalPages: 2 });

  assert.equal(page, 2);
  assert.equal(typeof page, 'number');
});

test('toPageParam falls back to page 1 for missing or invalid values', () => {
  assert.equal(toPageParam(undefined), 1);
  assert.equal(toPageParam({ page: 0 }), 1);
  assert.equal(toPageParam({ page: null }), 1);
  assert.equal(toPageParam({ page: '[object Object]' }), 1);
});
