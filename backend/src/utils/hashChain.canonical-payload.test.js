/**
 * P0-01 unit tests — canonical hash payload.
 *
 * This suite needs no database. It pins the payload shape that the write,
 * import, and verification paths all share.
 */

const {
  HASH_VERSION,
  GENESIS_HASH,
  PENDING_RECORD_HASH,
  computeEventHash,
  buildEventHashPayload,
} = require('./hashChain');

const LOT_A = '11111111-1111-4111-8111-111111111111';
const LOT_B = '22222222-2222-4222-8222-222222222222';
const LOT_C = '33333333-3333-4333-8333-333333333333';
const LOT_D = '44444444-4444-4444-8444-444444444444';

const makeRow = (overrides = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  event_type: 'transformation',
  location_id: null,
  counterparty_info: null,
  event_datetime: new Date('2026-01-01T10:00:00.000Z'),
  source: 'manual',
  kde_payload: {},
  notes: 'not part of the hash',
  chain_seq: '1',
  hash_version: 2,
  status: 'active',
  ...overrides,
});

const makeLink = (lotId, direction, quantity, uom = 'kg') => ({
  lot_id: lotId,
  direction,
  quantity,
  uom,
});

describe('hashChain canonical payload (P0-01)', () => {
  it('exposes the current version, genesis marker, and pending sentinel', () => {
    expect(HASH_VERSION).toBe(2);
    expect(GENESIS_HASH).toBe('GENESIS');
    expect(PENDING_RECORD_HASH).toBe('PENDING');
  });

  it('normalizes persisted values into an explicit canonical shape', () => {
    const payload = buildEventHashPayload(makeRow(), []);

    expect(payload).toEqual({
      eventType: 'transformation',
      locationId: null,
      eventDatetime: '2026-01-01T10:00:00.000Z',
      source: 'manual',
      kdePayload: {},
      counterpartyInfo: null,
      inputs: [],
      outputs: [],
    });
  });

  it('keeps PostgreSQL numeric(15,4) quantities as the persisted string', () => {
    const payload = buildEventHashPayload(makeRow(), [
      makeLink(LOT_A, 'input', '1.0000'),
      makeLink(LOT_C, 'output', '12.5000'),
    ]);

    expect(payload.inputs).toEqual([{ lotId: LOT_A, quantity: '1.0000', uom: 'kg' }]);
    expect(payload.outputs).toEqual([{ lotId: LOT_C, quantity: '12.5000', uom: 'kg' }]);
    expect(typeof payload.inputs[0].quantity).toBe('string');
  });

  it('sorts links by lot id and splits them by direction', () => {
    const forward = buildEventHashPayload(makeRow(), [
      makeLink(LOT_A, 'input', '1.0000'),
      makeLink(LOT_B, 'input', '2.0000'),
      makeLink(LOT_C, 'output', '3.0000'),
      makeLink(LOT_D, 'output', '4.0000'),
    ]);
    const reversed = buildEventHashPayload(makeRow(), [
      makeLink(LOT_D, 'output', '4.0000'),
      makeLink(LOT_B, 'input', '2.0000'),
      makeLink(LOT_C, 'output', '3.0000'),
      makeLink(LOT_A, 'input', '1.0000'),
    ]);

    expect(reversed).toEqual(forward);
    expect(forward.inputs.map((link) => link.lotId)).toEqual([LOT_A, LOT_B]);
    expect(forward.outputs.map((link) => link.lotId)).toEqual([LOT_C, LOT_D]);
  });

  it('hashes independently of object key insertion order', () => {
    const payload = buildEventHashPayload(makeRow({ kde_payload: { alpha: 1, beta: { y: 2, x: 1 } } }), [
      makeLink(LOT_A, 'input', '1.0000'),
    ]);
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const reorderedNested = buildEventHashPayload(
      makeRow({ kde_payload: { beta: { x: 1, y: 2 }, alpha: 1 } }),
      [makeLink(LOT_A, 'input', '1.0000')],
    );

    expect(computeEventHash(reordered, GENESIS_HASH)).toBe(computeEventHash(payload, GENESIS_HASH));
    expect(computeEventHash(reorderedNested, GENESIS_HASH)).toBe(computeEventHash(payload, GENESIS_HASH));
  });

  it('covers link quantity and event datetime', () => {
    const base = buildEventHashPayload(makeRow(), [makeLink(LOT_A, 'input', '1.0000')]);
    const quantityChanged = buildEventHashPayload(makeRow(), [makeLink(LOT_A, 'input', '1.0001')]);
    const datetimeChanged = buildEventHashPayload(
      makeRow({ event_datetime: new Date('2026-01-01T10:00:00.001Z') }),
      [makeLink(LOT_A, 'input', '1.0000')],
    );

    expect(computeEventHash(quantityChanged, GENESIS_HASH)).not.toBe(computeEventHash(base, GENESIS_HASH));
    expect(computeEventHash(datetimeChanged, GENESIS_HASH)).not.toBe(computeEventHash(base, GENESIS_HASH));
  });

  it('leaves mutable and non-canonical columns out of the payload', () => {
    const payload = buildEventHashPayload(makeRow({ status: 'amended', void_reason: 'fix' }), []);

    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('voidReason');
    expect(payload).not.toHaveProperty('chainSeq');
    expect(payload).not.toHaveProperty('hashVersion');
  });
});
