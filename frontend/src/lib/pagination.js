/**
 * Converts a DataTable pagination event into the 1-based page number used by
 * list endpoints. DataTable emits the full pagination object, not a number.
 *
 * @param {{ page?: unknown }} [pagination]
 * @returns {number} 1-based page number
 */
export const toPageParam = (pagination) => {
  const page = Number(pagination?.page);
  return Number.isInteger(page) && page > 0 ? page : 1;
};
