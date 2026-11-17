const usersService = require('./users.service');
const apiResponse = require('../../utils/apiResponse');

const listUsers = async (req, res) => {
  const result = await usersService.listUsers(req.organizationId, req.validatedQuery);
  return apiResponse.paginated(res, result.data, result.pagination, 'Users fetched successfully');
};

const getUser = async (req, res) => {
  const user = await usersService.getUserById(req.organizationId, req.params.userId);
  return apiResponse.success(res, user, 'User fetched successfully');
};

const inviteUser = async (req, res) => {
  const user = await usersService.inviteUser(req.organizationId, req.validatedBody);
  return apiResponse.created(res, user, 'User invited successfully');
};

const updateUser = async (req, res) => {
  const user = await usersService.updateUser(
    req.organizationId,
    req.params.userId,
    req.validatedBody,
    req.user,
  );
  return apiResponse.success(res, user, 'User updated successfully');
};

const deactivateUser = async (req, res) => {
  const user = await usersService.deactivateUser(req.organizationId, req.params.userId, req.user.id);
  return apiResponse.success(res, user, 'User deactivated successfully');
};

const reactivateUser = async (req, res) => {
  const user = await usersService.reactivateUser(req.organizationId, req.params.userId);
  const message = user.status === 'invited'
    ? 'Invitation sent successfully'
    : 'User reactivated successfully';
  return apiResponse.success(res, user, message);
};

const resendInvite = async (req, res) => {
  const user = await usersService.resendInvite(req.organizationId, req.params.userId);
  return apiResponse.success(res, user, 'Invite resent successfully');
};

module.exports = {
  listUsers,
  getUser,
  inviteUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  resendInvite,
};
