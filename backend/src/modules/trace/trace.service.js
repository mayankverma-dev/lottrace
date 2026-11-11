const db = require('../../db/knex');
const redis = require('../../config/redis');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');

const CACHE_TTL = 300; // 5 minutes
const MAX_HOPS = 50;

/**
 * Build Redis cache key for trace results.
 * @param {string} orgId
 * @param {string} lotId
 * @param {string} direction - forward | backward | full
 * @returns {string}
 */
const cacheKey = (orgId, lotId, direction) =>
  `trace:v2:${orgId}:${lotId}:${direction}`;

/**
 * Try to get cached trace result from Redis.
 * Returns null if no cache or Redis is down.
 */
const getCached = async (key) => {
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn({ err, key }, 'Redis cache read failed, proceeding without cache');
  }
  return null;
};

/**
 * Store trace result in Redis with TTL.
 */
const setCache = async (key, data) => {
  try {
    await redis.set(key, JSON.stringify(data), 'EX', CACHE_TTL);
  } catch (err) {
    logger.warn({ err, key }, 'Redis cache write failed');
  }
};

/**
 * Verify lot exists and belongs to org.
 */
const verifyLot = async (lotId, organizationId) => {
  const lot = await db('lots')
    .where({ id: lotId, organization_id: organizationId })
    .first();
  if (!lot) throw new AppError('Lot not found', 'NOT_FOUND', 404);
  return lot;
};

/**
 * Forward trace: where did this lot go?
 * Uses recursive CTE per ARCHITECTURE.md spec.
 * @param {string} lotId
 * @param {string} organizationId
 * @returns {Promise<Object>} { nodes, edges, hops, truncated, startLot }
 */
const forwardTrace = async (lotId, organizationId) => {
  const key = cacheKey(organizationId, lotId, 'forward');
  const cached = await getCached(key);
  if (cached) return { ...cached, cached: true };

  const startLot = await verifyLot(lotId, organizationId);

  const result = await db.raw(`
    WITH RECURSIVE forward_trace AS (
      -- Base: the starting lot
      SELECT
        l.id,
        l.traceability_lot_code,
        l.product_id,
        l.status AS lot_status,
        l.quantity,
        l.uom,
        0 AS hop,
        NULL::uuid AS via_event_id,
        NULL::text AS via_event_type,
        NULL::timestamptz AS via_event_datetime,
        NULL::uuid AS from_lot_id,
        NULL::uuid AS to_lot_id,
        ARRAY[l.id] AS path
      FROM lots l
      WHERE l.id = ? AND l.organization_id = ?

      UNION ALL

      -- Recursive: find output lots from events where this lot was an input
      SELECT
        l.id,
        l.traceability_lot_code,
        l.product_id,
        l.status AS lot_status,
        l.quantity,
        l.uom,
        ft.hop + 1,
        e.id AS via_event_id,
        e.event_type AS via_event_type,
        e.event_datetime AS via_event_datetime,
        ft.id AS from_lot_id,
        l.id AS to_lot_id,
        ft.path || l.id
      FROM forward_trace ft
      JOIN event_lot_links ell_in ON ell_in.lot_id = ft.id
        AND ell_in.direction = 'input'
      -- Only current events belong in the live trace graph. Amended and void
      -- events stay available through the event endpoints and audit log.
      JOIN events e ON e.id = ell_in.event_id
        AND e.status = 'active'
        AND e.organization_id = ?
      JOIN event_lot_links ell_out ON ell_out.event_id = e.id
        AND ell_out.direction = 'output'
      JOIN lots l ON l.id = ell_out.lot_id
      WHERE ft.hop < ? AND NOT (l.id = ANY(ft.path))
    )
    SELECT DISTINCT ON (id) * FROM forward_trace ORDER BY id, hop
  `, [lotId, organizationId, organizationId, MAX_HOPS]);

  const rows = result.rows || [];
  return buildTraceResult(rows, startLot, 'forward', key);
};

/**
 * Backward trace: where did this lot come from?
 * Mirror of forward — swap input/output directions.
 */
