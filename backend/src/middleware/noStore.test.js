const express = require('express');
const request = require('supertest');
const noStore = require('./noStore');

const buildApp = () => {
  const app = express();
  app.use('/api', noStore);
  app.get('/api/lots', (_req, res) => res.json({ success: true, data: [] }));
  app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
  return app;
};

describe('noStore middleware', () => {
  it('sets Cache-Control: no-store on API success responses', async () => {
    const res = await request(buildApp()).get('/api/lots');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets Cache-Control: no-store on API error responses', async () => {
    const res = await request(buildApp()).get('/api/missing');

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('does not set the API cache header on non-API routes', async () => {
    const res = await request(buildApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeUndefined();
  });
});
