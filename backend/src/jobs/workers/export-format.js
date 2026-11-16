const { stringify } = require('csv-stringify/sync');

const EXPORT_BATCH_SIZE = 500;

const EXPORT_LIMITS = Object.freeze({
  maxRows: 1000000,
  maxBytes: 512 * 1024 * 1024,
});

const EXPORT_LIMIT_ERROR_CODE = 'EXPORT_LIMIT_EXCEEDED';

const assertExportWithinLimits = ({ rowCount, bytes, limits = EXPORT_LIMITS }) => {
  if (rowCount > limits.maxRows || bytes > limits.maxBytes) {
    const err = new Error('Export limit exceeded');
    err.code = EXPORT_LIMIT_ERROR_CODE;
    throw err;
  }
};

const EXPORT_COLUMNS = [
  'id',
  'event_type',
  'event_datetime',
  'status',
  'source',
  'location_name',
  'counterparty_info',
  'kde_payload',
  'compliance_gaps',
  'has_compliance_gaps',
  'notes',
  'recorded_by_name',
  'recorded_at',
  'lot_links',
  'supersedes_event_id',
  'status_reason',
  'record_hash',
  'prev_hash',
  'chain_seq',
  'hash_version',
  'hash_key_id',
  'created_at',
];

const CSV_JSON_COLUMNS = new Set([
  'counterparty_info',
  'kde_payload',
  'compliance_gaps',
  'lot_links',
]);

const AUDIT_EXPORT_COLUMNS = [
  'id',
  'created_at',
  'actor_type',
  'actor_id',
  'actor_name',
  'actor_email',
  'actor_label',
  'action',
  'entity_type',
  'entity_id',
  'before_state',
  'after_state',
  'metadata',
  'ip_address',
];

const AUDIT_CSV_JSON_COLUMNS = new Set([
  'before_state',
  'after_state',
  'metadata',
]);

const CONTENT_TYPES = {
  csv: 'text/csv',
  json: 'application/json',
};

// Spreadsheet programs treat a cell beginning with one of these characters as a
// formula. Prefixing the cell with a single quote keeps the value readable while
// forcing it to be treated as text.
const CSV_FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

const sanitizeCsvCell = (value) => {
  if (typeof value !== 'string' || value.length === 0) return value;
  return CSV_FORMULA_PREFIXES.has(value[0]) ? `'${value}` : value;
};

const toIso = (value) => (value instanceof Date ? value.toISOString() : value);

const formatEventRow = (event) => ({
  id: event.id,
  event_type: event.event_type,
  event_datetime: toIso(event.event_datetime),
  status: event.status,
  source: event.source,
  location_name: event.location_name,
  counterparty_info: event.counterparty_info,
  kde_payload: event.kde_payload,
  compliance_gaps: event.compliance_gaps,
  has_compliance_gaps: event.has_compliance_gaps,
  notes: event.notes,
  recorded_by_name: event.recorded_by_name,
  recorded_at: toIso(event.recorded_at),
  lot_links: event.lot_links,
  supersedes_event_id: event.supersedes_event_id,
  status_reason: event.status_reason,
  record_hash: event.record_hash,
  prev_hash: event.prev_hash,
  chain_seq: event.chain_seq,
  hash_version: event.hash_version,
  hash_key_id: event.hash_key_id,
  created_at: toIso(event.created_at),
});

const formatAuditRow = (auditLog) => ({
  id: auditLog.id,
  created_at: auditLog.created_at_iso,
  actor_type: auditLog.actor_type,
  actor_id: auditLog.actor_id,
  actor_name: [auditLog.actor_first_name, auditLog.actor_last_name]
    .filter(Boolean)
    .join(' ') || null,
  actor_email: auditLog.actor_email,
  actor_label: auditLog.actor_label,
  action: auditLog.action,
  entity_type: auditLog.entity_type,
  entity_id: auditLog.entity_id,
  before_state: auditLog.before_state,
  after_state: auditLog.after_state,
  metadata: auditLog.metadata,
  ip_address: auditLog.ip_address,
});

const toCsvRow = (row, columns, jsonColumns) => {
  const csvRow = {};

  for (const column of columns) {
    const value = row[column];
    if (jsonColumns.has(column)) {
      csvRow[column] = value == null ? '' : JSON.stringify(value);
    } else {
      csvRow[column] = sanitizeCsvCell(value == null ? '' : value);
    }
  }

  return csvRow;
};

const csvHeader = (columns = EXPORT_COLUMNS) => stringify([], { header: true, columns });

const serializeCsvBatch = (events) => stringify(
  events.map((event) => toCsvRow(formatEventRow(event), EXPORT_COLUMNS, CSV_JSON_COLUMNS)),
  { header: false, columns: EXPORT_COLUMNS },
);

const auditCsvHeader = () => csvHeader(AUDIT_EXPORT_COLUMNS);

const serializeAuditCsvBatch = (auditLogs) => stringify(
  auditLogs.map((auditLog) => toCsvRow(
    formatAuditRow(auditLog),
    AUDIT_EXPORT_COLUMNS,
    AUDIT_CSV_JSON_COLUMNS
  )),
  { header: false, columns: AUDIT_EXPORT_COLUMNS },
);

// JSON is written as an array one batch at a time, so the full result set never
// has to exist as one string in memory.
const serializeJsonBatch = (events, isFirst) => (
  `${isFirst ? '' : ','}${events.map((event) => JSON.stringify(formatEventRow(event))).join(',')}`
);

const serializeAuditJsonBatch = (auditLogs, isFirst) => (
  `${isFirst ? '' : ','}${auditLogs.map((auditLog) => JSON.stringify(formatAuditRow(auditLog))).join(',')}`
);

const contentTypeFor = (format) => CONTENT_TYPES[format];

const extensionFor = (format) => format;

module.exports = {
  EXPORT_BATCH_SIZE,
  EXPORT_COLUMNS,
  AUDIT_EXPORT_COLUMNS,
  EXPORT_LIMITS,
  EXPORT_LIMIT_ERROR_CODE,
  assertExportWithinLimits,
  formatEventRow,
  formatAuditRow,
  sanitizeCsvCell,
  csvHeader,
  auditCsvHeader,
  serializeCsvBatch,
  serializeAuditCsvBatch,
  serializeJsonBatch,
  serializeAuditJsonBatch,
  contentTypeFor,
  extensionFor,
};
