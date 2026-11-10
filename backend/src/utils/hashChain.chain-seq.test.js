const { getChainTip, nextChainSeq } = require('./hashChain');

const makeQueryBuilder = () => {
  const calls = [];
  const builder = {
    where: jest.fn(() => builder),
    select: jest.fn(() => builder),
    orderBy: jest.fn((column, direction) => {
      calls.push([column, direction]);
      return builder;
    }),
    first: jest.fn(async () => ({ id: 'event-1', chain_seq: '3', record_hash: 'hash-3' })),
  };
  const qb = jest.fn(() => builder);
  qb.builder = builder;
  qb.calls = calls;
  return qb;
};

describe('hashChain chain ordering helpers', () => {
  it('starts an empty chain at 1', () => {
    expect(nextChainSeq(undefined)).toBe(1);
    expect(nextChainSeq(null)).toBe(1);
  });

  it('increments a numeric chain_seq', () => {
    expect(nextChainSeq({ chain_seq: 7 })).toBe(8);
  });

  it('increments the string returned for a PostgreSQL bigint', () => {
    expect(nextChainSeq({ chain_seq: '7' })).toBe(8);
  });

  it('reads the tip ordered by chain_seq descending', async () => {
    const qb = makeQueryBuilder();

    const tip = await getChainTip(qb, 'org-1');

    expect(qb).toHaveBeenCalledWith('events');
    expect(qb.builder.where).toHaveBeenCalledWith({ organization_id: 'org-1' });
    expect(qb.calls).toEqual([['chain_seq', 'desc']]);
    expect(tip).toEqual({ id: 'event-1', chain_seq: '3', record_hash: 'hash-3' });
  });
});
