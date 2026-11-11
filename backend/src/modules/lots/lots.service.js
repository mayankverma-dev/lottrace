const db = require('../../db/knex');
const { v4: uuid } = require('uuid');
const AppError = require('../../utils/AppError');
const { paginate } = require('../../utils/pagination');
const { writeAuditLog } = require('../../utils/auditTrail');

/**
 * Snapshot used in lot audit before/after states.
 * @param {Object} lot - persisted lots row
 * @returns {Object}
 */
const toAuditState = (lot) => ({
  id: lot.id,
  organizationId: lot.organization_id,
  productId: lot.product_id,
  traceabilityLotCode: lot.traceability_lot_code,
  quantity: lot.quantity,
  uom: lot.uom,
  notes: lot.notes,
  status: lot.status,
  voidReason: lot.void_reason,
  version: lot.version,
});

/**
 * Create a new lot.
 * @param {Object} data - Validated lot data
 * @param {string} organizationId
 * @param {string} userId
 * @param {{ ipAddress?: string }} [auditContext]
 * @returns {Promise<Object>}
 */
const createLot = async (data, organizationId, userId, auditContext = {}) => db.transaction(async (trx) => {
  const [lot] = await trx('lots')
    .insert({
      id: uuid(),
      organization_id: organizationId,
      product_id: data.productId,
      traceability_lot_code: data.traceabilityLotCode,
      quantity: data.quantity,
      uom: data.uom,
      notes: data.notes || null,
      created_by: userId,
    })
    .returning('*');

  await writeAuditLog({
    organizationId,
    actorId: userId,
    actorType: 'user',
    action: 'lot.create',
    entityType: 'lot',
    entityId: lot.id,
    afterState: toAuditState(lot),
    ipAddress: auditContext.ipAddress || null,
  }, trx);

  return {
    id: lot.id,
    organizationId: lot.organization_id,
    productId: lot.product_id,
    traceabilityLotCode: lot.traceability_lot_code,
    quantity: lot.quantity,
    uom: lot.uom,
    notes: lot.notes,
    status: lot.status,
    createdAt: lot.created_at,
    updatedAt: lot.updated_at,
    version: lot.version
  };
});

/**
 * List lots with pagination and filters.
 * @param {Object} params
 * @param {string} organizationId
 * @returns {Promise<{ data: Array, pagination: Object }>}
 */
const listLots = async (params, organizationId) => {
  const { page, limit, productId, status, search, sort, order, traceabilityLotCode } = params;

  const sortColumnMap = {
    traceabilityLotCode: 'lots.traceability_lot_code',
    createdAt: 'lots.created_at',
    quantity: 'lots.quantity',
    status: 'lots.status',
  };

  let query = db('lots')
    .join('products', 'lots.product_id', 'products.id')
    .where('lots.organization_id', organizationId)
    .select(
      'lots.id',
      'lots.organization_id as organizationId',
      'lots.product_id as productId',
      'lots.traceability_lot_code as traceabilityLotCode',
      'lots.quantity',
      'lots.uom',
      'lots.notes',
      'lots.status',
      'lots.created_at as createdAt',
      'lots.updated_at as updatedAt',
      'lots.version',
      'products.name as productName',
      'products.sku as productSku'
    )
    .orderBy(sortColumnMap[sort] || 'lots.created_at', order || 'desc');

  if (productId) {
    query = query.where('lots.product_id', productId);
  }
  if (status) {
    query = query.where('lots.status', status);
  }
  if (traceabilityLotCode) {
    query = query.where('lots.traceability_lot_code', traceabilityLotCode);
  }
  if (search) {
    query = query.where(function () {
      this.whereILike('lots.traceability_lot_code', `%${search}%`)
        .orWhereILike('products.name', `%${search}%`);
    });
  }

  return paginate(query, { page, limit });
};

/**
 * Get a single lot by ID.
 * @param {string} lotId
 * @param {string} organizationId
 * @returns {Promise<Object>}
 */
