const { EventEmitter } = require('node:events');

const mockTransaction = {
  raw: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../db/knex', () => ({
  transaction: jest.fn().mockResolvedValue(mockTransaction),
}));

const tenantScope = require('./tenantScope');
const db = require('../db/knex');
const { addTenantPostCommit } = require('../db/tenantContext');

const buildResponse = (statusCode) => {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  return response;
};

describe('tenantScope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits successful request transactions', async () => {
    const req = { user: { organizationId: 'org-a' } };
    const res = buildResponse(200);
    const next = jest.fn();

    await tenantScope(req, res, next);
    res.emit('finish');
    await new Promise(setImmediate);

    expect(req.organizationId).toBe('org-a');
    expect(mockTransaction.raw).toHaveBeenCalledWith(
      'SELECT set_config(?, ?, true)',
      ['app.current_org_id', 'org-a'],
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
    expect(mockTransaction.rollback).not.toHaveBeenCalled();
  });

  it('runs post-commit callbacks after commit', async () => {
    const calls = [];
    mockTransaction.commit.mockImplementationOnce(async () => {
      calls.push('commit');
    });
    const req = { user: { organizationId: 'org-a' } };
    const res = buildResponse(200);
    const next = jest.fn(() => {
      addTenantPostCommit(() => calls.push('callback'));
    });

    await tenantScope(req, res, next);
    expect(calls).toEqual([]);
    res.emit('finish');
    await new Promise(setImmediate);

    expect(calls).toEqual(['commit', 'callback']);
  });

  it('rolls back error responses', async () => {
    const req = { user: { organizationId: 'org-a' } };
    const res = buildResponse(500);
    const next = jest.fn();

    await tenantScope(req, res, next);
    res.emit('finish');
    await new Promise(setImmediate);

    expect(mockTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(mockTransaction.commit).not.toHaveBeenCalled();
  });

  it('discards post-commit callbacks on rollback', async () => {
    const callback = jest.fn();
    const req = { user: { organizationId: 'org-a' } };
    const res = buildResponse(500);
    const next = jest.fn(() => addTenantPostCommit(callback));

    await tenantScope(req, res, next);
    res.emit('finish');
    await new Promise(setImmediate);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not open a transaction without JWT organization scope', async () => {
    const req = { user: null };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await tenantScope(req, res, next);

    expect(db.transaction).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
