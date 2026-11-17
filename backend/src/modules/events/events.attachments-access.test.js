/**
 * P1-10/P2-09 attachment lifecycle and tenant-access tests.
 * Requires RUN_DB_TESTS=1 and a disposable local database ending in _test.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

if (RUN_DB_TESTS) require('../../test/dbGuard').announceTarget();

jest.mock('../../lib/storage', () => ({
  generatePresignedUploadUrl: jest.fn().mockResolvedValue('https://storage.test/upload'),
  generatePresignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.test/download'),
  headObject: jest.fn().mockResolvedValue({ contentLength: 1024, contentType: 'image/jpeg' }),
  deleteObject: jest.fn().mockResolvedValue('deleted'),
}));
jest.mock('../trace/trace.service', () => ({
  bumpTraceCacheVersion: jest.fn().mockResolvedValue(undefined),
}));

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('P1-10/P2-09 attachment lifecycle', () => {
  jest.setTimeout(120000);

  let db;
  let eventsService;
  let storage;
  const migrationDirectory = path.join(__dirname, '../../db/migrations');

  const seedOrg = async (label) => {
    const organizationId = uuidv4();
    const userId = uuidv4();
    await db('organizations').insert({
      id: organizationId,
      name: label,
      slug: `${label}-${organizationId.slice(0, 8)}`,
    });
    await db('users').insert({
      id: userId,
      organization_id: organizationId,
      first_name: 'Attachment',
      last_name: 'Tester',
      email: `${organizationId}@example.test`,
      role: 'org_admin',
      status: 'active',
    });
    return { organizationId, userId };
  };

  const seedEvent = async ({ organizationId, userId }) => {
    const eventId = uuidv4();
    await db('events').insert({
      id: eventId,
      organization_id: organizationId,
      event_type: 'creation',
      event_datetime: new Date('2026-01-01T00:00:00.000Z'),
      recorded_by: userId,
      source: 'manual',
      kde_payload: '{}',
      record_hash: `hash-${eventId}`,
      prev_hash: 'GENESIS',
      chain_seq: 1,
      hash_version: 3,
      hash_key_id: 'test',
    });
    return eventId;
  };

  beforeAll(async () => {
    db = require('../../db/knex');
    eventsService = require('./events.service');
    storage = require('../../lib/storage');
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.migrate.latest({ directory: migrationDirectory });
  });

  afterEach(async () => {
    await db.raw('TRUNCATE TABLE organizations CASCADE');
    jest.clearAllMocks();
    storage.generatePresignedUploadUrl.mockResolvedValue('https://storage.test/upload');
    storage.generatePresignedDownloadUrl.mockResolvedValue('https://storage.test/download');
    storage.headObject.mockResolvedValue({ contentLength: 1024, contentType: 'image/jpeg' });
    storage.deleteObject.mockResolvedValue('deleted');
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates pending row without exposing storage key, confirms from storage metadata, lists, and downloads', async () => {
    const org = await seedOrg('attachment-access');
    const eventId = await seedEvent(org);
    const upload = await eventsService.generateAttachmentUploadUrl(
      eventId, org.organizationId, org.userId, 'photo.jpg', 'image/jpeg',
    );

    expect(upload).toEqual({
      uploadUrl: 'https://storage.test/upload',
      attachmentId: expect.any(String),
    });
    expect(upload.storageKey).toBeUndefined();
    expect(await db('attachments').where({ status: 'pending' })).toHaveLength(1);

    const confirmed = await eventsService.addAttachment(
      eventId,
      { attachmentId: upload.attachmentId },
      org.organizationId,
      org.userId,
    );
    expect(confirmed).toMatchObject({ status: 'uploaded', filename: 'photo.jpg', sizeBytes: '1024' });
    expect(confirmed.storageKey).toBeUndefined();

    const listed = await eventsService.listAttachments(eventId, { page: 1, limit: 20 }, org.organizationId);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].id).toBe(upload.attachmentId);
    expect(listed.data[0].storageKey).toBeUndefined();

    const download = await eventsService.getAttachmentDownloadUrl(upload.attachmentId, org.organizationId);
    expect(download).toEqual({ downloadUrl: 'https://storage.test/download' });

    const deleted = await eventsService.deleteAttachment(
      upload.attachmentId,
      org.organizationId,
      org.userId,
      '127.0.0.1',
    );
    expect(deleted).toMatchObject({ status: 'deleted', id: upload.attachmentId });
    expect(await eventsService.listAttachments(eventId, { page: 1, limit: 20 }, org.organizationId)).toMatchObject({ data: [] });
    await expect(eventsService.getAttachmentDownloadUrl(upload.attachmentId, org.organizationId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(await db('audit_log').where({ action: 'attachment.delete', entity_id: upload.attachmentId })).toHaveLength(1);
  });

  it('returns 404 across organizations and rejects arbitrary-key confirmation', async () => {
    const orgA = await seedOrg('attachment-a');
    const orgB = await seedOrg('attachment-b');
    const eventId = await seedEvent(orgA);
    const upload = await eventsService.generateAttachmentUploadUrl(
      eventId, orgA.organizationId, orgA.userId, 'photo.jpg', 'image/jpeg',
    );

    await expect(eventsService.listAttachments(eventId, { page: 1, limit: 20 }, orgB.organizationId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    await expect(eventsService.getAttachmentDownloadUrl(upload.attachmentId, orgB.organizationId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    await expect(eventsService.addAttachment(
      eventId,
      { attachmentId: uuidv4() },
      orgA.organizationId,
      orgA.userId,
    )).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('keeps pending row when storage object is missing', async () => {
    const org = await seedOrg('attachment-missing');
    const eventId = await seedEvent(org);
    const upload = await eventsService.generateAttachmentUploadUrl(
      eventId, org.organizationId, org.userId, 'missing.jpg', 'image/jpeg',
    );
    storage.headObject.mockRejectedValueOnce({ name: 'NotFound' });

    await expect(eventsService.addAttachment(
      eventId,
      { attachmentId: upload.attachmentId },
      org.organizationId,
      org.userId,
    )).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_UPLOADED', statusCode: 409 });
    expect(await db('attachments').where({ id: upload.attachmentId, status: 'pending' })).toHaveLength(1);
  });

  it('cleans expired pending objects but retains recent and failed deletions', async () => {
    const org = await seedOrg('attachment-cleanup');
    const eventId = await seedEvent(org);
    const old = await eventsService.generateAttachmentUploadUrl(
      eventId, org.organizationId, org.userId, 'old.jpg', 'image/jpeg',
    );
    const failed = await eventsService.generateAttachmentUploadUrl(
      eventId, org.organizationId, org.userId, 'failed.jpg', 'image/jpeg',
    );
    await eventsService.generateAttachmentUploadUrl(
      eventId, org.organizationId, org.userId, 'recent.jpg', 'image/jpeg',
    );
    await db('attachments').where({ id: old.attachmentId }).update({
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    await db('attachments').where({ id: failed.attachmentId }).update({
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
      status: 'deleting',
    });
    storage.deleteObject
      .mockResolvedValueOnce('deleted')
      .mockRejectedValueOnce(new Error('storage unavailable'));

    const result = await eventsService.purgePendingAttachments();
    expect(result).toEqual({ scanned: 2, deleted: 1 });
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(await db('attachments').where({ id: old.attachmentId })).toHaveLength(0);
    expect(await db('attachments').where({ id: failed.attachmentId, status: 'deleting' })).toHaveLength(1);

    storage.deleteObject.mockResolvedValue('deleted');
    const retry = await eventsService.purgePendingAttachments();
    expect(retry).toEqual({ scanned: 1, deleted: 1 });
    expect(await db('attachments').where({ id: failed.attachmentId, status: 'deleted' })).toHaveLength(1);
  });
});
