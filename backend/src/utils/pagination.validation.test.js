const { paginationSchema } = require('./pagination');

describe('shared pagination validation', () => {
  it('applies the documented defaults', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('accepts the documented maximum limit', () => {
    expect(paginationSchema.parse({ page: '1', limit: '100' })).toEqual({ page: 1, limit: 100 });
  });

  it.each([
    ['non-numeric page', { page: 'abc' }, 'page'],
    ['zero page', { page: '0' }, 'page'],
    ['negative page', { page: '-1' }, 'page'],
    ['zero limit', { limit: '0' }, 'limit'],
    ['negative limit', { limit: '-1' }, 'limit'],
    ['limit above max', { limit: '101' }, 'limit'],
    ['huge limit', { limit: '1000000' }, 'limit'],
    ['fractional limit', { limit: '1.5' }, 'limit'],
    ['infinite limit', { limit: 'Infinity' }, 'limit'],
  ])('rejects %s', (_name, input, field) => {
    const result = paginationSchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual([field]);
  });
});
