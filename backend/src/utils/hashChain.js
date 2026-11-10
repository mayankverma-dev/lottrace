const crypto = require('crypto');

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

module.exports = { computeEventHash, getChainTip, nextChainSeq };
