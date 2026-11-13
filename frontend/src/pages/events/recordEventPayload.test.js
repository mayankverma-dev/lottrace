import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEventPayload, hasAmendReason } from './recordEventPayload.js';

const formData = (overrides = {}) => ({
  eventType: 'receiving',
  locationId: '00000000-0000-4000-8000-000000000001',
  notes: 'Received shipment',
  eventDatetime: '2026-11-13T10:00',
  amendReason: 'Corrected quantity',
  counterpartyName: 'Supplier',
  counterpartyLotCode: 'SUP-001',
  ...overrides,
});

const links = [{ lotId: '00000000-0000-4000-8000-000000000002', quantity: 1, uom: 'kg' }];

test('amendment payload includes amendReason', () => {
  const payload = buildEventPayload({
    formData: formData(),
    inputs: links,
    outputs: links,
    kdePayload: {},
    isAmending: true,
  });

  assert.equal(payload.amendReason, 'Corrected quantity');
});

test('event payload sends UTC ISO datetime', () => {
  const payload = buildEventPayload({
    formData: formData({ eventDatetime: '2026-11-13T10:00' }),
    inputs: links,
    outputs: links,
    kdePayload: {},
    isAmending: false,
  });

  assert.match(payload.eventDatetime, /Z$/);
});

test('create payload excludes amendment and void reasons', () => {
  const payload = buildEventPayload({
    formData: formData({ amendReason: 'Should not be sent' }),
    inputs: links,
    outputs: links,
    kdePayload: {},
    isAmending: false,
  });

  assert.equal(Object.hasOwn(payload, 'amendReason'), false);
  assert.equal(Object.hasOwn(payload, 'voidReason'), false);
});

test('amendment payload excludes voidReason', () => {
  const payload = buildEventPayload({
    formData: formData({ voidReason: 'Should not be sent' }),
    inputs: links,
    outputs: links,
    kdePayload: {},
    isAmending: true,
  });

  assert.equal(Object.hasOwn(payload, 'voidReason'), false);
});

test('empty amendment reason is invalid', () => {
  assert.equal(hasAmendReason(''), false);
  assert.equal(hasAmendReason('   '), false);
  assert.equal(hasAmendReason('Corrected quantity'), true);
});
