const crypto = require('crypto');

/**
 * Canonical event hash payload version. Bump this whenever the canonical
 * serializer changes, update the verifier in the same change, and reset the
 * development database. There is no legacy-version support by design.
 */
const HASH_VERSION = 3;

/** `prev_hash` of the first event in an organization's chain. */
const GENESIS_HASH = 'GENESIS';

/**
 * Placeholder written on insert. The real hash can only be computed after the
 * row and its links are persisted, so writers insert this sentinel and call
 * `sealEventHash()` inside the same transaction.
 */
const PENDING_RECORD_HASH = 'PENDING';

/**
 * Placeholder for `hash_key_id` on insert. `sealEventHash()` and
 * `sealEventEvidence()` replace it with the current key ID from the env keyring.
 */
const PENDING_HASH_KEY_ID = 'PENDING';

const stableStringify = (obj) => {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const sortedKeys = Object.keys(obj).sort();
  return `{${sortedKeys.map(k => `"${k}":${stableStringify(obj[k])}`).join(',')}}`;
};

/**
 * Normalizes a persisted jsonb value to a JavaScript value. PostgreSQL returns
 * jsonb as an object through node-postgres, but a text fixture may still be a
 * JSON string.
 *
 * @param {*} value
 * @returns {*}
 */
const asJson = (value) => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

/** @param {*} value @returns {string|null} */
const toIso = (value) => (value === null || value === undefined
  ? null
  : new Date(value).toISOString());

/**
 * Loads the validated env module lazily so unit tests that only import this
 * module do not parse the environment before they set it.
 *
 * @returns {Object}
 */
const loadEnv = () => require('../config/env');

/**
 * Current key ID used for new seals.
 * @returns {string}
 */
const getCurrentHashKeyId = () => loadEnv().HASH_CHAIN_KEY_ID;

/**
 * Keyring for verification: current key plus rotation keys.
 * @returns {Object<string, string>}
 */
const getKeyRing = () => {
  const env = loadEnv();
  return {
    ...env.HASH_CHAIN_OLD_KEYS,
    [env.HASH_CHAIN_KEY_ID]: env.HASH_CHAIN_SECRET,
  };
};

/**
 * @param {string} keyId
 * @param {Object<string, string>} [keyRing]
 * @returns {string|null}
 */
const getHashKey = (keyId, keyRing = getKeyRing()) => keyRing[keyId] || null;

/**
 * @param {string} keyId
 * @param {Object<string, string>} [keyRing]
 * @returns {boolean}
 */
const hasHashKey = (keyId, keyRing = getKeyRing()) => Boolean(getHashKey(keyId, keyRing));

/**
 * HMAC-SHA256 over a versioned domain prefix, the previous chain hash, and the
 * canonical payload. The secret is never stored in the database.
 *
 * @param {string} domain
 * @param {string} prevHash
 * @param {Object} payload
 * @param {string} keyId
 * @param {Object<string, string>} keyRing
 * @returns {string}
 */
const computeHash = (domain, prevHash, payload, keyId, keyRing) => {
  const secret = getHashKey(keyId, keyRing);
  if (!secret) {
    const err = new Error(`Unsupported hash key id: ${keyId}`);
    err.code = 'unsupported_hash_key';
    throw err;
  }

  return crypto
    .createHmac('sha256', secret)
    .update(`${domain}|${prevHash}|${stableStringify(payload)}`)
    .digest('hex');
};

/**
 * Computes the HMAC for an event payload combined with the previous hash in the
 * chain.
 *
 * @param {Object} eventPayload - canonical payload from `buildEventHashPayload`
 * @param {string} prevHash - The hash of the previous event for this organization
 * @param {string} [keyId] - key ID stored on the event row
 * @param {Object<string, string>} [keyRing] - optional rotation keyring
 * @returns {string} - The new record_hash
 */
const computeEventHash = (
  eventPayload,
  prevHash,
  keyId = getCurrentHashKeyId(),
  keyRing = getKeyRing(),
) => computeHash('lottrace:event:v3', prevHash, eventPayload, keyId, keyRing);

/**
 * Computes the HMAC for an event-evidence payload. The evidence domain is
 * separate so an evidence hash can never be replayed as an event hash.
 *
 * @param {Object} evidencePayload
 * @param {string} prevHash
 * @param {string} [keyId]
 * @param {Object<string, string>} [keyRing]
 * @returns {string}
 */
const computeEventEvidenceHash = (
  evidencePayload,
  prevHash,
  keyId = getCurrentHashKeyId(),
  keyRing = getKeyRing(),
) => computeHash(
  'lottrace:event-evidence:v3',
  prevHash,
  evidencePayload,
  keyId,
  keyRing,
);

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
 * ISO-8601 UTC timestamps, numeric decimals as PostgreSQL text, links sorted
 * by lot id, and explicit nulls/empties for every optional field.
 *
 * Mutable lifecycle fields (`status`, `void_reason`) and later-added attachment
 * metadata are covered by the append-only `event_evidence` chain, not here.
 *
 * @param {Object} event - events row
 * @param {Array<Object>} [links] - event_lot_links rows for the event
 * @returns {Object} canonical payload
 */
