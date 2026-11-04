const {
  LOCAL_HOSTS,
  parseDatabaseTarget,
  isLocalHost,
  formatTarget,
  assertSeedAllowed,
} = require('./seedGuard');

const LOCAL_URL = 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test';
const REMOTE_URL = 'postgresql://user:secret@db.example.com:5432/lottrace';

const options = (overrides = {}) => ({
  nodeEnv: 'development',
  databaseUrl: LOCAL_URL,
  allowDestructiveSeed: '',
  confirmRemote: '',
  isInteractive: false,
  confirm: jest.fn(async () => true),
  log: jest.fn(),
  ...overrides,
});

describe('parseDatabaseTarget', () => {
  it('parses a local URL without exposing credentials', () => {
    expect(parseDatabaseTarget(LOCAL_URL)).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'lottrace_test',
      protocol: 'postgresql:',
    });
  });

  it('defaults to port 5432 when the URL has no port', () => {
    expect(parseDatabaseTarget('postgres://lottrace:lottrace@localhost/lottrace_test')).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'lottrace_test',
      protocol: 'postgres:',
    });
  });

  it('normalizes bracketed IPv6 hosts', () => {
    expect(
      parseDatabaseTarget('postgresql://lottrace:lottrace@[::1]:5432/lottrace_test').host,
    ).toBe('::1');
  });

  it('decodes an encoded database name', () => {
    expect(
      parseDatabaseTarget('postgresql://lottrace:lottrace@localhost:5432/lottrace%5Ftest').database,
    ).toBe('lottrace_test');
  });

  it('trims surrounding whitespace', () => {
    expect(parseDatabaseTarget(`  ${LOCAL_URL}  `).database).toBe('lottrace_test');
  });

  it('rejects invalid percent-encoding in the database name', () => {
    expect(() => parseDatabaseTarget('postgresql://localhost:5432/lottrace%ZZ')).toThrow(
      /invalid percent-encoding/,
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['malformed', 'not a database url'],
  ])('rejects a %s DATABASE_URL', (_label, databaseUrl) => {
    expect(() => parseDatabaseTarget(databaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-PostgreSQL protocol', () => {
    expect(() => parseDatabaseTarget('mysql://localhost/lottrace_test')).toThrow(
      /unsupported database protocol/,
    );
  });

  it('rejects a URL without a host', () => {
    expect(() => parseDatabaseTarget('postgresql:///lottrace_test')).toThrow(/must include a host/);
  });

  it('rejects a URL without a database name', () => {
    expect(() => parseDatabaseTarget('postgresql://localhost:5432')).toThrow(
      /must include a database name/,
    );
  });
});

describe('isLocalHost', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'POSTGRES'])(
    'allows %s',
    (host) => {
      expect(isLocalHost(host)).toBe(true);
    },
  );

  it.each(['localhost.evil.com', '127.0.0.1.evil.com', '0.0.0.0', 'db.example.com', ''])(
    'rejects %s',
    (host) => {
      expect(isLocalHost(host)).toBe(false);
    },
  );

  it('has an exact-match allowlist', () => {
    expect([...LOCAL_HOSTS].sort()).toEqual(['127.0.0.1', '::1', 'localhost', 'postgres'].sort());
  });
});

describe('assertSeedAllowed', () => {
  it('refuses production even when every opt-in is set', async () => {
    const log = jest.fn();

    await expect(
      assertSeedAllowed(
        options({
          nodeEnv: 'production',
          allowDestructiveSeed: 'true',
          confirmRemote: 'true',
          log,
        }),
      ),
    ).rejects.toThrow(/NODE_ENV=production/);

    expect(log).not.toHaveBeenCalled();
  });

  it('allows local databases without extra flags', async () => {
    const log = jest.fn();

    await expect(assertSeedAllowed(options({ log }))).resolves.toEqual({
      host: 'localhost',
      port: 5432,
      database: 'lottrace_test',
      protocol: 'postgresql:',
    });
    expect(log).toHaveBeenCalledWith('Seed target: lottrace_test @ localhost:5432');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('lottrace:lottrace'));
  });

  it('allows the docker-compose postgres host', async () => {
    await expect(
      assertSeedAllowed(
        options({
          databaseUrl: 'postgresql://lottrace:lottrace@postgres:5432/lottrace_test',
        }),
      ),
    ).resolves.toMatchObject({ host: 'postgres', database: 'lottrace_test' });
  });

  it('refuses a remote host without ALLOW_DESTRUCTIVE_SEED', async () => {
    await expect(assertSeedAllowed(options({ databaseUrl: REMOTE_URL }))).rejects.toThrow(
      /ALLOW_DESTRUCTIVE_SEED=true/,
    );
  });

  it('refuses a host that only looks local', async () => {
    await expect(
      assertSeedAllowed(
        options({
          databaseUrl: 'postgresql://user:secret@localhost.evil.com:5432/lottrace',
        }),
      ),
    ).rejects.toThrow(/ALLOW_DESTRUCTIVE_SEED=true/);
  });

  it('refuses a remote host when the interactive confirmation is wrong', async () => {
    const confirm = jest.fn(async () => false);

    await expect(
      assertSeedAllowed(
        options({
          databaseUrl: REMOTE_URL,
          allowDestructiveSeed: 'true',
          isInteractive: true,
          confirm,
        }),
      ),
    ).rejects.toThrow(/confirmation did not match/);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db.example.com', database: 'lottrace' }),
    );
  });

  it('allows a remote host after an interactive confirmation', async () => {
    const confirm = jest.fn(async () => true);

    await expect(
      assertSeedAllowed(
        options({
          databaseUrl: REMOTE_URL,
          allowDestructiveSeed: '1',
          isInteractive: true,
          confirm,
        }),
      ),
    ).resolves.toMatchObject({ host: 'db.example.com', database: 'lottrace' });
  });

  it('refuses a remote host in a non-interactive shell without SEED_CONFIRM_REMOTE', async () => {
    await expect(
      assertSeedAllowed(
        options({
          databaseUrl: REMOTE_URL,
          allowDestructiveSeed: 'true',
          isInteractive: false,
        }),
      ),
    ).rejects.toThrow(/SEED_CONFIRM_REMOTE=true/);
  });

  it('allows a remote host in a non-interactive shell with SEED_CONFIRM_REMOTE', async () => {
    await expect(
      assertSeedAllowed(
        options({
          databaseUrl: REMOTE_URL,
          allowDestructiveSeed: 'true',
          confirmRemote: 'true',
          isInteractive: false,
        }),
      ),
    ).resolves.toMatchObject({ host: 'db.example.com', database: 'lottrace' });
  });

  it('formats the target without credentials', () => {
    expect(formatTarget({ host: 'localhost', port: 5432, database: 'lottrace_test' })).toBe(
      'lottrace_test @ localhost:5432',
    );
  });
});
