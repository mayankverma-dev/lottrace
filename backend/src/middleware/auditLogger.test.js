/**
 * P2-16 — the audit row for an amendment must point at the replacement event.
 *
 * The middleware writes before the response. These tests mock the audit
 * writer, so no database is needed.
 */
jest.mock('../utils/auditTrail', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const auditLogger = require('./auditLogger');
const { writeAuditLog } = require('../utils/auditTrail');

const request = (overrides = {}) => ({
  method: 'POST',
  path: '/events/old-event-id/amend',
  originalUrl: '/api/v1/events/old-event-id/amend',
  query: {},
  params: { eventId: 'old-event-id' },
  body: { output: 1 },
  organizationId: 'org-id',
  user: { id: 'actor-id' },
  ip: '127.0.0.1',
  ...overrides,
});

const respond = async (req, body, statusCode = 200) => {
  const res = { statusCode, json: jest.fn() };
  const next = jest.fn();
  await auditLogger('event')(req, res, next);
  await res.json(body);
  return { res, next };
};

describe('P2-16 audit entity for amendments', () => {
  beforeEach(() => {
    writeAuditLog.mockClear();
  });

  it('records the replacement event id and keeps the superseded id in metadata', async () => {
    await respond(
      request(),
      { success: true, data: { id: 'replacement-event-id' } },
      201,
    );

    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'event.amend',
      entityType: 'event',
      entityId: 'replacement-event-id',
    });
    expect(writeAuditLog.mock.calls[0][0].metadata.supersededEventId)
      .toBe('old-event-id');
  });

  it('keeps the voided event id for a void action', async () => {
    await respond(
      request({ path: '/events/old-event-id/void', params: { eventId: 'old-event-id' } }),
      { success: true, data: { id: 'old-event-id', status: 'void' } },
    );

    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'event.void',
      entityId: 'old-event-id',
    });
    expect(writeAuditLog.mock.calls[0][0].metadata.supersededEventId).toBeUndefined();
  });

  it('writes nothing for a failed request', async () => {
    await respond(
      request(),
      { success: false, error: { code: 'VALIDATION_ERROR' } },
      400,
    );

    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('writes the audit row before sending the response', async () => {
    const order = [];
    writeAuditLog.mockImplementationOnce(async () => {
      order.push('audit');
    });

    const req = request();
    const json = jest.fn(() => {
      order.push('response');
    });
    const res = { statusCode: 201, json };

    await auditLogger('event')(req, res, jest.fn());
    await res.json({ success: true, data: { id: 'replacement-event-id' } });

    expect(order).toEqual(['audit', 'response']);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'replacement-event-id' },
    });
  });

  it('still sends the response when the audit write fails', async () => {
    writeAuditLog.mockRejectedValueOnce(new Error('audit database unavailable'));

    const req = request({ log: { error: jest.fn() } });
    const json = jest.fn();
    const res = { statusCode: 201, json };

    await auditLogger('event')(req, res, jest.fn());
    await res.json({ success: true, data: { id: 'replacement-event-id' } });

    expect(req.log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Failed to write audit log from middleware',
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'replacement-event-id' },
    });
  });
});
