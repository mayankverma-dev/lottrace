/**
 * P1-17 integration tests — real PostgreSQL TLS handshakes.
 *
 * Requires a disposable local PostgreSQL server with TLS enabled:
 *   RUN_DB_TESTS=1 \
 *   TLS_DATABASE_URL=postgresql://lottrace:lottrace@localhost:55433/lottrace_p117_test?sslmode=require \
 *   TLS_DB_CA_PATH=/tmp/opencode/lottrace-pg-tls/server.crt \
 *   npx jest --runInBand src/db/connectionTls.integration.test.js
 *
 * The suite refuses non-local hosts and database names that do not end in `_test`.
 */

const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const TLS_DATABASE_URL = process.env.TLS_DATABASE_URL;
const TLS_DB_CA_PATH = process.env.TLS_DB_CA_PATH;
const RUN = RUN_DB_TESTS && Boolean(TLS_DATABASE_URL) && Boolean(TLS_DB_CA_PATH);

const assertLocalTlsDatabase = () => {
  const { hostname, pathname } = new URL(TLS_DATABASE_URL);

  if (hostname === 'neon.tech' || hostname.endsWith('.neon.tech')) {
    throw new Error(`Refusing to run TLS tests against Neon host "${hostname}"`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(`Refusing to run TLS tests against non-local host "${hostname}"`);
  }
  if (!/_test$/.test(pathname)) {
    throw new Error(
      `Refusing to run TLS tests against database "${pathname}" (name must end with _test)`,
    );
  }

  return { hostname, pathname };
};

if (RUN) {
  const target = assertLocalTlsDatabase();
  console.log(`[db-tests] TLS target ${target.hostname}${target.pathname}`);
}

const { buildDatabaseConnection } = require('./connectionConfig');

const describeDb = RUN ? describe : describe.skip;

describeDb('P1-17 PostgreSQL TLS handshakes', () => {
  jest.setTimeout(30000);

  const makeDb = (overrides = {}) => {
    const { connection } = buildDatabaseConnection({
      databaseUrl: TLS_DATABASE_URL,
      nodeEnv: 'production',
      sslCaPath: TLS_DB_CA_PATH,
      ...overrides,
    });

    // eslint-disable-next-line global-require
    const knex = require('knex');
    return knex({
      client: 'pg',
      connection,
      pool: { min: 0, max: 1 },
    });
  };

  const withDb = async (overrides, assertion) => {
    const db = makeDb(overrides);
    try {
      await assertion(db);
    } finally {
      await db.destroy();
    }
  };

  it('connects with a configured CA and verified production TLS', async () => {
    await withDb({}, async (db) => {
      const result = await db.raw('select 1 as ok');
      expect(result.rows[0].ok).toBe(1);
    });
  });

  it('rejects a self-signed certificate without a CA', async () => {
    await withDb({ sslCaPath: undefined }, async (db) => {
      await expect(db.raw('select 1')).rejects.toThrow(
        /self[- ]signed|certificate/i,
      );
    });
  });

  it('connects with DB_TLS_INSECURE=true in development', async () => {
    await withDb(
      { nodeEnv: 'development', tlsInsecure: 'true', sslCaPath: undefined },
      async (db) => {
        const result = await db.raw('select 1 as ok');
        expect(result.rows[0].ok).toBe(1);
      },
    );
  });

  it('rejects DB_TLS_INSECURE=true in production before connecting', () => {
    expect(() =>
      buildDatabaseConnection({
        databaseUrl: TLS_DATABASE_URL,
        nodeEnv: 'production',
        tlsInsecure: 'true',
        sslCaPath: TLS_DB_CA_PATH,
      }),
    ).toThrow(/DB_TLS_INSECURE/);
  });
});
