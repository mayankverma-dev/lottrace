const { amendEventSchema, createEventSchema } = require('./events.validation');

const LOT_ID = '00000000-0000-4000-8000-000000000001';
const OUTPUT_ID = '00000000-0000-4000-8000-000000000002';

const link = (lotId) => ({ lotId, quantity: 1, uom: 'kg' });

const shippingPayload = (overrides = {}) => ({
  eventType: 'shipping',
  eventDatetime: '2026-11-15T10:00:00.000Z',
  source: 'manual',
  kdePayload: {},
  inputs: [link(LOT_ID)],
  outputs: [],
  ...overrides,
});

describe('P0-10 shipping link validation', () => {
  it('accepts shipping with input lots only', () => {
    const parsed = createEventSchema.parse(shippingPayload());

    expect(parsed.eventType).toBe('shipping');
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.outputs).toEqual([]);
  });

  it('rejects shipping with an output lot', () => {
    const result = createEventSchema.safeParse(shippingPayload({
      outputs: [link(OUTPUT_ID)],
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['outputs'],
        message: 'Shipping events have no output lots',
      }),
    ]));
  });

  it('rejects shipping without an input lot', () => {
    const result = createEventSchema.safeParse(shippingPayload({ inputs: [] }));

    expect(result.success).toBe(false);
  });

  it('rejects an amendment that adds an output lot to shipping', () => {
    const result = amendEventSchema.safeParse(shippingPayload({
      outputs: [link(OUTPUT_ID)],
      amendReason: 'wrong destination lot',
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['outputs'] }),
    ]));
  });
});
