const express = require('express');
const request = require('supertest');
const { parseTrustProxy } = require('../config/trustProxy');

const buildApp = (trust) => {
  const app = express();
  app.set('trust proxy', trust);
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  return app;
};

describe('trust proxy resolution', () => {
  it('ignores X-Forwarded-For when trust proxy is disabled', async () => {
    const response = await request(buildApp(parseTrustProxy('false')))
      .get('/')
      .set('X-Forwarded-For', '203.0.113.9');

    expect(response.body.ip).toMatch(/127\.0\.0\.1|::1/);
    expect(response.body.ip).not.toBe('203.0.113.9');
  });

  it('resolves the client address through one trusted hop', async () => {
    const response = await request(buildApp(parseTrustProxy('1')))
      .get('/')
      .set('X-Forwarded-For', '198.51.100.10');

    expect(response.body.ip).toBe('198.51.100.10');
  });

  it('uses the rightmost untrusted address for one trusted hop', async () => {
    const response = await request(buildApp(parseTrustProxy('1')))
      .get('/')
      .set('X-Forwarded-For', '1.2.3.4, 198.51.100.10');

    expect(response.body.ip).toBe('198.51.100.10');
  });

  it('resolves through two trusted hops', async () => {
    const response = await request(buildApp(parseTrustProxy('2')))
      .get('/')
      .set('X-Forwarded-For', '1.2.3.4, 198.51.100.10');

    expect(response.body.ip).toBe('1.2.3.4');
  });

  it('does not let an untrusted leftmost value spoof the client address', async () => {
    const app = buildApp(parseTrustProxy('1'));

    const first = await request(app).get('/').set('X-Forwarded-For', '1.2.3.4, 198.51.100.10');
    const second = await request(app).get('/').set('X-Forwarded-For', '5.6.7.8, 198.51.100.10');

    expect(first.body.ip).toBe('198.51.100.10');
    expect(second.body.ip).toBe('198.51.100.10');
  });

  it('walks trusted CIDR hops from the socket outward', async () => {
    const app = buildApp(parseTrustProxy('loopback, 10.0.0.0/8'));

    const response = await request(app)
      .get('/')
      .set('X-Forwarded-For', '203.0.113.9, 10.1.2.3');

    expect(response.body.ip).toBe('203.0.113.9');
  });
});