const getLot = async (lotId, organizationId) => {
  const lot = await db('lots')
    .join('products', 'lots.product_id', 'products.id')
    .where({ 'lots.id': lotId, 'lots.organization_id': organizationId })
    .select(
      'lots.id',
      'lots.organization_id as organizationId',
      'lots.product_id as productId',
      'lots.traceability_lot_code as traceabilityLotCode',
      'lots.quantity',
      'lots.uom',
      'lots.notes',
      'lots.status',
      'lots.void_reason as voidReason',
      'lots.created_at as createdAt',
      'lots.updated_at as updatedAt',
      'lots.version',
      'products.name as productName',
      'products.sku as productSku',
      'products.default_uom as productDefaultUom'
    )
    .first();

  if (!lot) {
    throw new AppError('Lot not found', 'NOT_FOUND', 404);
  }

  return lot;
};

/**
 * Update a lot.
 * @param {string} lotId
 * @param {Object} data
 * @param {string} organizationId
 * @param {string} userId
 * @param {{ ipAddress?: string }} [auditContext]
 * @returns {Promise<Object>}
 */
const updateLot = async (lotId, data, organizationId, userId, auditContext = {}) => db.transaction(async (trx) => {
  // Check if lot is voided
  const current = await trx('lots').where({ id: lotId, organization_id: organizationId }).first();
  if (!current) throw new AppError('Lot not found', 'NOT_FOUND', 404);
  if (current.status === 'void') throw new AppError('Cannot update a voided lot', 'LOT_VOIDED', 400);
  if (current.status === 'recalled') throw new AppError('Cannot update a recalled lot', 'LOT_RECALLED', 400);

  const updateData = {};
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.quantity !== undefined) updateData.quantity = data.quantity;

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No fields to update', 'VALIDATION_ERROR', 422);
  }

  updateData.updated_at = trx.fn.now();
  updateData.version = current.version + 1; // optimistic concurrency

  const [updated] = await trx('lots')
    .where({ id: lotId, organization_id: organizationId })
    .update(updateData)
    .returning('*');

  await writeAuditLog({
    organizationId,
    actorId: userId,
    actorType: 'user',
    action: 'lot.update',
    entityType: 'lot',
    entityId: updated.id,
    beforeState: toAuditState(current),
    afterState: toAuditState(updated),
    ipAddress: auditContext.ipAddress || null,
  }, trx);

  return {
    id: updated.id,
    organizationId: updated.organization_id,
    productId: updated.product_id,
    traceabilityLotCode: updated.traceability_lot_code,
    quantity: updated.quantity,
    uom: updated.uom,
    notes: updated.notes,
    status: updated.status,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
    version: updated.version
  };
});

/**
 * Void a lot.
 * @param {string} lotId
 * @param {string} voidReason
 * @param {string} organizationId
 * @param {string} userId
 * @param {{ ipAddress?: string }} [auditContext]
 * @returns {Promise<Object>}
 */
const voidLot = async (lotId, voidReason, organizationId, userId, auditContext = {}) => db.transaction(async (trx) => {
  const current = await trx('lots').where({ id: lotId, organization_id: organizationId }).first();
  if (!current) throw new AppError('Lot not found', 'NOT_FOUND', 404);
  if (current.status === 'void') throw new AppError('Lot is already voided', 'LOT_VOIDED', 400);

  const [voided] = await trx('lots')
    .where({ id: lotId, organization_id: organizationId })
    .update({
      status: 'void',
      void_reason: voidReason,
      updated_at: trx.fn.now(),
      version: current.version + 1,
    })
    .returning('*');

  await writeAuditLog({
    organizationId,
    actorId: userId,
    actorType: 'user',
    action: 'lot.void',
    entityType: 'lot',
    entityId: voided.id,
    beforeState: toAuditState(current),
    afterState: toAuditState(voided),
    metadata: { reason: voidReason },
    ipAddress: auditContext.ipAddress || null,
  }, trx);

  return {
    id: voided.id,
    organizationId: voided.organization_id,
    productId: voided.product_id,
    traceabilityLotCode: voided.traceability_lot_code,
    quantity: voided.quantity,
    uom: voided.uom,
    notes: voided.notes,
    status: voided.status,
    voidReason: voided.void_reason,
    createdAt: voided.created_at,
    updatedAt: voided.updated_at,
    version: voided.version
  };
});

module.exports = {
  createLot,
  listLots,
  getLot,
  updateLot,
  voidLot,
};
