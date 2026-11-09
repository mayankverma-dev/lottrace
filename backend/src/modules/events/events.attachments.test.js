/**
 * P1-13 regression tests — attachment paths must throw a valid AppError for a
 * missing or foreign-tenant event, not a 500 built from an invalid status code.
 */

jest.mock('../../db/knex', () => {
  const state = { event: undefined, lastInsert: undefined };
  const builder = {
    where: jest.fn(function where() {
      return builder;
    }),
    first: jest.fn(async () => state.event),
    insert: jest.fn(function insert(payload) {
      state.lastInsert = payload;
      return builder;
    }),
    returning: jest.fn(async () => (state.lastInsert ? [state.lastInsert] : [])),
  };
  const db = jest.fn(() => builder);
  db.__state = state;
  db.__builder = builder;
  return db;
});

jest.mock('../../lib/storage', () => ({
  generatePresignedUploadUrl: jest.fn(),
}));

jest.mock('../trace/trace.service', () => ({
  invalidateTraceCache: jest.fn(),
}));

const db = require('../../db/knex');
const { generatePresignedUploadUrl } = require('../../lib/storage');
const { generateAttachmentUploadUrl, addAttachment } = require('./events.service');

describe('events.service attachment organization checks', () => {
  beforeEach(() => {
    db.__state.event = undefined;
    db.__state.lastInsert = undefined;
    jest.clearAllMocks();
  });

  it('throws NOT_FOUND with status 404 when generating a URL for an unknown event', async () => {
    await expect(
      generateAttachmentUploadUrl('event-1', 'org-1', 'photo.jpg', 'image/jpeg')
    ).rejects.toMatchObject({
      message: 'Event not found',
      code: 'NOT_FOUND',
      statusCode: 404,
      isOperational: true,
    });

    expect(generatePresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND with status 404 when adding an attachment to an unknown event', async () => {
    await expect(
      addAttachment(
        'event-1',
        { key: 'attachments/photo.jpg', filename: 'photo.jpg', contentType: 'image/jpeg' },
        'org-1',
        'user-1'
      )
    ).rejects.toMatchObject({
      message: 'Event not found',
      code: 'NOT_FOUND',
      statusCode: 404,
      isOperational: true,
    });

    expect(db.__builder.insert).not.toHaveBeenCalled();
  });

  it('inserts with the organization id supplied by the caller', async () => {
    db.__state.event = { id: 'event-1' };

    await addAttachment(
      'event-1',
      { key: 'attachments/photo.jpg', filename: 'photo.jpg', contentType: 'image/jpeg' },
      'org-1',
      'user-1'
    );

    expect(db.__builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        parent_type: 'event',
        parent_id: 'event-1',
        uploaded_by: 'user-1',
      })
    );
  });
});
