const {
  EXPORT_COLUMNS,
  AUDIT_EXPORT_COLUMNS,
  EXPORT_LIMITS,
  EXPORT_LIMIT_ERROR_CODE,
  assertExportWithinLimits,
  contentTypeFor,
  extensionFor,
  formatEventRow,
  formatAuditRow,
  sanitizeCsvCell,
  csvHeader,
  auditCsvHeader,
  serializeCsvBatch,
  serializeAuditCsvBatch,
  serializeJsonBatch,
  serializeAuditJsonBatch,
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

const auditLog = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: 'must-not-be-exported',
  actor_id: '44444444-4444-4444-8444-444444444444',
  actor_type: 'user',
  actor_first_name: 'Pat',
  actor_last_name: 'Auditor',
  actor_email: 'pat@example.test',
  actor_label: null,
  action: 'lot.void',
  entity_type: 'lot',
  entity_id: '55555555-5555-4555-8555-555555555555',
  before_state: { status: 'active' },
  after_state: { status: 'void' },
  metadata: { url: '/api/v1/lots/55555555-5555-4555-8555-555555555555/void' },
  ip_address: '127.0.0.1',
  created_at_iso: '2026-11-16T11:00:00.000000Z',
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

  it('enforces the row and byte export limits', () => {
    expect(() => assertExportWithinLimits({
      rowCount: EXPORT_LIMITS.maxRows,
      bytes: EXPORT_LIMITS.maxBytes,
    })).not.toThrow();

    const expectLimitError = (input) => {
      let error;
      try {
        assertExportWithinLimits(input);
      } catch (err) {
        error = err;
      }
      expect(error).toMatchObject({ code: EXPORT_LIMIT_ERROR_CODE });
    };

    expectLimitError({ rowCount: EXPORT_LIMITS.maxRows + 1, bytes: 0 });
    expectLimitError({ rowCount: 0, bytes: EXPORT_LIMITS.maxBytes + 1 });
    expectLimitError({
      rowCount: 3,
      bytes: 0,
      limits: { maxRows: 2, maxBytes: 1024 },
    });
  });

  it('exports the agreed audit column set only', () => {
    const row = formatAuditRow(auditLog);

    expect(Object.keys(row)).toEqual(AUDIT_EXPORT_COLUMNS);
    expect(row.actor_name).toBe('Pat Auditor');
    expect(row).not.toHaveProperty('organization_id');
    expect(row).not.toHaveProperty('actor_first_name');
  });

  it('writes an audit CSV header with every agreed column', () => {
    const header = auditCsvHeader();

    expect(header.endsWith('\n')).toBe(true);
    expect(header.split(',')).toHaveLength(AUDIT_EXPORT_COLUMNS.length);
    expect(header).toContain('action');
    expect(header).toContain('metadata');
    expect(header).not.toContain('event_type');
  });

  it('serializes audit JSON fields correctly in CSV and JSON', () => {
    const csv = serializeAuditCsvBatch([auditLog]);

    expect(csv).toContain('lot.void');
    expect(csv).toContain('127.0.0.1');
    expect(csv).toContain('2026-11-16T11:00:00.000000Z');
    expect(csv).toContain('{""status"":""void""}');
    expect(csv).not.toContain('[object Object]');

    const jsonRows = JSON.parse(`[${serializeAuditJsonBatch([auditLog], true)}]`);
    expect(jsonRows).toHaveLength(1);
    expect(jsonRows[0].before_state).toEqual({ status: 'active' });
    expect(jsonRows[0].after_state).toEqual({ status: 'void' });
    expect(jsonRows[0].created_at).toBe('2026-11-16T11:00:00.000000Z');
  });

  it('keeps the exact microsecond audit timestamp in CSV and JSON', () => {
    const preciseAuditLog = {
      ...auditLog,
      created_at_iso: '2026-11-16T11:00:00.123456Z',
    };

    expect(serializeAuditCsvBatch([preciseAuditLog])).toContain('2026-11-16T11:00:00.123456Z');

    const jsonRows = JSON.parse(`[${serializeAuditJsonBatch([preciseAuditLog], true)}]`);
    expect(jsonRows[0].created_at).toBe('2026-11-16T11:00:00.123456Z');
  });

  it('neutralizes spreadsheet formula prefixes in audit CSV cells', () => {
    const csv = serializeAuditCsvBatch([{ ...auditLog, action: '=HYPERLINK("http://evil.test")' }]);

    expect(csv).toContain(`'=HYPERLINK`);
  });

  it('maps formats to content types and extensions', () => {
    expect(contentTypeFor('csv')).toBe('text/csv');
    expect(contentTypeFor('json')).toBe('application/json');
    expect(extensionFor('csv')).toBe('csv');
    expect(extensionFor('json')).toBe('json');
  });
});
