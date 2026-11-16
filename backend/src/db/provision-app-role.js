require('dotenv').config();
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const roleName = process.env.APP_DB_ROLE || 'lottrace_app';
const rolePassword = process.env.APP_DB_PASSWORD;

const quoteIdentifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error('APP_DB_ROLE must be a lowercase PostgreSQL identifier');
  }
  return `"${value}"`;
};

const quoteLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

const main = async () => {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!rolePassword) throw new Error('APP_DB_PASSWORD is required');

  const target = new URL(databaseUrl);
  console.log(`[db-role] resolved host=${target.hostname} port=${target.port || '5432'} database=${target.pathname.slice(1)}`);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
    throw new Error('Refusing to provision runtime role on a non-local database');
  }
  console.log('[db-role] confirmed local disposable database; Neon prohibited');

  const role = quoteIdentifier(roleName);
  const password = quoteLiteral(rolePassword);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(roleName)}) THEN
          ALTER ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${password};
        ELSE
          CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${password};
        END IF;
      END
      $$;
    `);
    await client.query(`
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${role};
    `);
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(`[db-role] ${error.message}`);
  process.exitCode = 1;
});
