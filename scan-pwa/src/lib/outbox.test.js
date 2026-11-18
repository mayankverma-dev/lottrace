import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOutboxRecord,
  enqueueEvent,
  isPermanentFailure,
  outboxOwnerKey,
} from './outbox.js';

test('outbox owner key is scoped to both organization and user', () => {
  assert.equal(outboxOwnerKey('org-a', 'user-1'), 'org-a:user-1');
  assert.notEqual(outboxOwnerKey('org-a', 'user-1'), outboxOwnerKey('org-b', 'user-1'));
  assert.notEqual(outboxOwnerKey('org-a', 'user-1'), outboxOwnerKey('org-a', 'user-2'));
  assert.throws(() => outboxOwnerKey('', 'user-1'), /organizationId and userId/);
  assert.throws(() => outboxOwnerKey('org-a', ''), /organizationId and userId/);
});

test('outbox records carry one idempotency key and start unattempted', () => {
  const payload = {
    eventType: 'receiving',
    locationId: 'location-1',
    inputs: [{ lotId: 'lot-1', quantity: 2, uom: 'kg' }],
  };
  const record = createOutboxRecord({
    organizationId: 'org-a',
    userId: 'user-1',
    payload,
    idempotencyKey: 'idem-1',
    id: 'record-1',
    createdAt: 123,
  });

  assert.deepEqual(record, {
    id: 'record-1',
    ownerKey: 'org-a:user-1',
    organizationId: 'org-a',
    userId: 'user-1',
    payload,
    idempotencyKey: 'idem-1',
    createdAt: 123,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    failedAt: null,
  });
});

test('outbox record rejects invalid payloads and missing keys', () => {
  const base = {
    organizationId: 'org-a',
    userId: 'user-1',
    payload: { eventType: 'receiving' },
    idempotencyKey: 'idem-1',
  };

  assert.throws(() => createOutboxRecord({ ...base, payload: null }), /payload/);
  assert.throws(() => createOutboxRecord({ ...base, payload: [] }), /payload/);
  assert.throws(() => createOutboxRecord({ ...base, idempotencyKey: '' }), /idempotency key/);
});

test('permanent failures park the record; transient failures retry', () => {
  for (const status of [400, 403, 404, 409, 413, 422]) {
    assert.equal(isPermanentFailure(status), true, `expected ${status} to be permanent`);
  }

  for (const status of [401, 408, 429, 500, 502, 503]) {
    assert.equal(isPermanentFailure(status), false, `expected ${status} to be retryable`);
  }

  assert.equal(isPermanentFailure(undefined), false);
  assert.equal(isPermanentFailure(200), false);
  assert.equal(isPermanentFailure('422'), false);
});

test('enqueue reports a clear error when IndexedDB is unavailable', async (t) => {
  if (typeof indexedDB !== 'undefined') {
    t.skip('this runtime provides IndexedDB');
    return;
  }

  await assert.rejects(
    enqueueEvent({
      organizationId: 'org-a',
      userId: 'user-1',
      payload: { eventType: 'receiving' },
      idempotencyKey: 'idem-1',
    }),
    /IndexedDB is unavailable/,
  );
});
