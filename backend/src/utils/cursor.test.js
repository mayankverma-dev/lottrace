const { encodeCursor, decodeCursor } = require('./cursor');
const AppError = require('./AppError');

const expectInvalidCursor = (value) => {
  let error;
  try {
    decodeCursor(value);
  } catch (err) {
    error = err;
  }

  expect(error).toBeInstanceOf(AppError);
  expect(error.statusCode).toBe(422);
  expect(error.code).toBe('VALIDATION_ERROR');
  expect(error.details).toEqual([{ field: 'cursor', message: 'Invalid cursor' }]);
};

describe('cursor helpers', () => {
  it('round-trips the exact microsecond timestamp and bigint string', () => {
    const payload = { t: '2026-11-19T12:34:56.123456Z', s: '9007199254740993' };

    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('rejects values with characters outside the base64url alphabet', () => {
    expectInvalidCursor('not a cursor!');
    expectInvalidCursor('abc+def/');
  });

  it('rejects strings that are not JSON objects', () => {
    expectInvalidCursor(Buffer.from('not json').toString('base64url'));
    expectInvalidCursor(Buffer.from('[]').toString('base64url'));
    expectInvalidCursor(Buffer.from('null').toString('base64url'));
    expectInvalidCursor(Buffer.from('{}').toString('base64url'));
  });

  it('rejects non-canonical or impossible timestamps', () => {
    expectInvalidCursor(encodeCursor({ t: '2026-11-19T12:34:56Z', s: '1' }));
    expectInvalidCursor(encodeCursor({ t: '2026-02-30T00:00:00.000000Z', s: '1' }));
    expectInvalidCursor(encodeCursor({ t: '0000-01-01T00:00:00.000000Z', s: '1' }));
    expectInvalidCursor(encodeCursor({ t: '2026-11-19T25:00:00.000000Z', s: '1' }));
  });

  it('rejects chain positions outside the positive bigint range', () => {
    expectInvalidCursor(encodeCursor({ t: '2026-11-19T12:34:56.123456Z', s: 'abc' }));
    expectInvalidCursor(encodeCursor({ t: '2026-11-19T12:34:56.123456Z', s: '0' }));
    expectInvalidCursor(encodeCursor({ t: '2026-11-19T12:34:56.123456Z', s: '-1' }));
    expectInvalidCursor(encodeCursor({ t: '2026-11-19T12:34:56.123456Z', s: '9223372036854775808' }));
  });

  it('accepts the maximum signed bigint chain position', () => {
    const payload = { t: '2026-11-19T12:34:56.123456Z', s: '9223372036854775807' };

    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });
});
