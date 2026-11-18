import { parseGS1 } from '../utils/gs1Parser.js';

/** Event types the PWA records. Creation and transformation stay in the web app. */
export const PWA_EVENT_TYPES = ['receiving', 'shipping'];

/**
 * Resolves the lot code from a raw barcode. GS1-AI 10 wins; anything else is
 * treated as the raw lot code.
 *
 * @param {string} rawCode
 * @returns {string}
 */
export const resolveScannedLotCode = (rawCode) => {
  if (typeof rawCode !== 'string') return '';

  const trimmed = rawCode.trim();
  if (!trimmed) return '';

  const parsed = parseGS1(trimmed);
  return (parsed.lotCode || parsed.raw || '').trim();
};

/**
 * Converts a form value to a positive number.
 *
 * @param {unknown} value
 * @returns {number|null} null when the value is empty, not finite, or not positive
 */
export const toPositiveQuantity = (value) => {
  if (value === '' || value === null || value === undefined) return null;

  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
};

/**
 * Builds the body for `POST /api/v1/lots`.
 *
 * @param {{ productId: string, traceabilityLotCode: string, quantity: unknown, uom: string, notes?: string }} input
 * @returns {{ productId: string, traceabilityLotCode: string, quantity: number, uom: string, notes?: string }}
 */
export const buildLotPayload = ({ productId, traceabilityLotCode, quantity, uom, notes }) => {
  const lotCode = typeof traceabilityLotCode === 'string' ? traceabilityLotCode.trim() : '';
  if (!productId) throw new Error('Select a product');
  if (!lotCode) throw new Error('Lot code is required');

  const parsedQuantity = toPositiveQuantity(quantity);
  if (parsedQuantity === null) throw new Error('Quantity must be a positive number');

  const parsedUom = typeof uom === 'string' ? uom.trim() : '';
  if (!parsedUom) throw new Error('Unit of measure is required');

  const payload = {
    productId,
    traceabilityLotCode: lotCode,
    quantity: parsedQuantity,
    uom: parsedUom,
  };

  const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
  if (trimmedNotes) payload.notes = trimmedNotes;

  return payload;
};

/**
 * Builds the body for `POST /api/v1/events` for a receiving or shipping event.
 * Every item becomes an input link; these event types produce no output lot.
 *
 * @param {{
 *   eventType: string,
 *   locationId: string,
 *   eventDatetime: string,
 *   notes?: string,
 *   source: 'scan'|'manual',
 *   items: Array<{ lotId: string, quantity: unknown, uom: string }>,
 * }} input
 * @returns {Object}
 */
export const buildEventPayload = ({
  eventType,
  locationId,
  eventDatetime,
  notes,
  source,
  items,
}) => {
  if (!PWA_EVENT_TYPES.includes(eventType)) {
    throw new Error('Event type must be receiving or shipping');
  }
  if (!locationId) throw new Error('Select a location');
  if (!['scan', 'manual'].includes(source)) throw new Error('Invalid event source');
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one lot is required');
  }

  const inputs = items.map((item) => {
    if (!item?.lotId) throw new Error('Lot is required');

    const quantity = toPositiveQuantity(item.quantity);
    if (quantity === null) throw new Error('Quantity must be a positive number');
    if (!item.uom) throw new Error('Unit of measure is required');

    return {
      lotId: item.lotId,
      quantity,
      uom: item.uom,
    };
  });

  const payload = {
    eventType,
    locationId,
    eventDatetime,
    source,
    kdePayload: {},
    inputs,
    outputs: [],
  };

  const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
  if (trimmedNotes) payload.notes = trimmedNotes;

  return payload;
};
