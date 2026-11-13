import assert from 'node:assert/strict';
import test from 'node:test';

import { fromDateTimeLocal, toDateTimeLocal } from './dateTimeLocal.js';

test('formats an instant using local date and time', () => {
  const expected = process.env.TZ === 'America/New_York'
    ? '2026-11-12T23:15'
    : '2026-11-13T10:00';
  assert.equal(toDateTimeLocal(new Date('2026-11-13T04:15:00.000Z')), expected);
});

test('parses datetime-local as local time', () => {
  const localValue = process.env.TZ === 'America/New_York' ? '2026-11-12T23:15' : '2026-11-13T10:00';
  assert.equal(fromDateTimeLocal(localValue).toISOString(), '2026-11-13T04:15:00.000Z');
});

test('round-trips an instant through datetime-local', () => {
  const instant = new Date('2026-11-13T04:15:00.000Z');
  assert.equal(fromDateTimeLocal(toDateTimeLocal(instant)).toISOString(), instant.toISOString());
});

test('handles a DST-observing timezone', () => {
  const instant = new Date('2026-07-01T16:30:00.000Z');
  const localValue = process.env.TZ === 'America/New_York' ? '2026-07-01T12:30' : toDateTimeLocal(instant);
  assert.equal(toDateTimeLocal(instant), localValue);
  assert.equal(fromDateTimeLocal(localValue).toISOString(), instant.toISOString());
});
