require('dotenv').config();

const { buildDatabaseConnection } = require('./src/db/connectionConfig');

const currentEnvironment = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const POOLS = {
  development: { min: 2, max: 10 },
  test: { min: 2, max: 10 },
  staging: { min: 2, max: 20 },
  production: { min: 5, max: 30 },
};

const buildConfig = (environment) => {
  const { connection, tls } = buildDatabaseConnection({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: environment,
    // Only validate the insecure flag for the environment actually in use.
    tlsInsecure: environment === currentEnvironment ? process.env.DB_TLS_INSECURE : undefined,
    sslCa: process.env.DB_SSL_CA,
    sslCaPath: process.env.DB_SSL_CA_PATH,
  });

  if (tls.enabled && tls.insecure) {
    console.warn(
      '[db] WARNING: DB_TLS_INSECURE is enabled — PostgreSQL TLS certificate verification is DISABLED. Use local development only.',
    );
  }

  return {
    client: 'pg',
    connection,
    searchPath: ['public'],
    migrations: {
      directory: './src/db/migrations',
    },
    seeds: {
      directory: './src/db/seeds',
    },
    pool: POOLS[environment],
  };
};

// Build lazily: only the environment Knex selects should be validated. Building
// every environment eagerly would reject a dev-only insecure URL while loading
// the unused production config.
const config = {};
Object.keys(POOLS).forEach((environment) => {
  let cached;
  Object.defineProperty(config, environment, {
    enumerable: true,
    get() {
      if (!cached) cached = buildConfig(environment);
      return cached;
    },
  });
});

module.exports = config;