const backwardTrace = async (lotId, organizationId) => {
  const key = cacheKey(organizationId, lotId, 'backward');
  const cached = await getCached(key);
  if (cached) return { ...cached, cached: true };

  const startLot = await verifyLot(lotId, organizationId);

  const result = await db.raw(`
    WITH RECURSIVE backward_trace AS (
      -- Base: the starting lot
      SELECT
        l.id,
        l.traceability_lot_code,
        l.product_id,
        l.status AS lot_status,
        l.quantity,
        l.uom,
        0 AS hop,
        NULL::uuid AS via_event_id,
        NULL::text AS via_event_type,
        NULL::timestamptz AS via_event_datetime,
        NULL::uuid AS from_lot_id,
        NULL::uuid AS to_lot_id,
        ARRAY[l.id] AS path
      FROM lots l
      WHERE l.id = ? AND l.organization_id = ?

      UNION ALL

      -- Recursive: find input lots from events where this lot was an output
      SELECT
        l.id,
        l.traceability_lot_code,
        l.product_id,
        l.status AS lot_status,
        l.quantity,
        l.uom,
        bt.hop - 1,
        e.id AS via_event_id,
        e.event_type AS via_event_type,
        e.event_datetime AS via_event_datetime,
        l.id AS from_lot_id,
        bt.id AS to_lot_id,
        bt.path || l.id
      FROM backward_trace bt
      JOIN event_lot_links ell_out ON ell_out.lot_id = bt.id
        AND ell_out.direction = 'output'
      -- Only current events belong in the live trace graph. Amended and void
      -- events stay available through the event endpoints and audit log.
      JOIN events e ON e.id = ell_out.event_id
        AND e.status = 'active'
        AND e.organization_id = ?
      JOIN event_lot_links ell_in ON ell_in.event_id = e.id
        AND ell_in.direction = 'input'
      JOIN lots l ON l.id = ell_in.lot_id
      WHERE bt.hop > ? AND NOT (l.id = ANY(bt.path))
    )
    SELECT DISTINCT ON (id) * FROM backward_trace ORDER BY id, hop
  `, [lotId, organizationId, organizationId, -MAX_HOPS]);

  const rows = result.rows || [];
  return buildTraceResult(rows, startLot, 'backward', key);
};

/**
 * Full trace: combine forward + backward, deduplicate nodes.
 */
const fullTrace = async (lotId, organizationId) => {
  const key = cacheKey(organizationId, lotId, 'full');
  const cached = await getCached(key);
  if (cached) return { ...cached, cached: true };

  const [fwd, bwd] = await Promise.all([
    forwardTrace(lotId, organizationId),
    backwardTrace(lotId, organizationId),
  ]);

  // Deduplicate nodes by lot id
  const nodeMap = new Map();
  [...(bwd.nodes || []), ...(fwd.nodes || [])].forEach((node) => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, node);
    }
  });

  // Deduplicate edges by composite key
  const edgeSet = new Set();
  const edges = [];
  [...(bwd.edges || []), ...(fwd.edges || [])].forEach((edge) => {
    const ek = `${edge.from}:${edge.to}:${edge.eventId}`;
    if (!edgeSet.has(ek)) {
      edgeSet.add(ek);
      edges.push(edge);
    }
  });

  const fullResult = {
    nodes: Array.from(nodeMap.values()),
    edges,
    hops: Math.max(fwd.hops, bwd.hops),
    truncated: fwd.truncated || bwd.truncated,
    startLot: fwd.startLot,
    direction: 'full',
  };

  await setCache(key, fullResult);
  return fullResult;
};

/**
 * Build trace result from raw CTE rows.
 * Produces nodes (lots) and edges (event connections).
 */
const buildTraceResult = async (rows, startLot, direction, cacheKeyStr) => {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  let maxHop = 0;

  // Enrich with product names
  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
  let productMap = {};
  if (productIds.length > 0) {
    const products = await db('products').whereIn('id', productIds).select('id', 'name', 'sku');
    productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  }

  rows.forEach((row) => {
    if (!seenNodes.has(row.id)) {
      seenNodes.add(row.id);
      const product = productMap[row.product_id] || {};
      nodes.push({
        id: row.id,
        traceabilityLotCode: row.traceability_lot_code,
        productId: row.product_id,
        productName: product.name || null,
        productSku: product.sku || null,
        status: row.lot_status,
        quantity: row.quantity,
        uom: row.uom,
        hop: row.hop,
        isStart: row.id === startLot.id,
      });
    }

    if (row.via_event_id) {
      edges.push({
        from: row.from_lot_id,
        to: row.to_lot_id,
        eventId: row.via_event_id,
        eventType: row.via_event_type,
        eventDatetime: row.via_event_datetime,
      });
    }

    const absHop = Math.abs(row.hop);
    if (absHop > maxHop) maxHop = absHop;
  });

  const truncated = maxHop >= MAX_HOPS;

  const result = {
    nodes,
    edges,
    hops: maxHop,
    truncated,
    startLot: {
      id: startLot.id,
      traceabilityLotCode: startLot.traceability_lot_code,
    },
    direction,
  };

  await setCache(cacheKeyStr, result);
  return result;
};

/**
 * Invalidate trace cache for a lot (call when new events created).
 * Clears forward, backward, and full cache for the lot.
 * @param {string} organizationId
 * @param {string} lotId
 */
const invalidateTraceCache = async (organizationId, lotId) => {
  try {
    await Promise.all([
      redis.del(cacheKey(organizationId, lotId, 'forward')),
      redis.del(cacheKey(organizationId, lotId, 'backward')),
      redis.del(cacheKey(organizationId, lotId, 'full')),
    ]);
  } catch (err) {
    logger.warn({ err, lotId }, 'Failed to invalidate trace cache');
  }
};

module.exports = {
  forwardTrace,
  backwardTrace,
  fullTrace,
  invalidateTraceCache,
};
