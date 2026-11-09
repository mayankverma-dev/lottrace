/**
 * P1-13 regression tests — the notification controller must throw a valid
 * AppError (message, code, statusCode) when the notification row is missing.
 */

jest.mock('./notifications.service', () => ({
  getNotifications: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
}));

const AppError = require('../../utils/AppError');
const notificationsService = require('./notifications.service');
const { markAsRead } = require('./notifications.controller');

const NOTIFICATION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * @returns {Object} Minimal request for the mark-read controller.
 */
const buildRequest = () => ({
  validatedParams: { id: NOTIFICATION_ID },
  organizationId: 'org-1',
  user: { id: 'user-1' },
});

describe('notifications.controller markAsRead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NOT_FOUND with status 404 when no notification was updated', async () => {
    notificationsService.markAsRead.mockResolvedValue(undefined);

    await expect(markAsRead(buildRequest(), {})).rejects.toMatchObject({
      name: 'Error',
      message: 'Notification not found',
      code: 'NOT_FOUND',
      statusCode: 404,
      isOperational: true,
    });
  });

  it('throws an AppError instance, not a bare Error', async () => {
    notificationsService.markAsRead.mockResolvedValue(undefined);

    await expect(markAsRead(buildRequest(), {})).rejects.toBeInstanceOf(AppError);
  });

  it('scopes the lookup with the JWT organization and user ids', async () => {
    notificationsService.markAsRead.mockResolvedValue(undefined);

    await expect(markAsRead(buildRequest(), {})).rejects.toBeInstanceOf(AppError);

    expect(notificationsService.markAsRead).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      'org-1',
      'user-1'
    );
  });
});
