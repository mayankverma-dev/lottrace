const crypto = require('crypto');

const HASH_VERSION_LEGACY = 1;
const HASH_VERSION_CANONICAL = 2;
const CURRENT_HASH_VERSION = HASH_VERSION_CANONICAL;

// event_lot_links.quantity is numeric(15,4); PostgreSQL renders it with exactly 4 decimals.
const CANONICAL_QUANTITY_REGEX = /^-?\d+\.\d{4}$/;

/**
 * Computes a SHA-256 hash for an event payload combined with the previous hash in the chain.
 * @param {Object} eventPayload - The event data to hash (excluding volatile fields)
 * @param {string} prevHash - The hash of the previous event for this organization
 * @returns {string} - The new record_hash
 */
const computeEventHash = (eventPayload, prevHash) => {
  // Create a stable string representation
  // Sort keys to ensure consistent serialization
  const stableStringify = (obj) => {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
    const sortedKeys = Object.keys(obj).sort();
    return `{${sortedKeys.map(k => `"${k}":${stableStringify(obj[k])}`).join(',')}}`;
  };

  const payloadString = stableStringify(eventPayload);
  const dataToHash = `${prevHash}|${payloadString}`;

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
};

/**
 * Normalizes a JSON value the same way a jsonb round-trip does (drops undefined keys,
 * normalizes numbers through the JSON representation). Returns null for null/undefined.
 * @param {*} value
 * @returns {*} normalized JSON value or null
 */
const normalizeJsonValue = (value) => {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
};

/**
 * Normalizes an event datetime to ISO-8601 UTC with milliseconds, matching the value
 * PostgreSQL returns for a timestamptz column.
 * @param {string|Date} value
 * @returns {string} ISO-8601 UTC string
 */
