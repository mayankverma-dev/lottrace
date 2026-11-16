import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAuditExportPayload } from './auditExport.js';

test('buildAuditExportPayload requests an audit export with the action filter', () => {
  assert.deepEqual(buildAuditExportPayload('lot.void'), {
    type: 'audit',
    format: 'csv',
    filters: { action: 'lot.void' },
  });
});

test('buildAuditExportPayload omits the action filter for all actions', () => {
  assert.deepEqual(buildAuditExportPayload('all'), {
    type: 'audit',
    format: 'csv',
    filters: {},
  });
});

test('buildAuditExportPayload omits an empty action filter', () => {
  assert.deepEqual(buildAuditExportPayload(''), {
    type: 'audit',
    format: 'csv',
    filters: {},
  });
});
