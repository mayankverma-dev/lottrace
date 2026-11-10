require('dotenv').config();

const isNeon = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech');

/** @type {import('knex').Knex.Config} */
const commonConfig = {
  client: 'pg',
  connection: isNeon ? {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  } : process.env.DATABASE_URL,
  searchPath: ['public'],
  migrations: {
    directory: './src/db/migrations',
  },
  seeds: {
    directory: './src/db/seeds',
  },
  pool: {
    min: 2,
    max: 10,
  },
};

module.exports = {
  development: {
    ...commonConfig,
  },

  test: {
    ...commonConfig,
  },

  staging: {
    ...commonConfig,
    pool: {
      min: 2,
      max: 20,
    },
  },

  production: {
    ...commonConfig,
    pool: {
      min: 5,
      max: 30,
    },
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
  },
};
