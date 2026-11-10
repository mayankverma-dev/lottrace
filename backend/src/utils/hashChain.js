const crypto = require('crypto');

/**
 * Canonical event hash payload version. Bump this whenever the canonical
 * serializer changes, update the verifier in the same change, and reset the
 * development database. There is no legacy-version support by design.
 */
const HASH_VERSION = 2;

/** `prev_hash` of the first event in an organization's chain. */
const GENESIS_HASH = 'GENESIS';

/**
 * Placeholder written on insert. The real hash can only be computed after the
 * row and its links are persisted, so writers insert this sentinel and call
 * `sealEventHash()` inside the same transaction.
 */
const PENDING_RECORD_HASH = 'PENDING';

const stableStringify = (obj) => {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const sortedKeys = Object.keys(obj).sort();
  return `{${sortedKeys.map(k => `"${k}":${stableStringify(obj[k])}`).join(',')}}`;
};

/**
 * Computes a SHA-256 hash for an event payload combined with the previous hash in the chain.
 * @param {Object} eventPayload - canonical payload from `buildEventHashPayload`
 * @param {string} prevHash - The hash of the previous event for this organization
 * @returns {string} - The new record_hash
 */
const computeEventHash = (eventPayload, prevHash) => {
  const payloadString = stableStringify(eventPayload);
  const dataToHash = `${prevHash}|${payloadString}`;

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
};

/**
 * Reads the current chain tip for an organization.
 *
 * MUST be called inside the transaction that holds the organization's advisory
 * lock (`pg_advisory_xact_lock`). Without the lock, two writers can read the
 * same tip and fork the chain.
 *
 * Ordering is by `chain_seq`, never by `created_at`. `created_at` defaults to
 * the transaction start time and can be tied or inverted under concurrency.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {string} organizationId
 * @returns {Promise<Object|undefined>} tip row, or undefined for an empty chain
 */
const getChainTip = async (qb, organizationId) => qb('events')
  .where({ organization_id: organizationId })
  .select('id', 'chain_seq', 'record_hash')
  .orderBy('chain_seq', 'desc')
  .first();

/**
 * Computes the chain position for the next event.
 * @param {Object|undefined} tip - row returned by getChainTip
 * @returns {number} next chain_seq (1 for an empty chain)
 */
const nextChainSeq = (tip) => (tip ? Number(tip.chain_seq) + 1 : 1);

const toLinkPayload = (link) => ({
  lotId: link.lot_id,
  // numeric(15,4) arrives from PostgreSQL as text ("1.0000"). Hash that text
  // exactly; never re-format it in JavaScript (P0-01).
  quantity: link.quantity ?? null,
  uom: link.uom ?? null,
});

const compareLotIds = (a, b) => {
  if (a.lotId === b.lotId) return 0;
  return a.lotId < b.lotId ? -1 : 1;
};

const linksFor = (links, direction) => links
  .filter((link) => link.direction === direction)
  .map(toLinkPayload)
  .sort(compareLotIds);

/**
 * Builds the canonical hash payload from PERSISTED rows only. The write path
 * (after insert) and the verifier both call this, so both hash the same values:
 * ISO-8601 UTC datetime, numeric decimals as PostgreSQL text, links sorted by
 * lot id, and explicit nulls/empties for every optional field.
 *
 * Not hashed here (tracked by P1-18): notes, recorded_by, recorded_at,
 * organization_id, id, chain_seq, status.
 *
 * @param {Object} event - events row
 * @param {Array<Object>} [links] - event_lot_links rows for the event
 * @returns {Object} canonical payload
 */
const buildEventHashPayload = (event, links = []) => ({
  eventType: event.event_type,
  locationId: event.location_id ?? null,
  eventDatetime: new Date(event.event_datetime).toISOString(),
  source: event.source,
  kdePayload: event.kde_payload ?? {},
  counterpartyInfo: event.counterparty_info ?? null,
  inputs: linksFor(links, 'input'),
  outputs: linksFor(links, 'output'),
});

/**
 * Loads an event and its links and returns the canonical hash payload.
 * Single serializer for the write, import, and verification paths.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {string} eventId
 * @returns {Promise<Object>} canonical payload
 */
const loadEventHashPayload = async (qb, eventId) => {
  const event = await qb('events').where({ id: eventId }).first();
  if (!event) {
    throw new Error(`Cannot build hash payload: event ${eventId} not found`);
  }

  const links = await qb('event_lot_links')
    .where({ event_id: eventId })
    .select('lot_id', 'direction', 'quantity', 'uom');

  return buildEventHashPayload(event, links);
};

/**
 * Seals an event's hash after its row and links are persisted.
 *
 * Must run inside the writer's transaction, after the event and link inserts.
 * The conditional update guarantees a hash can only be sealed once.
 *
 * @param {import('knex').Knex.Transaction} qb
 * @param {string} eventId
 * @param {string} prevHash
 * @returns {Promise<Object>} the sealed event row
 */
const sealEventHash = async (qb, eventId, prevHash) => {
  const payload = await loadEventHashPayload(qb, eventId);
  const recordHash = computeEventHash(payload, prevHash);

  const [sealed] = await qb('events')
    .where({ id: eventId, record_hash: PENDING_RECORD_HASH })
    .update({ record_hash: recordHash, hash_version: HASH_VERSION })
    .returning('*');

  if (!sealed) {
    throw new Error(`Cannot seal hash: event ${eventId} is not pending`);
  }

  return sealed;
};

module.exports = {
  HASH_VERSION,
  GENESIS_HASH,
  PENDING_RECORD_HASH,
  computeEventHash,
  buildEventHashPayload,
  loadEventHashPayload,
  sealEventHash,
  getChainTip,
  nextChainSeq,
};
