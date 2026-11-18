import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildErrorReport,
  createErrorReporter,
  initErrorReporting,
} from './errorReporter.js';

const silentLogger = {
  error() {},
  warn() {},
};

test('buildErrorReport keeps the error name, message, stack, and context', () => {
  const error = new TypeError('bad payload');
  const report = buildErrorReport(error, {
    componentStack: '\n    at EventDetailPage',
    url: 'https://app.example.test/events/1',
  });

  assert.equal(report.name, 'TypeError');
  assert.equal(report.message, 'bad payload');
  assert.equal(report.stack, error.stack);
  assert.equal(report.componentStack, '\n    at EventDetailPage');
  assert.equal(report.url, 'https://app.example.test/events/1');
});

test('buildErrorReport normalizes non-Error values', () => {
  assert.deepEqual(
    buildErrorReport('boom', { url: '/lots' }),
    {
      name: 'string',
      message: 'boom',
      stack: null,
      componentStack: null,
      url: '/lots',
    },
  );

  assert.equal(buildErrorReport(undefined).message, 'Unknown error');
});

test('reporter captures the error with the normalized report as extra context', () => {
  const calls = [];
  const reporter = createErrorReporter({
    getClient: () => ({
      captureException: (...args) => calls.push(args),
    }),
    logger: silentLogger,
  });
  const error = new Error('render failed');

  const report = reporter.report(error, { componentStack: 'at LotPage' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], error);
  assert.deepEqual(calls[0][1], { extra: report });
  assert.equal(report.componentStack, 'at LotPage');
});

test('reporter swallows capture failures and logs a warning', () => {
  const warnings = [];
  const reporter = createErrorReporter({
    getClient: () => ({
      captureException: () => {
        throw new Error('sentry down');
      },
    }),
    logger: { error() {}, warn: (...args) => warnings.push(args) },
  });

  const report = reporter.report(new Error('render failed'));

  assert.equal(report.message, 'render failed');
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /sentry down/);
});

test('reporter works without a configured client', () => {
  const reporter = createErrorReporter({
    getClient: () => null,
    logger: silentLogger,
  });

  assert.equal(reporter.report(new Error('offline')).message, 'offline');
});

test('initErrorReporting does not load Sentry when no DSN is configured', async () => {
  let loaded = false;

  const client = await initErrorReporting({
    loader: async () => {
      loaded = true;
      return { init() {} };
    },
  });

  assert.equal(client, null);
  assert.equal(loaded, false);
});
