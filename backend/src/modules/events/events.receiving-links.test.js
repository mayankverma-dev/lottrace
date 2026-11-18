const { amendEventSchema, createEventSchema } = require('./events.validation');

const LOT_ID = '00000000-0000-4000-8000-000000000001';
const OUTPUT_ID = '00000000-0000-4000-8000-000000000002';
const LOCATION_ID = '00000000-0000-4000-8000-000000000003';

const link = (lotId) => ({ lotId, quantity: 1, uom: 'kg' });

const receivingPayload = (overrides = {}) => ({
  eventType: 'receiving',
  locationId: LOCATION_ID,
  eventDatetime: '2026-11-15T10:00:00.000Z',
  source: 'manual',
  kdePayload: {},
  inputs: [link(LOT_ID)],
  outputs: [],
  ...overrides,
});

describe('P1-33 receiving link validation', () => {
  it('accepts receiving with input lots only', () => {
    const parsed = createEventSchema.parse(receivingPayload());

    expect(parsed.eventType).toBe('receiving');
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.outputs).toEqual([]);
  });

  it('rejects receiving with an output lot', () => {
    const result = createEventSchema.safeParse(receivingPayload({
      outputs: [link(OUTPUT_ID)],
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['outputs'],
        message: 'Receiving events have no output lots',
      }),
    ]));
  });

  it('rejects receiving that only declares output lots', () => {
    const result = createEventSchema.safeParse(receivingPayload({
      inputs: [],
      outputs: [link(OUTPUT_ID)],
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['outputs'] }),
    ]));
  });

  it('rejects receiving without an input lot', () => {
    const result = createEventSchema.safeParse(receivingPayload({ inputs: [] }));

    expect(result.success).toBe(false);
  });

  it('rejects receiving without a location', () => {
    const result = createEventSchema.safeParse(receivingPayload({ locationId: undefined }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['locationId'],
        message: 'Receiving location is required',
      }),
    ]));
  });

  it('rejects an amendment that adds an output lot to receiving', () => {
    const result = amendEventSchema.safeParse(receivingPayload({
      outputs: [link(OUTPUT_ID)],
      amendReason: 'wrong received lot',
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['outputs'] }),
    ]));
  });
});
