const {
  HASH_VERSION_LEGACY,
  HASH_VERSION_CANONICAL,
  CURRENT_HASH_VERSION,
  computeEventHash,
  buildCanonicalEventPayload,
  buildLegacyEventPayload,
  buildEventPayloadForVerification,
} = require('./hashChain');

const LOCATION_ID = '11111111-1111-4111-8111-111111111111';
const INPUT_LOT_ID = '22222222-2222-4222-8222-222222222222';
const OUTPUT_LOT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_LOT_ID = '44444444-4444-4444-8444-444444444444';

const baseEvent = {
  eventType: 'transformation',
  locationId: LOCATION_ID,
  eventDatetime: '2026-01-01T10:00:00Z',
  source: 'manual',
  kdePayload: {},
  counterpartyInfo: null,
  inputs: [{ lotId: INPUT_LOT_ID, quantity: '1.0000', uom: 'kg' }],
  outputs: [{ lotId: OUTPUT_LOT_ID, quantity: '3.0000', uom: 'kg' }],
};

describe('canonical event payload (hash_version 2)', () => {
  it('is the current hash version', () => {
    expect(CURRENT_HASH_VERSION).toBe(HASH_VERSION_CANONICAL);
    expect(HASH_VERSION_CANONICAL).toBe(2);
    expect(HASH_VERSION_LEGACY).toBe(1);
  });

  it('always exposes the same explicit field set', () => {
    const payload = buildCanonicalEventPayload(baseEvent);

    expect(Object.keys(payload).sort()).toEqual([
      'counterpartyInfo',
      'eventDatetime',
      'eventType',
      'hashVersion',
      'inputs',
      'kdePayload',
      'locationId',
      'outputs',
      'source',
    ]);
    expect(payload.hashVersion).toBe(2);
  });

  it('normalizes every accepted datetime form to ISO-8601 UTC with milliseconds', () => {
    const cases = [
      ['2026-01-01T10:00:00Z', '2026-01-01T10:00:00.000Z'],
      ['2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z'],
      ['2026-01-01T10:00:00.1Z', '2026-01-01T10:00:00.100Z'],
      ['2026-01-01T10:00:00.123456Z', '2026-01-01T10:00:00.123Z'],
      [new Date('2026-01-01T10:00:00Z'), '2026-01-01T10:00:00.000Z'],
    ];

    for (const [input, expected] of cases) {
      expect(buildCanonicalEventPayload({ ...baseEvent, eventDatetime: input }).eventDatetime).toBe(
        expected,
      );
    }
  });

  it('hashes the same instant identically regardless of the datetime string form', () => {
    const withoutMs = computeEventHash(
      buildCanonicalEventPayload({ ...baseEvent, eventDatetime: '2026-01-01T10:00:00Z' }),
      'GENESIS',
    );
    const withMs = computeEventHash(
      buildCanonicalEventPayload({ ...baseEvent, eventDatetime: '2026-01-01T10:00:00.000Z' }),
      'GENESIS',
    );

    expect(withoutMs).toBe(withMs);
  });

  it('is independent of the order the links arrive in', () => {
    const inputs = [
      { lotId: OUTPUT_LOT_ID, quantity: '2.5000', uom: 'kg' },
      { lotId: INPUT_LOT_ID, quantity: '1.0000', uom: 'kg' },
    ];
    const outputs = [
      { lotId: OTHER_LOT_ID, quantity: '0.5000', uom: 'kg' },
      { lotId: OUTPUT_LOT_ID, quantity: '3.0000', uom: 'kg' },
    ];

    const forward = buildCanonicalEventPayload({ ...baseEvent, inputs, outputs });
    const reversed = buildCanonicalEventPayload({
      ...baseEvent,
      inputs: [...inputs].reverse(),
      outputs: [...outputs].reverse(),
    });

    expect(reversed).toEqual(forward);
    expect(computeEventHash(reversed, 'GENESIS')).toBe(computeEventHash(forward, 'GENESIS'));
    expect(forward.inputs.map((link) => link.lotId)).toEqual([INPUT_LOT_ID, OUTPUT_LOT_ID]);
    expect(forward.outputs.map((link) => link.lotId)).toEqual([OUTPUT_LOT_ID, OTHER_LOT_ID]);
  });

  it('keeps the same lot when it is both an input and an output', () => {
    const payload = buildCanonicalEventPayload({
      ...baseEvent,
      inputs: [{ lotId: INPUT_LOT_ID, quantity: '1.0000', uom: 'kg' }],
      outputs: [{ lotId: INPUT_LOT_ID, quantity: '1.0000', uom: 'kg' }],
    });

    expect(payload.inputs).toHaveLength(1);
    expect(payload.outputs).toHaveLength(1);
    expect(payload.inputs[0].lotId).toBe(payload.outputs[0].lotId);
  });

  it('applies defaults for optional fields', () => {
    const payload = buildCanonicalEventPayload({
      ...baseEvent,
      locationId: undefined,
      kdePayload: undefined,
      counterpartyInfo: undefined,
      inputs: undefined,
      outputs: undefined,
    });

    expect(payload.locationId).toBeNull();
    expect(payload.kdePayload).toEqual({});
    expect(payload.counterpartyInfo).toBeNull();
    expect(payload.inputs).toEqual([]);
    expect(payload.outputs).toEqual([]);
  });

  it('normalizes JSON payloads the same way a jsonb round-trip does', () => {
    const payload = buildCanonicalEventPayload({
      ...baseEvent,
      kdePayload: { a: 1.5, nested: { b: 'x', dropped: undefined } },
    });

    expect(payload.kdePayload).toEqual({ a: 1.5, nested: { b: 'x' } });
  });

  it('rejects a raw JavaScript number quantity instead of writing an unverifiable hash', () => {
    expect(() =>
      buildCanonicalEventPayload({
        ...baseEvent,
        inputs: [{ lotId: INPUT_LOT_ID, quantity: 1, uom: 'kg' }],
      }),
    ).toThrow(/canonical numeric\(15,4\) string/);
  });

  it('produces the same canonical payload from a persisted row and from a request object', () => {
    const requestPayload = buildCanonicalEventPayload(baseEvent);

    const rowPayload = buildEventPayloadForVerification(
      {
        hash_version: 2,
        event_type: baseEvent.eventType,
        location_id: baseEvent.locationId,
        event_datetime: new Date('2026-01-01T10:00:00.000Z'),
        source: baseEvent.source,
        kde_payload: {},
        counterparty_info: null,
      },
      [
        {
          lot_id: OUTPUT_LOT_ID,
          direction: 'output',
          quantity: '3.0000',
          uom: 'kg',
        },
        {
          lot_id: INPUT_LOT_ID,
          direction: 'input',
          quantity: '1.0000',
          uom: 'kg',
        },
      ],
    );

    expect(rowPayload).toEqual(requestPayload);
    expect(computeEventHash(rowPayload, 'GENESIS')).toBe(
      computeEventHash(requestPayload, 'GENESIS'),
    );
  });
});

