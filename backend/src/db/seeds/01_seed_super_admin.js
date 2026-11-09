const readline = require('node:readline/promises');
const { seedSuperAdmin } = require('../seed-super-admin');

/**
 * Requires the operator to type the exact remote host.
 * @param {{ host: string, display: string }} target
 * @returns {Promise<boolean>}
 */
const confirmRemoteHost = async (target) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await rl.question(
      `Type "${target.host}" to confirm seeding remote database ${target.display}: `
    );
    return answer.trim() === target.host;
  } finally {
    rl.close();
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  await seedSuperAdmin(knex, {
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    allowDestructiveSeed: process.env.ALLOW_DESTRUCTIVE_SEED,
    confirmRemote: process.env.SEED_CONFIRM_REMOTE,
    superAdminPassword: process.env.SEED_SUPER_ADMIN_PASSWORD,
    isInteractive: Boolean(process.stdin.isTTY),
    confirmHost: confirmRemoteHost,
    log: (message) => process.stdout.write(`${message}\n`),
  });
};
