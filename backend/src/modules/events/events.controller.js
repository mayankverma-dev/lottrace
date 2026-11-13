const apiResponse = require('../../utils/apiResponse');
const eventsService = require('./events.service');
const { getEventsQuerySchema } = require('./events.validation');

const createEvent = async (req, res) => {
  const event = await eventsService.createEvent(req.validatedBody, req.organizationId, req.user.id);
  return apiResponse.created(res, event, 'Event created successfully');
};

const getEvents = async (req, res) => {
  // Validate query string
  const query = getEventsQuerySchema.parse(req.query);
  const { data, pagination } = await eventsService.getEvents(query, req.organizationId);
  return apiResponse.paginated(res, data, pagination, 'Events fetched successfully');
};

const getEvent = async (req, res) => {
  const event = await eventsService.getEventById(req.params.eventId, req.organizationId);
  return apiResponse.success(res, event, 'Event fetched successfully');
};

const voidEvent = async (req, res) => {
  const event = await eventsService.voidEvent(req.params.eventId, req.validatedBody.voidReason, req.organizationId, req.user.id);
  return apiResponse.success(res, event, 'Event voided successfully');
};

const amendEvent = async (req, res) => {
  const event = await eventsService.amendEvent(req.params.eventId, req.validatedBody, req.organizationId, req.user.id);
  return apiResponse.created(res, event, 'Event amended successfully');
};

const generateAttachmentUploadUrl = async (req, res) => {
  const { filename, contentType } = req.body;
  const urlData = await eventsService.generateAttachmentUploadUrl(req.params.eventId, req.organizationId, filename, contentType);
  return apiResponse.success(res, urlData, 'Presigned URL generated');
};

const addAttachment = async (req, res) => {
  const attachment = await eventsService.addAttachment(req.params.eventId, req.body, req.organizationId, req.user.id);
  return apiResponse.created(res, attachment, 'Attachment added successfully');
};

module.exports = {
  createEvent,
  getEvents,
  getEvent,
  voidEvent,
  amendEvent,
  generateAttachmentUploadUrl,
  addAttachment,
};