describe('legacy event payload (hash_version 1)', () => {
  const legacyEvent = {
    eventType: 'transformation',
    locationId: LOCATION_ID,
    eventDatetime: new Date('2026-01-01T10:00:00.000Z'),
    source: 'manual',
    kdePayload: { batch_temp_c: 4.5, supplier: 'Acme' },
    counterpartyInfo: null,
  };
  const legacyLinks = [
    { lotId: OUTPUT_LOT_ID, direction: 'output', quantity: '3.0000', uom: 'kg' },
    { lotId: INPUT_LOT_ID, direction: 'input', quantity: '1.0000', uom: 'kg' },
  ];

  it('is frozen: payload shape and hash must never change', () => {
    const payload = buildLegacyEventPayload(legacyEvent, legacyLinks);

    expect(payload).toEqual({
      eventType: 'transformation',
      locationId: LOCATION_ID,
      eventDatetime: '2026-01-01T10:00:00.000Z',
      source: 'manual',
      kdePayload: { batch_temp_c: 4.5, supplier: 'Acme' },
      counterpartyInfo: null,
      inputs: [{ lotId: INPUT_LOT_ID, quantity: '1.0000', uom: 'kg' }],
      outputs: [{ lotId: OUTPUT_LOT_ID, quantity: '3.0000', uom: 'kg' }],
    });
    expect(computeEventHash(payload, 'GENESIS')).toBe(
      '994de1de073e820d355e84cb848ab8155d8a1a05ada1aae96e632c0760b219c7',
    );
  });
});

describe('verification dispatch', () => {
  const row = {
    hash_version: 1,
    event_type: 'creation',
    location_id: null,
    event_datetime: new Date('2026-01-01T10:00:00.000Z'),
    source: 'manual',
    kde_payload: {},
    counterparty_info: null,
  };

  it('uses the legacy payload for hash_version 1', () => {
    const payload = buildEventPayloadForVerification(row, []);

    expect(payload).not.toHaveProperty('hashVersion');
    expect(payload).toEqual(buildLegacyEventPayload({
      eventType: 'creation',
      locationId: null,
      eventDatetime: row.event_datetime,
      source: 'manual',
      kdePayload: {},
      counterpartyInfo: null,
    }, []));
  });

  it('uses the canonical payload for hash_version 2', () => {
    const payload = buildEventPayloadForVerification({ ...row, hash_version: 2 }, []);

    expect(payload.hashVersion).toBe(2);
  });

  it('treats a missing hash_version as legacy (pre-migration rows)', () => {
    const payload = buildEventPayloadForVerification({ ...row, hash_version: undefined }, []);

    expect(payload).not.toHaveProperty('hashVersion');
  });

  it('fails closed for an unknown hash_version', () => {
    expect(() => buildEventPayloadForVerification({ ...row, hash_version: 9 }, [])).toThrow(
      /Unsupported event hash_version/,
    );
  });
});
