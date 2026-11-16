const { stringify } = require('csv-stringify/sync');

const EXPORT_BATCH_SIZE = 500;

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

const CONTENT_TYPES = {
  csv: 'text/csv',
  json: 'application/json',
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

const toCsvRow = (row) => {
  const csvRow = {};

  for (const column of EXPORT_COLUMNS) {
    const value = row[column];
    if (CSV_JSON_COLUMNS.has(column)) {
      csvRow[column] = value == null ? '' : JSON.stringify(value);
    } else {
      csvRow[column] = value == null ? '' : value;
    }
  }

  return csvRow;
};

const csvHeader = () => stringify([], { header: true, columns: EXPORT_COLUMNS });

const serializeCsvBatch = (events) => stringify(
  events.map((event) => toCsvRow(formatEventRow(event))),
  { header: false, columns: EXPORT_COLUMNS },
);

// JSON is written as an array one batch at a time, so the full result set never
// has to exist as one string in memory.
const serializeJsonBatch = (events, isFirst) => (
  `${isFirst ? '' : ','}${events.map((event) => JSON.stringify(formatEventRow(event))).join(',')}`
);

const contentTypeFor = (format) => CONTENT_TYPES[format];

const extensionFor = (format) => format;

module.exports = {
  EXPORT_BATCH_SIZE,
  EXPORT_COLUMNS,
  formatEventRow,
  csvHeader,
  serializeCsvBatch,
  serializeJsonBatch,
  contentTypeFor,
  extensionFor,
};
