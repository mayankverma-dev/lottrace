/**
 * P1-05 regression tests — compliance-gap pagination uses the standard
 * top-level pagination response field.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/authenticate', () => (req, res, next) => {
  req.user = {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
    role: req.get('x-test-role') || 'auditor',
  };
  next();
});

jest.mock('../../middleware/rateLimiter', () => ({
  exportLimiter: (req, res, next) => next(),
}));

jest.mock('../../jobs/queues', () => ({
  exportQueue: { add: jest.fn() },
}));

jest.mock('./reports.service');

const reportsRoutes = require('./reports.routes');
const reportsService = require('./reports.service');
const errorHandler = require('../../middleware/errorHandler');

const buildApp = () => {
  const app = express();
  app.use('/api/v1/reports', reportsRoutes);
  app.use(errorHandler);
  return app;
};

describe('P1-05 compliance-gap pagination contract', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    reportsService.getComplianceGaps.mockResolvedValue({
      data: [],
      pagination: {
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
        hasNextPage: false,
        hasPrevPage: true,
      },
    });
  });

  it('returns pagination at the top level and passes validated page values', async () => {
    const response = await request(app)
      .get('/api/v1/reports/compliance-gaps?page=2&limit=20')
      .set('x-test-role', 'auditor');

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      total: 21,
      page: 2,
      limit: 20,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
    expect(response.body.meta).toBeUndefined();
    expect(reportsService.getComplianceGaps).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      { page: 2, limit: 20 },
    );
  });

  it('uses documented pagination defaults', async () => {
    const response = await request(app)
      .get('/api/v1/reports/compliance-gaps')
      .set('x-test-role', 'auditor');

    expect(response.status).toBe(200);
    expect(reportsService.getComplianceGaps).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      { page: 1, limit: 50 },
    );
  });

  it('rejects malformed page values before service execution', async () => {
    reportsService.getComplianceGaps.mockClear();

    const response = await request(app)
      .get('/api/v1/reports/compliance-gaps?page=abc')
      .set('x-test-role', 'auditor');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(reportsService.getComplianceGaps).not.toHaveBeenCalled();
  });
});
