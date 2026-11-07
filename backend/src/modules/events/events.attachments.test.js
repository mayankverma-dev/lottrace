jest.mock('../../db/knex', () => {
  const first = jest.fn();
  const where = jest.fn(() => ({ first }));
  const db = jest.fn(() => ({ where }));
  db.__first = first;
  db.__where = where;
  return db;
});

jest.mock('../trace/trace.service', () => ({
  invalidateTraceCache: jest.fn(),
}));

jest.mock('../../lib/storage', () => ({
  generatePresignedUploadUrl: jest.fn(),
}));

const db = require('../../db/knex');
const eventsService = require('./events.service');

const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const NOT_FOUND = {
  message: 'Event not found',
  code: 'NOT_FOUND',
  statusCode: 404,
  isOperational: true,
};

describe('event attachment lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.__first.mockResolvedValue(undefined);
  });

  it('returns NOT_FOUND when generating a URL for a missing or foreign event', async () => {
    await expect(
      eventsService.generateAttachmentUploadUrl(
        EVENT_ID,
        ORG_ID,
        'invoice.pdf',
        'application/pdf'
      )
    ).rejects.toMatchObject(NOT_FOUND);

    expect(db.__where).toHaveBeenCalledWith({
      id: EVENT_ID,
      organization_id: ORG_ID,
    });
  });

  it('returns NOT_FOUND when adding an attachment to a missing or foreign event', async () => {
    await expect(
      eventsService.addAttachment(
        EVENT_ID,
        {
          key: 'attachments/test.pdf',
          filename: 'test.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
        },
        ORG_ID,
        USER_ID
      )
    ).rejects.toMatchObject(NOT_FOUND);

    expect(db.__where).toHaveBeenCalledWith({
      id: EVENT_ID,
      organization_id: ORG_ID,
    });
  });
});
