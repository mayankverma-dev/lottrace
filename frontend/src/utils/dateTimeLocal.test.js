import assert from 'node:assert/strict';
import test from 'node:test';

import { fromDateTimeLocal, toDateTimeLocal } from './dateTimeLocal.js';

// `dateTimeLocal` works in the process time zone, so the test pins one. Node
// reads `process.env.TZ` at Date-call time, which keeps the suite independent
// of the machine that runs it. The DST test switches zones for its own scope.
const DEFAULT_TZ = 'Asia/Kathmandu';
process.env.TZ = DEFAULT_TZ;

test('formats an instant using local date and time', () => {
  assert.equal(toDateTimeLocal(new Date('2026-11-13T04:15:00.000Z')), '2026-11-13T10:00');
});

test('parses datetime-local as local time', () => {
  assert.equal(fromDateTimeLocal('2026-11-13T10:00').toISOString(), '2026-11-13T04:15:00.000Z');
});

test('round-trips an instant through datetime-local', () => {
  const instant = new Date('2026-11-13T04:15:00.000Z');
  assert.equal(fromDateTimeLocal(toDateTimeLocal(instant)).toISOString(), instant.toISOString());
});

test('handles a DST-observing timezone', () => {
  process.env.TZ = 'America/New_York';
  try {
    const instant = new Date('2026-07-01T16:30:00.000Z');
    assert.equal(toDateTimeLocal(instant), '2026-07-01T12:30');
    assert.equal(fromDateTimeLocal('2026-07-01T12:30').toISOString(), instant.toISOString());
  } finally {
    process.env.TZ = DEFAULT_TZ;
  }
});
