import assert from 'node:assert/strict';
import test from 'node:test';

import { parseJsonArray, parseJsonObject, parseMaybeJson } from './json.js';

test('parseMaybeJson returns an array unchanged', () => {
  const value = [{ field: 'harvest_date' }];
  assert.equal(parseMaybeJson(value), value);
});

test('parseMaybeJson returns an object unchanged', () => {
  const value = { supplier: 'Example Farm' };
  assert.equal(parseMaybeJson(value), value);
});

test('parseMaybeJson parses a JSON array string', () => {
  assert.deepEqual(parseMaybeJson('[{"field":"harvest_date"}]'), [{ field: 'harvest_date' }]);
});

test('parseMaybeJson parses a JSON object string', () => {
  assert.deepEqual(parseMaybeJson('{"supplier":"Example Farm"}'), { supplier: 'Example Farm' });
});

test('parseMaybeJson returns the fallback for null and undefined', () => {
  assert.deepEqual(parseMaybeJson(null, []), []);
  assert.deepEqual(parseMaybeJson(undefined, {}), {});
});

test('parseMaybeJson returns the fallback for malformed and empty strings', () => {
  assert.deepEqual(parseMaybeJson('{not json', []), []);
  assert.deepEqual(parseMaybeJson('', []), []);
});

test('parseJsonArray passes arrays through', () => {
  const value = [{ field: 'harvest_date', message: 'Harvest Date is required' }];
  assert.equal(parseJsonArray(value), value);
});

test('parseJsonArray parses a JSON array string', () => {
  assert.deepEqual(parseJsonArray('[{"field":"harvest_date"}]'), [{ field: 'harvest_date' }]);
});

test('parseJsonArray returns an empty array for non-array values', () => {
  assert.deepEqual(parseJsonArray({ field: 'harvest_date' }), []);
  assert.deepEqual(parseJsonArray(null), []);
  assert.deepEqual(parseJsonArray(undefined), []);
  assert.deepEqual(parseJsonArray('{not json'), []);
});

test('parseJsonObject passes plain objects through', () => {
  const value = { supplier: 'Example Farm' };
  assert.equal(parseJsonObject(value), value);
});

test('parseJsonObject parses a JSON object string', () => {
  assert.deepEqual(parseJsonObject('{"supplier":"Example Farm"}'), { supplier: 'Example Farm' });
});

test('parseJsonObject returns an empty object for non-object values', () => {
  assert.deepEqual(parseJsonObject([{ field: 'harvest_date' }]), {});
  assert.deepEqual(parseJsonObject(null), {});
  assert.deepEqual(parseJsonObject(undefined), {});
  assert.deepEqual(parseJsonObject('{not json'), {});
});

test('event compliance gap array from jsonb does not throw', () => {
  const gaps = [{ field: 'harvest_date', message: 'Harvest Date is required' }];
  assert.deepEqual(parseJsonArray(gaps), gaps);
});
