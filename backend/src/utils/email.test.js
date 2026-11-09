/**
 * P1-15 regression tests — the email transport honors EMAIL_DRY_RUN.
 *
 * The config bug made `EMAIL_DRY_RUN=false` parse as `true`, so these tests assert
 * the transport branch that actually runs: Resend is called only when dry-run is off.
 *
 * `resend` and `logger` are mocked, so no network call and no credentials are needed.
 */

jest.mock('resend', () => {
  const send = jest.fn();
  // A constructor that returns an object works for `new Resend(...)`.
  function Resend() {
    return { emails: { send } };
  }
  return { Resend, __send: send };
});

jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const REQUIRED_ENV = {
  DATABASE_URL: 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test',
  REDIS_URL: 'redis://localhost:6379',
  ACCESS_JWT_SECRET: 'a'.repeat(64),
  REFRESH_JWT_SECRET: 'b'.repeat(64),
  ARGON2_SECRET: 'c'.repeat(32),
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'LotTrace <onboarding@resend.dev>',
  NODE_ENV: 'test',
};

const MANAGED_KEYS = [...Object.keys(REQUIRED_ENV), 'EMAIL_DRY_RUN', 'DEV_EMAIL_OVERRIDE'];
const ORIGINAL = {};

/**
 * Loads `email.js` together with the mocks it received in the same module registry.
 * @returns {{ email: Object, loggerMock: Object, sendMock: jest.Mock }}
 */
const loadEmailWithMocks = () => {
  let email;
  let loggerMock;
  let sendMock;

  jest.isolateModules(() => {
    email = require('./email');
    loggerMock = require('./logger');
    sendMock = require('resend').__send;
  });

  return { email, loggerMock, sendMock };
};

beforeAll(() => {
  MANAGED_KEYS.forEach((key) => {
    ORIGINAL[key] = process.env[key];
  });
});

beforeEach(() => {
  Object.entries(REQUIRED_ENV).forEach(([key, value]) => {
    process.env[key] = value;
  });
  delete process.env.EMAIL_DRY_RUN;
  delete process.env.DEV_EMAIL_OVERRIDE;
});

afterAll(() => {
  MANAGED_KEYS.forEach((key) => {
    if (ORIGINAL[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL[key];
    }
  });
});

describe('sendEmail with EMAIL_DRY_RUN=false', () => {
  it('calls the Resend API and logs a real send', async () => {
    process.env.EMAIL_DRY_RUN = 'false';

    const { email, loggerMock, sendMock } = loadEmailWithMocks();
    sendMock.mockResolvedValue({ data: { id: 'resend_msg_1' }, error: null });

    const result = await email.sendEmail({
      to: 'operator@example.com',
      subject: 'P1-15 check',
      html: '<p>hello</p>',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      from: REQUIRED_ENV.EMAIL_FROM,
      to: 'operator@example.com',
      subject: 'P1-15 check',
      html: '<p>hello</p>',
    });
    expect(result).toEqual({ data: { id: 'resend_msg_1' }, error: null });

    const messages = loggerMock.info.mock.calls.map(([, message]) => message);
    expect(messages).toContain('Email sent via Resend');
    expect(messages.some((message) => String(message).includes('EMAIL_DRY_RUN'))).toBe(false);
  });

  it('redirects to DEV_EMAIL_OVERRIDE and prefixes the subject', async () => {
    process.env.EMAIL_DRY_RUN = 'false';
    process.env.DEV_EMAIL_OVERRIDE = 'qa@example.com';

    const { email, sendMock } = loadEmailWithMocks();
    sendMock.mockResolvedValue({ data: { id: 'resend_msg_2' }, error: null });

    await email.sendEmail({
      to: 'operator@example.com',
      subject: 'Invite',
      html: '<p>hello</p>',
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'qa@example.com',
        subject: '[→ operator@example.com] Invite',
      })
    );
  });

  it('propagates transport errors instead of reporting success', async () => {
    process.env.EMAIL_DRY_RUN = 'false';

    const { email, loggerMock, sendMock } = loadEmailWithMocks();
    sendMock.mockRejectedValue(new Error('resend down'));

    await expect(
      email.sendEmail({ to: 'operator@example.com', subject: 'fail', html: '<p>x</p>' })
    ).rejects.toThrow('resend down');
    expect(loggerMock.error).toHaveBeenCalled();
  });
});

describe('sendEmail with EMAIL_DRY_RUN=true', () => {
  it('does not call Resend and returns a synthetic dry-run id', async () => {
    process.env.EMAIL_DRY_RUN = 'true';

    const { email, loggerMock, sendMock } = loadEmailWithMocks();

    const result = await email.sendEmail({
      to: 'operator@example.com',
      subject: 'P1-15 check',
      html: '<p>hello</p>',
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.data.id).toMatch(/^dryrun_\d+$/);

    const messages = loggerMock.info.mock.calls.map(([, message]) => message);
    expect(messages.some((message) => String(message).includes('EMAIL_DRY_RUN'))).toBe(true);
  });

  it('keeps the DEV_EMAIL_OVERRIDE recipient visible in the log', async () => {
    process.env.EMAIL_DRY_RUN = 'true';
    process.env.DEV_EMAIL_OVERRIDE = 'qa@example.com';

    const { email, loggerMock, sendMock } = loadEmailWithMocks();

    await email.sendEmail({ to: 'operator@example.com', subject: 'Invite', html: '<p>x</p>' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'qa@example.com',
        subject: '[→ operator@example.com] Invite',
      }),
      expect.stringContaining('EMAIL_DRY_RUN')
    );
  });
});