const canonicalizeEventDatetime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid event datetime: ${String(value)}`);
  }
  return date.toISOString();
};

/**
 * Validates that a quantity is already in the canonical numeric(15,4) text form.
 * Throwing here is intentional: writing a hash that can never be verified is worse
 * than failing the request.
 * @param {string|null} value
 * @returns {string|null}
 */
const toCanonicalQuantity = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !CANONICAL_QUANTITY_REGEX.test(value)) {
    throw new Error(
      `Quantity must be a canonical numeric(15,4) string, received ${typeof value}: ${String(value)}`,
    );
  }
  return value;
};

/**
 * Sorts links deterministically by lot id. UUID strings are compared by code point so
 * the order never depends on locale, ICU version, or database row order.
 * @param {Array<{ lotId: string }>} links
 * @returns {Array<Object>} sorted copy
 */
const sortLinks = (links = []) => [...links].sort((a, b) => {
  if (a.lotId === b.lotId) return 0;
  return a.lotId < b.lotId ? -1 : 1;
});

/**
 * @param {{ lotId: string, quantity: string|null, uom: string|null }} link
 * @returns {{ lotId: string, quantity: string|null, uom: string|null }}
 */
const toCanonicalLink = (link) => ({
  lotId: link.lotId,
  quantity: toCanonicalQuantity(link.quantity),
  uom: link.uom ?? null,
});

/**
 * Builds the canonical hash payload (hash_version 2).
 * Every field is explicit so a future field addition is a deliberate hash_version bump.
 * Quantities must already be canonical numeric(15,4) strings — use
 * buildCanonicalEventPayloadForWrite on the write path.
 * @param {Object} event
 * @returns {Object} canonical payload
 */
const buildCanonicalEventPayload = (event) => {
  const inputs = event.inputs || [];
  const outputs = event.outputs || [];

  return {
    hashVersion: HASH_VERSION_CANONICAL,
    eventType: event.eventType,
    locationId: event.locationId ?? null,
    eventDatetime: canonicalizeEventDatetime(event.eventDatetime),
    source: event.source,
    kdePayload: normalizeJsonValue(event.kdePayload) ?? {},
    counterpartyInfo: normalizeJsonValue(event.counterpartyInfo),
    inputs: sortLinks(inputs).map(toCanonicalLink),
    outputs: sortLinks(outputs).map(toCanonicalLink),
  };
};

/**
 * Converts raw quantities into the exact decimal strings PostgreSQL stores in
 * event_lot_links.quantity (numeric(15,4)). Doing the cast in the database guarantees
 * the value hashed at write time is byte-identical to the value read back by the
 * verifier, including PostgreSQL's own rounding rules.
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {Array<number|string|null>} quantities
 * @returns {Promise<Array<string|null>>}
 */
const toStoredQuantityStrings = async (qb, quantities) => {
  if (quantities.length === 0) return [];

  const payload = JSON.stringify(
    quantities.map((quantity) => (quantity === null || quantity === undefined ? null : String(quantity))),
  );

  const result = await qb.raw(
    `SELECT t.ord, (t.value::numeric(15,4))::text AS quantity
       FROM jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS t(value, ord)
      ORDER BY t.ord`,
    [payload],
  );

  return result.rows.map((row) => row.quantity);
};

/**
 * Write-path canonicalizer: casts quantities through PostgreSQL, then builds the
 * canonical payload. Must run inside the same transaction as the event insert.
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {Object} event
 * @returns {Promise<Object>} canonical payload
 */
const buildCanonicalEventPayloadForWrite = async (qb, event) => {
  const inputs = event.inputs || [];
  const outputs = event.outputs || [];

  const quantities = await toStoredQuantityStrings(qb, [
    ...inputs.map((link) => link.quantity),
    ...outputs.map((link) => link.quantity),
  ]);

  const withStoredQuantities = (links, offset) =>
    links.map((link, index) => ({ ...link, quantity: quantities[offset + index] }));

  return buildCanonicalEventPayload({
    ...event,
    inputs: withStoredQuantities(inputs, 0),
    outputs: withStoredQuantities(outputs, inputs.length),
  });
};

/**
 * Frozen reconstruction of the legacy (hash_version 1) payload.
 * This mirrors exactly what the original verifier built from database rows. Do not
 * change it: it exists only so pre-canonical events can still be chain-checked.
 * @param {Object} event - camelCase event shape (see fromEventRow)
 * @param {Array<Object>} links - camelCase link shape (see fromLinkRow)
 * @returns {Object} legacy payload
 */
const buildLegacyEventPayload = (event, links = []) => ({
  eventType: event.eventType,
  locationId: event.locationId,
  eventDatetime: canonicalizeEventDatetime(event.eventDatetime),
  source: event.source,
  kdePayload: normalizeJsonValue(event.kdePayload),
  counterpartyInfo: normalizeJsonValue(event.counterpartyInfo),
  inputs: links
    .filter((link) => link.direction === 'input')
    .map((link) => ({ lotId: link.lotId, quantity: link.quantity, uom: link.uom })),
  outputs: links
    .filter((link) => link.direction === 'output')
    .map((link) => ({ lotId: link.lotId, quantity: link.quantity, uom: link.uom })),
});

/**
 * Maps a persisted events row to the internal camelCase event shape.
 * @param {Object} row
 * @returns {Object}
 */
const fromEventRow = (row) => ({
  eventType: row.event_type,
  locationId: row.location_id,
  eventDatetime: row.event_datetime,
  source: row.source,
  kdePayload: typeof row.kde_payload === 'string' ? JSON.parse(row.kde_payload) : row.kde_payload,
  counterpartyInfo:
    typeof row.counterparty_info === 'string' ? JSON.parse(row.counterparty_info) : row.counterparty_info,
});

/**
 * Maps a persisted event_lot_links row to the internal camelCase link shape.
 * @param {Object} row
 * @returns {Object}
 */
const fromLinkRow = (row) => ({
  lotId: row.lot_id,
  direction: row.direction,
  quantity: row.quantity,
  uom: row.uom,
});

/**
 * Builds the payload to hash for a persisted event, dispatching on hash_version.
 * Unknown versions throw: verification must never silently use the wrong algorithm.
 * @param {Object} eventRow - events row (snake_case)
 * @param {Array<Object>} linkRows - event_lot_links rows (snake_case)
 * @returns {Object} payload to hash
 */
const buildEventPayloadForVerification = (eventRow, linkRows = []) => {
  const version =
    eventRow.hash_version === null || eventRow.hash_version === undefined
      ? HASH_VERSION_LEGACY
      : Number(eventRow.hash_version);

  const event = fromEventRow(eventRow);
  const links = linkRows.map(fromLinkRow);

  if (version === HASH_VERSION_LEGACY) {
    return buildLegacyEventPayload(event, links);
  }

  if (version === HASH_VERSION_CANONICAL) {
    return buildCanonicalEventPayload({
      ...event,
      inputs: links.filter((link) => link.direction === 'input'),
      outputs: links.filter((link) => link.direction === 'output'),
    });
  }

  throw new Error(`Unsupported event hash_version: ${eventRow.hash_version}`);
};

/**
 * Reads the current chain tip for an organization.
 *
 * MUST be called inside the same transaction that holds the organization's
 * advisory lock (`pg_advisory_xact_lock`). Without the lock, two writers can read
 * the same tip and fork the chain.
 *
 * Ordering is by `chain_seq`, never by `created_at`: `created_at` is the transaction
 * start time, so it can be inverted relative to the order in which hashes were chained
 * (P0-02). The extra columns are tiebreakers that only matter if the data is anomalous.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {string} organizationId
 * @returns {Promise<Object|undefined>} the tip row, or undefined for an empty chain
 */
const getChainTip = async (qb, organizationId) => qb('events')
  .where({ organization_id: organizationId })
  .orderBy('chain_seq', 'desc')
  .orderBy('created_at', 'desc')
  .orderBy('id', 'desc')
  .first();

/**
 * Computes the chain position for the next event.
 * @param {Object|undefined} tip - row returned by getChainTip
 * @returns {number} next chain_seq (1 for an empty chain)
 */
const nextChainSeq = (tip) => (tip ? Number(tip.chain_seq) + 1 : 1);

module.exports = {
  HASH_VERSION_LEGACY,
  HASH_VERSION_CANONICAL,
  CURRENT_HASH_VERSION,
  computeEventHash,
  getChainTip,
  nextChainSeq,
  normalizeJsonValue,
  buildCanonicalEventPayload,
  buildCanonicalEventPayloadForWrite,
  buildLegacyEventPayload,
  buildEventPayloadForVerification,
};