const buildEventHashPayload = (event, links = []) => ({
  eventId: event.id,
  organizationId: event.organization_id,
  chainSeq: Number(event.chain_seq),
  eventType: event.event_type,
  locationId: event.location_id ?? null,
  counterpartyInfo: asJson(event.counterparty_info),
  eventDatetime: toIso(event.event_datetime),
  recordedBy: event.recorded_by,
  recordedAt: toIso(event.recorded_at),
  source: event.source,
  kdePayload: asJson(event.kde_payload) ?? {},
  complianceGaps: asJson(event.compliance_gaps),
  notes: event.notes ?? null,
  idempotencyKey: event.idempotency_key ?? null,
  supersedesEventId: event.supersedes_event_id ?? null,
  createdAt: toIso(event.created_at),
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
  const keyId = getCurrentHashKeyId();
  const payload = await loadEventHashPayload(qb, eventId);
  const recordHash = computeEventHash(payload, prevHash, keyId);

  const [sealed] = await qb('events')
    .where({ id: eventId, record_hash: PENDING_RECORD_HASH })
    .update({
      record_hash: recordHash,
      hash_version: HASH_VERSION,
      hash_key_id: keyId,
    })
    .returning('*');

  if (!sealed) {
    throw new Error(`Cannot seal hash: event ${eventId} is not pending`);
  }

  return sealed;
};

/**
 * Canonical payload for an append-only evidence row. Only persisted values are
 * hashed, including the evidence row's own timestamp and sequence.
 *
 * @param {Object} evidence - event_evidence row
 * @returns {Object}
 */
const buildEventEvidenceHashPayload = (evidence) => ({
  evidenceId: evidence.id,
  eventId: evidence.event_id,
  organizationId: evidence.organization_id,
  seq: Number(evidence.seq),
  kind: evidence.kind,
  payload: asJson(evidence.payload) ?? {},
  createdAt: toIso(evidence.created_at),
});

/**
 * Loads one evidence row and returns its canonical hash payload.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {string} evidenceId
 * @returns {Promise<Object>}
 */
const loadEventEvidenceHashPayload = async (qb, evidenceId) => {
  const evidence = await qb('event_evidence').where({ id: evidenceId }).first();
  if (!evidence) {
    throw new Error(`Cannot build evidence hash payload: evidence ${evidenceId} not found`);
  }

  return buildEventEvidenceHashPayload(evidence);
};

/**
 * Loads an event's evidence rows in chain order.
 *
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {string} eventId
 * @returns {Promise<Array<Object>>}
 */
const loadEventEvidence = async (qb, eventId) => qb('event_evidence')
  .where({ event_id: eventId })
  .orderBy('seq', 'asc');

/**
 * Seals an evidence hash after its row is persisted. Seal-once, same as
 * `sealEventHash`.
 *
 * @param {import('knex').Knex.Transaction} qb
 * @param {string} evidenceId
 * @param {string} prevHash
 * @returns {Promise<Object>}
 */
const sealEventEvidence = async (qb, evidenceId, prevHash) => {
  const keyId = getCurrentHashKeyId();
  const payload = await loadEventEvidenceHashPayload(qb, evidenceId);
  const recordHash = computeEventEvidenceHash(payload, prevHash, keyId);

  const [sealed] = await qb('event_evidence')
    .where({ id: evidenceId, record_hash: PENDING_RECORD_HASH })
    .update({
      record_hash: recordHash,
      hash_version: HASH_VERSION,
      hash_key_id: keyId,
    })
    .returning('*');

  if (!sealed) {
    throw new Error(`Cannot seal evidence hash: evidence ${evidenceId} is not pending`);
  }

  return sealed;
};

/**
 * Appends a signed evidence row for a mutable fact that happened after the
 * event was sealed: a status transition or an attachment addition. The chain is
 * rooted at the event's `record_hash`.
 *
 * The caller MUST hold a row lock on the event (`SELECT ... FOR UPDATE`) so two
 * transitions cannot compute the same sequence.
 *
 * @param {import('knex').Knex.Transaction} qb
 * @param {{ organizationId: string, eventId: string, kind: string, payload: Object }} data
 * @param {string} eventRecordHash
 * @returns {Promise<Object>} sealed evidence row
 */
const appendEventEvidence = async (qb, data, eventRecordHash) => {
  const latest = await qb('event_evidence')
    .where({ event_id: data.eventId })
    .orderBy('seq', 'desc')
    .first();

  const seq = latest ? Number(latest.seq) + 1 : 1;
  const prevHash = latest ? latest.record_hash : eventRecordHash;
  const evidenceId = crypto.randomUUID();

  await qb('event_evidence').insert({
    id: evidenceId,
    organization_id: data.organizationId,
    event_id: data.eventId,
    seq,
    kind: data.kind,
    payload: JSON.stringify(data.payload),
    prev_hash: prevHash,
    record_hash: PENDING_RECORD_HASH,
    hash_key_id: PENDING_HASH_KEY_ID,
    hash_version: HASH_VERSION,
  });

  return sealEventEvidence(qb, evidenceId, prevHash);
};

module.exports = {
  HASH_VERSION,
  GENESIS_HASH,
  PENDING_RECORD_HASH,
  PENDING_HASH_KEY_ID,
  stableStringify,
  getCurrentHashKeyId,
  getKeyRing,
  getHashKey,
  hasHashKey,
  computeEventHash,
  computeEventEvidenceHash,
  buildEventHashPayload,
  loadEventHashPayload,
  sealEventHash,
  buildEventEvidenceHashPayload,
  loadEventEvidenceHashPayload,
  loadEventEvidence,
  sealEventEvidence,
  appendEventEvidence,
  getChainTip,
  nextChainSeq,
};
