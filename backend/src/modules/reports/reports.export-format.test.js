const {
  EXPORT_COLUMNS,
  contentTypeFor,
  extensionFor,
  formatEventRow,
  sanitizeCsvCell,
  csvHeader,
  serializeCsvBatch,
  serializeJsonBatch,
} = require('../../jobs/workers/export-format');

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  event_type: 'receiving',
  event_datetime: new Date('2026-11-16T10:00:00.000Z'),
  status: 'active',
  source: 'scan',
  location_name: 'Plant A',
  counterparty_info: { name: 'Supplier A' },
  kde_payload: { lot_code: 'LOT-1' },
  compliance_gaps: [{ field: 'kdePayload.lot_code', message: 'Missing' }],
  has_compliance_gaps: true,
  notes: 'Received',
  recorded_by_name: 'Pat Operator',
  recorded_at: new Date('2026-11-16T10:05:00.000Z'),
  lot_links: [{ id: 'lot-1', traceabilityLotCode: 'TLC-1', direction: 'input' }],
  supersedes_event_id: null,
  status_reason: null,
  record_hash: 'hash',
  prev_hash: 'prev',
  chain_seq: '7',
  hash_version: 3,
  hash_key_id: 'k1',
  created_at: new Date('2026-11-16T10:06:00.000Z'),
  organization_id: 'must-not-be-exported',
  idempotency_key: 'must-not-be-exported',
};

describe('P1-02 export formatting', () => {
  it('exports the agreed event column set only', () => {
    const row = formatEventRow(event);

    expect(Object.keys(row)).toEqual(EXPORT_COLUMNS);
    expect(row).not.toHaveProperty('organization_id');
    expect(row).not.toHaveProperty('idempotency_key');
  });

  it('serializes dates as ISO strings and keeps JSON fields structured', () => {
    const row = formatEventRow(event);

    expect(row.event_datetime).toBe('2026-11-16T10:00:00.000Z');
    expect(row.recorded_at).toBe('2026-11-16T10:05:00.000Z');
    expect(row.created_at).toBe('2026-11-16T10:06:00.000Z');
    expect(row.lot_links).toEqual(event.lot_links);
    expect(row.kde_payload).toEqual({ lot_code: 'LOT-1' });
  });

  it('writes a CSV header with every agreed column', () => {
    const header = csvHeader();

    expect(header.endsWith('\n')).toBe(true);
    expect(header.split(',')).toHaveLength(EXPORT_COLUMNS.length);
    expect(header).toContain('record_hash');
    expect(header).toContain('lot_links');
  });

  it('JSON-stringifies object fields in CSV rows', () => {
    const csv = serializeCsvBatch([event]);

    expect(csv).toContain('"Supplier A"');
    expect(csv).toContain('TLC-1');
    expect(csv).not.toContain('[object Object]');
    expect(csv).toContain('2026-11-16T10:00:00.000Z');
  });

  it('neutralizes every spreadsheet formula prefix in scalar CSV cells', () => {
    const triggers = ['=1+1', '+1', '-1', '@SUM(A1)', '\tvalue', '\rvalue'];

    for (const trigger of triggers) {
      expect(sanitizeCsvCell(trigger)).toBe(`'${trigger}`);
    }

    expect(sanitizeCsvCell('Received')).toBe('Received');
    expect(sanitizeCsvCell('')).toBe('');
    expect(sanitizeCsvCell(null)).toBeNull();
    expect(sanitizeCsvCell(42)).toBe(42);

    const csv = serializeCsvBatch([{ ...event, notes: '=HYPERLINK("http://evil.test")' }]);
    expect(csv).toContain(`'=HYPERLINK`);
  });

  it('leaves JSON columns untouched when neutralizing CSV cells', () => {
    const csv = serializeCsvBatch([{ ...event, kde_payload: { formula: '=1+1' } }]);

    expect(csv).toContain('"{""formula"":""=1+1""}"');
  });

  it('writes JSON as an array split across batches', () => {
    const first = serializeJsonBatch([event], true);
    const second = serializeJsonBatch([{ ...event, id: '22222222-2222-4222-8222-222222222222' }], false);
    const parsed = JSON.parse(`[${first}${second}]`);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].lot_links).toEqual(event.lot_links);
    expect(parsed[1].event_datetime).toBe('2026-11-16T10:00:00.000Z');
  });

  it('maps formats to content types and extensions', () => {
    expect(contentTypeFor('csv')).toBe('text/csv');
    expect(contentTypeFor('json')).toBe('application/json');
    expect(extensionFor('csv')).toBe('csv');
    expect(extensionFor('json')).toBe('json');
  });
});
