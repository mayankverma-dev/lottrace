const apiResponse = require('../../utils/apiResponse');
const notificationsService = require('./notifications.service');
const AppError = require('../../utils/AppError');

const getNotifications = async (req, res) => {
  const { data, pagination } = await notificationsService.getNotifications(
    req.validatedQuery,
    req.organizationId,
    req.user.id
  );
  return apiResponse.paginated(res, data, pagination, 'Notifications fetched successfully');
};

const markAsRead = async (req, res) => {
  const notification = await notificationsService.markAsRead(
    req.validatedParams.id,
    req.organizationId,
    req.user.id
  );

  if (!notification) {
    throw new AppError('Notification not found', 'NOT_FOUND', 404);
  }

  return apiResponse.success(res, notification, 'Notification marked as read');
};

const markAllAsRead = async (req, res) => {
  await notificationsService.markAllAsRead(req.organizationId, req.user.id);
  return apiResponse.success(res, null, 'All notifications marked as read');
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
};
