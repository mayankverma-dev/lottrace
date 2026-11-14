/**
 * P2-02 unit tests — one pagination metadata shape for every list endpoint.
 */

const { buildPagination, paginate } = require('./pagination');

const PAGINATION_KEYS = [
  'hasNextPage',
  'hasPrevPage',
  'limit',
  'page',
  'total',
  'totalPages',
];

const makeQuery = ({ total, rows = [] }) => {
  const builder = {
    clone: () => builder,
    clearSelect: () => builder,
    clearOrder: () => builder,
    count: () => builder,
    first: async () => ({ total }),
    limit: jest.fn(() => builder),
    offset: jest.fn(() => Promise.resolve(rows)),
  };

  return builder;
};

describe('P2-02 buildPagination', () => {
  it('returns exactly the documented six fields', () => {
    const pagination = buildPagination(21, 1, 20);

    expect(Object.keys(pagination).sort()).toEqual(PAGINATION_KEYS);
  });

  it('reports an empty result as zero pages', () => {
    expect(buildPagination(0, 1, 20)).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it('reports a first page with more rows', () => {
    expect(buildPagination(21, 1, 20)).toEqual({
      total: 21,
      page: 1,
      limit: 20,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('reports a last page after the first', () => {
    expect(buildPagination(21, 2, 20)).toEqual({
      total: 21,
      page: 2,
      limit: 20,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
  });

  it('reports no next page when total divides evenly', () => {
    const pagination = buildPagination(100, 1, 100);

    expect(pagination.totalPages).toBe(1);
    expect(pagination.hasNextPage).toBe(false);
  });

  it('returns numeric fields', () => {
    const pagination = buildPagination(5, 2, 2);

    expect(typeof pagination.total).toBe('number');
    expect(typeof pagination.page).toBe('number');
    expect(typeof pagination.limit).toBe('number');
    expect(typeof pagination.totalPages).toBe('number');
    expect(typeof pagination.hasNextPage).toBe('boolean');
    expect(typeof pagination.hasPrevPage).toBe('boolean');
  });
});

describe('P2-02 paginate', () => {
  it('uses the shared shape and clamps unsafe inputs', async () => {
    const query = makeQuery({ total: 5, rows: [{ id: 1 }] });

    const result = await paginate(query, { page: 0, limit: 1000 });

    expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.offset).toHaveBeenCalledWith(0);
    expect(result.pagination).toEqual({
      total: 5,
      page: 1,
      limit: 100,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });
    expect(result.data).toEqual([{ id: 1 }]);
  });

  it('keeps the shared shape for a later page', async () => {
    const query = makeQuery({ total: 21, rows: [{ id: 21 }] });

    const result = await paginate(query, { page: 2, limit: 20 });

    expect(result.pagination).toEqual({
      total: 21,
      page: 2,
      limit: 20,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
  });
});
