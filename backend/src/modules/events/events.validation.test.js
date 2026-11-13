/**
 * P2-15 — amendment reason must not reuse the void contract.
 *
 * The amend endpoint requires `amendReason`. The void endpoint keeps
 * `voidReason`. These are schema-level tests, so no database is needed.
 */
const { amendEventSchema, voidEventSchema } = require('./events.validation');

const amendPayload = (overrides = {}) => ({
  eventType: 'transformation',
  eventDatetime: '2026-11-13T10:00:00.000Z',
  source: 'manual',
  kdePayload: {},
  inputs: [{ lotId: '00000000-0000-4000-8000-000000000001', quantity: 1, uom: 'kg' }],
  outputs: [{ lotId: '00000000-0000-4000-8000-000000000002', quantity: 1, uom: 'kg' }],
  amendReason: 'corrected quantity',
  ...overrides,
});

describe('P2-15 amendment reason validation', () => {
  it('accepts an amendment with amendReason', () => {
    const parsed = amendEventSchema.parse(amendPayload());
    expect(parsed.amendReason).toBe('corrected quantity');
  });

  it('rejects an amendment without amendReason', () => {
    const { amendReason, ...withoutReason } = amendPayload();
    expect(amendReason).toBeDefined();
    expect(() => amendEventSchema.parse(withoutReason)).toThrow();
  });

  it('does not accept voidReason as the amendment reason', () => {
    const { amendReason, ...withoutReason } = amendPayload();
    expect(amendReason).toBeDefined();
    expect(() => amendEventSchema.parse({
      ...withoutReason,
      voidReason: 'corrected quantity',
    })).toThrow();
  });

  it('keeps voidReason as the void contract', () => {
    expect(voidEventSchema.parse({ voidReason: 'recorded in error' }).voidReason)
      .toBe('recorded in error');
    expect(() => voidEventSchema.parse({ amendReason: 'recorded in error' })).toThrow();
  });
});
