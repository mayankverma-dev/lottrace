/**
 * P1-18 unit tests — keyed, full-coverage canonical payload.
 *
 * No database. Pins the payload shape and HMAC keyring behavior shared by the
 * write, import, and verification paths.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.ACCESS_JWT_SECRET = process.env.ACCESS_JWT_SECRET || 'a'.repeat(64);
process.env.REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET || 'b'.repeat(64);
process.env.ARGON2_SECRET = process.env.ARGON2_SECRET || 'c'.repeat(32);
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key';

const KEY_ID = 'test-k1';
const SECRET = 'd'.repeat(64);
const OLD_KEY_ID = 'test-k0';
const OLD_SECRET = 'e'.repeat(64);

process.env.HASH_CHAIN_KEY_ID = KEY_ID;
process.env.HASH_CHAIN_SECRET = SECRET;
process.env.HASH_CHAIN_OLD_KEYS = JSON.stringify({ [OLD_KEY_ID]: OLD_SECRET });

const crypto = require('crypto');
const {
  HASH_VERSION,
  GENESIS_HASH,
  PENDING_RECORD_HASH,
  PENDING_HASH_KEY_ID,
  computeEventHash,
  computeEventEvidenceHash,
  buildEventHashPayload,
  buildEventEvidenceHashPayload,
  getKeyRing,
  hasHashKey,
  stableStringify,
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
  recorded_by: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  recorded_at: new Date('2026-01-01T10:00:01.000Z'),
  source: 'manual',
  kde_payload: {},
  compliance_gaps: null,
  notes: 'full coverage',
  idempotency_key: null,
  chain_seq: '1',
  hash_version: 3,
  hash_key_id: KEY_ID,
  status: 'active',
  supersedes_event_id: null,
  void_reason: null,
  created_at: new Date('2026-01-01T10:00:01.000Z'),
  ...overrides,
});

const makeLink = (lotId, direction, quantity, uom = 'kg') => ({
  lot_id: lotId,
  direction,
  quantity,
  uom,
});

const basePayload = () => buildEventHashPayload(makeRow(), []);

describe('hashChain canonical payload (P1-18)', () => {
  it('exposes version 3, genesis marker, and pending sentinels', () => {
    expect(HASH_VERSION).toBe(3);
    expect(GENESIS_HASH).toBe('GENESIS');
    expect(PENDING_RECORD_HASH).toBe('PENDING');
    expect(PENDING_HASH_KEY_ID).toBe('PENDING');
  });

  it('normalizes every immutable persisted value into an explicit shape', () => {
    const payload = buildEventHashPayload(makeRow(), []);

    expect(payload).toEqual({
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      chainSeq: 1,
      eventType: 'transformation',
      locationId: null,
      counterpartyInfo: null,
      eventDatetime: '2026-01-01T10:00:00.000Z',
      recordedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      recordedAt: '2026-01-01T10:00:01.000Z',
      source: 'manual',
      kdePayload: {},
      complianceGaps: null,
      notes: 'full coverage',
      idempotencyKey: null,
      supersedesEventId: null,
      createdAt: '2026-01-01T10:00:01.000Z',
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

  it('uses keyed HMAC-SHA256, not plain SHA-256', () => {
    const payload = basePayload();
    const legacy = crypto
      .createHash('sha256')
      .update(`${GENESIS_HASH}|${stableStringify(payload)}`)
      .digest('hex');

    expect(computeEventHash(payload, GENESIS_HASH)).not.toBe(legacy);
    expect(computeEventHash(payload, GENESIS_HASH, OLD_KEY_ID)).not.toBe(
      computeEventHash(payload, GENESIS_HASH, KEY_ID),
    );
  });

  it('rejects an unknown key id', () => {
    expect(() => computeEventHash(basePayload(), GENESIS_HASH, 'missing-key')).toThrow(
      /Unsupported hash key id/,
    );
    expect(() => computeEventHash(basePayload(), GENESIS_HASH, 'missing-key')).toThrow(
      expect.objectContaining({ code: 'unsupported_hash_key' }),
    );
  });

  it('covers every immutable field', () => {
    const baselineHash = computeEventHash(basePayload(), GENESIS_HASH);
    const overrides = [
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      { organization_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      { chain_seq: '2' },
      { event_type: 'shipping' },
      { location_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      { counterparty_info: { name: 'Supplier' } },
      { event_datetime: new Date('2026-01-01T10:00:00.001Z') },
      { recorded_by: '99999999-9999-4999-8999-999999999999' },
      { recorded_at: new Date('2026-01-01T10:00:02.000Z') },
      { source: 'import' },
      { kde_payload: { lot: 'A' } },
      { compliance_gaps: [{ field: 'kde', message: 'required' }] },
      { notes: 'tampered' },
      { idempotency_key: 'idem-1' },
      { supersedes_event_id: '88888888-8888-4888-8888-888888888888' },
      { created_at: new Date('2026-01-01T10:00:03.000Z') },
    ];

    overrides.forEach((override) => {
      const changed = buildEventHashPayload(makeRow(override), []);
      expect(computeEventHash(changed, GENESIS_HASH)).not.toBe(baselineHash);
    });
  });

  it('covers link quantity and uom', () => {
    const base = buildEventHashPayload(makeRow(), [makeLink(LOT_A, 'input', '1.0000', 'kg')]);
    const quantityChanged = buildEventHashPayload(makeRow(), [makeLink(LOT_A, 'input', '1.0001', 'kg')]);
    const uomChanged = buildEventHashPayload(makeRow(), [makeLink(LOT_A, 'input', '1.0000', 'lb')]);

    expect(computeEventHash(quantityChanged, GENESIS_HASH)).not.toBe(
      computeEventHash(base, GENESIS_HASH),
    );
    expect(computeEventHash(uomChanged, GENESIS_HASH)).not.toBe(
      computeEventHash(base, GENESIS_HASH),
    );
  });

  it('leaves mutable lifecycle and hash bookkeeping columns out of the event payload', () => {
    const payload = buildEventHashPayload(makeRow({ status: 'void', void_reason: 'bad data' }), []);

    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('voidReason');
    expect(payload).not.toHaveProperty('hashVersion');
    expect(payload).not.toHaveProperty('hashKeyId');
    expect(payload).not.toHaveProperty('recordHash');
    expect(payload).not.toHaveProperty('prevHash');
  });

  it('builds a canonical evidence payload from persisted values', () => {
    const evidence = {
      id: '11111111-2222-4333-8444-555555555555',
      event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      seq: 1,
      kind: 'status_change',
      payload: { fromStatus: 'active', toStatus: 'void', reason: 'bad data', actorId: null },
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    };

    expect(buildEventEvidenceHashPayload(evidence)).toEqual({
      evidenceId: evidence.id,
      eventId: evidence.event_id,
      organizationId: evidence.organization_id,
      seq: 1,
      kind: 'status_change',
      payload: evidence.payload,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('separates the evidence hash domain from the event hash domain', () => {
    const payload = basePayload();

    expect(computeEventEvidenceHash(payload, GENESIS_HASH)).not.toBe(
      computeEventHash(payload, GENESIS_HASH),
    );
  });

  it('resolves old keys for verification after rotation', () => {
    const ring = getKeyRing();

    expect(hasHashKey(KEY_ID, ring)).toBe(true);
    expect(hasHashKey(OLD_KEY_ID, ring)).toBe(true);
    expect(hasHashKey('missing-key', ring)).toBe(false);
    expect(computeEventHash(basePayload(), GENESIS_HASH, OLD_KEY_ID, ring)).toMatch(/^[a-f0-9]{64}$/);
  });
});
