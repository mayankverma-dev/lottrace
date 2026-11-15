// Direction is fixed by CTE type except for transformation, where each CSV row
// declares whether the lot is consumed or produced.
//
// Shipping consumes the shipped lot. It has no produced output lot, so its
// links are always `input`, matching the manual event path (P0-10).
const LINK_DIRECTION_BY_CTE = Object.freeze({
  creation: 'output',
  receiving: 'input',
  shipping: 'input',
});

/**
 * Resolves the event_lot_links direction for one import row.
 *
 * @param {string} cteType
 * @param {{ direction?: string }} row
 * @returns {'input'|'output'}
 */
const determineLinkDirection = (cteType, row = {}) => {
  if (cteType === 'transformation') {
    const direction = (row.direction || '').trim().toLowerCase();
    if (direction !== 'input' && direction !== 'output') {
      throw new Error(`Invalid direction '${row.direction}' for transformation row`);
    }
    return direction;
  }

  const direction = LINK_DIRECTION_BY_CTE[cteType];
  if (!direction) {
    throw new Error(`Unknown CTE type '${cteType}'`);
  }
  return direction;
};

module.exports = {
  LINK_DIRECTION_BY_CTE,
  determineLinkDirection,
};
