const express = require('express');
const request = require('supertest');

jest.mock('./notifications.service', () => ({
  getNotifications: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const notificationsService = require('./notifications.service');
const notificationsController = require('./notifications.controller');
const errorHandler = require('../../middleware/errorHandler');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Mounts the controller behind the same error handler the API uses, without
 * the auth/tenant middleware (their values are set directly on the request).
 * @returns {import('express').Express}
 */
const buildApp = () => {
  const app = express();

  app.patch('/notifications/:id/read', async (req, res, next) => {
    req.validatedParams = { id: req.params.id };
    req.organizationId = ORG_ID;
    req.user = { id: USER_ID };

    try {
      await notificationsController.markAsRead(req, res);
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);
  return app;
};

describe('notificationsController.markAsRead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 NOT_FOUND when the notification does not exist or is foreign', async () => {
    notificationsService.markAsRead.mockResolvedValue(undefined);

    const res = await request(buildApp()).patch(`/notifications/${NOTIFICATION_ID}/read`);

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      success: false,
      message: 'Notification not found',
      error: { code: 'NOT_FOUND' },
    });
    expect(notificationsService.markAsRead).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      ORG_ID,
      USER_ID
    );
  });

  it('returns the notification on a successful mark-as-read', async () => {
    const notification = { id: NOTIFICATION_ID, is_read: true };
    notificationsService.markAsRead.mockResolvedValue(notification);

    const res = await request(buildApp()).patch(`/notifications/${NOTIFICATION_ID}/read`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Notification marked as read',
      data: notification,
    });
  });
});
