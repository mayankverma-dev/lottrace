import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEventPayload,
  buildLotPayload,
  resolveScannedLotCode,
  toPositiveQuantity,
} from './recordEventPayload.js';

const LOT_A = '00000000-0000-4000-8000-00000000000a';
const LOT_B = '00000000-0000-4000-8000-00000000000b';
const PRODUCT = '00000000-0000-4000-8000-000000000001';
const LOCATION = '00000000-0000-4000-8000-000000000002';

const eventInput = (overrides = {}) => ({
  eventType: 'receiving',
  locationId: LOCATION,
  eventDatetime: '2026-11-18T10:00:00.000Z',
  source: 'scan',
  items: [{ lotId: LOT_A, quantity: '12.5', uom: 'kg' }],
  ...overrides,
});

test('receiving payload uses numeric input quantities and no outputs', () => {
  const payload = buildEventPayload(eventInput());

  assert.equal(payload.source, 'scan');
  assert.deepEqual(payload.outputs, []);
  assert.equal(payload.inputs.length, 1);
  assert.equal(payload.inputs[0].quantity, 12.5);
  assert.equal(payload.inputs[0].lotId, LOT_A);
  assert.equal(payload.inputs[0].uom, 'kg');
});

test('shipping payload keeps manual source and input-only links', () => {
  const payload = buildEventPayload(eventInput({
    eventType: 'shipping',
    source: 'manual',
    notes: '  dock 3  ',
  }));

  assert.equal(payload.source, 'manual');
  assert.deepEqual(payload.outputs, []);
  assert.equal(payload.notes, 'dock 3');
});

test('bulk payload preserves every item and its quantity', () => {
  const payload = buildEventPayload(eventInput({
    items: [
      { lotId: LOT_A, quantity: 2, uom: 'kg' },
      { lotId: LOT_B, quantity: '3.5', uom: 'kg' },
      { lotId: LOT_A, quantity: 1, uom: 'lb' },
    ],
  }));

  assert.deepEqual(payload.inputs.map((item) => item.quantity), [2, 3.5, 1]);
  assert.deepEqual(payload.inputs.map((item) => item.uom), ['kg', 'kg', 'lb']);
});

test('empty, zero, negative, and non-numeric quantities are rejected', () => {
  for (const quantity of ['', '  ', 0, -1, 'abc', null, undefined]) {
    assert.equal(toPositiveQuantity(quantity), null, `expected ${String(quantity)} to be invalid`);
    assert.throws(
      () => buildEventPayload(eventInput({
        items: [{ lotId: LOT_A, quantity, uom: 'kg' }],
      })),
      /Quantity must be a positive number/,
    );
  }
});

test('event payload rejects an empty item list and unsupported event types', () => {
  assert.throws(() => buildEventPayload(eventInput({ items: [] })), /At least one lot/);
  assert.throws(
    () => buildEventPayload(eventInput({ eventType: 'transformation' })),
    /receiving or shipping/,
  );
});

test('GS1-AI 10 resolves to the lot code and plain codes use the raw value', () => {
  assert.equal(resolveScannedLotCode(']C1011234567890123410LOT-123\x1D30KG'), 'LOT-123');
  assert.equal(resolveScannedLotCode('  LOT-456  '), 'LOT-456');
  assert.equal(resolveScannedLotCode(''), '');
  assert.equal(resolveScannedLotCode(null), '');
});

test('lot payload trims the code and casts quantity', () => {
  const payload = buildLotPayload({
    productId: PRODUCT,
    traceabilityLotCode: '  LOT-789 ',
    quantity: '12.5',
    uom: ' kg ',
    notes: '  received cold  ',
  });

  assert.deepEqual(payload, {
    productId: PRODUCT,
    traceabilityLotCode: 'LOT-789',
    quantity: 12.5,
    uom: 'kg',
    notes: 'received cold',
  });
});

test('lot payload rejects missing product, code, quantity, and UOM', () => {
  const valid = {
    productId: PRODUCT,
    traceabilityLotCode: 'LOT-1',
    quantity: 1,
    uom: 'kg',
  };

  assert.throws(() => buildLotPayload({ ...valid, productId: '' }), /Select a product/);
  assert.throws(() => buildLotPayload({ ...valid, traceabilityLotCode: '  ' }), /Lot code is required/);
  assert.throws(() => buildLotPayload({ ...valid, quantity: 0 }), /positive number/);
  assert.throws(() => buildLotPayload({ ...valid, uom: '' }), /Unit of measure is required/);
});
