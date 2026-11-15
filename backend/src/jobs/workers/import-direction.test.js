const {
  LINK_DIRECTION_BY_CTE,
  determineLinkDirection,
} = require('./import-direction');

describe('P0-10 import link direction mapping', () => {
  it('maps shipping to input even when the row carries an output direction', () => {
    expect(determineLinkDirection('shipping', { direction: 'output' })).toBe('input');
  });

  it('maps creation to output and receiving to input', () => {
    expect(determineLinkDirection('creation')).toBe('output');
    expect(determineLinkDirection('receiving')).toBe('input');
  });

  it('keeps the row-declared direction for transformation', () => {
    expect(determineLinkDirection('transformation', { direction: ' input ' })).toBe('input');
    expect(determineLinkDirection('transformation', { direction: 'OUTPUT' })).toBe('output');
  });

  it('rejects an invalid transformation direction', () => {
    expect(() => determineLinkDirection('transformation', { direction: 'sideways' })).toThrow(
      "Invalid direction 'sideways' for transformation row",
    );
  });

  it('rejects an unknown CTE type', () => {
    expect(() => determineLinkDirection('unknown')).toThrow("Unknown CTE type 'unknown'");
  });

  it('exposes the fixed mapping for every non-transformation CTE', () => {
    expect(LINK_DIRECTION_BY_CTE).toEqual({
      creation: 'output',
      receiving: 'input',
      shipping: 'input',
    });
  });
});
