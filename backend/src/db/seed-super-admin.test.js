const fs = require('fs');
const path = require('path');

const seedModule = require('./seeds/01_seed_super_admin');

const SEED_PATH = path.join(__dirname, 'seeds', '01_seed_super_admin.js');
const ENV_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'ALLOW_DESTRUCTIVE_SEED',
  'SEED_CONFIRM_REMOTE',
  'SEED_SUPER_ADMIN_PASSWORD',
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const restoreEnv = () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
};

describe('P1-16 super-admin seed safety', () => {
  afterEach(restoreEnv);

  it('refuses production before opening a transaction', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://lottrace:lottrace@localhost:5432/lottrace_test';

    const knex = { transaction: jest.fn() };

    await expect(seedModule.seed(knex)).rejects.toThrow(/NODE_ENV=production/);
    expect(knex.transaction).not.toHaveBeenCalled();
  });

  it('contains no TRUNCATE statement', () => {
    const source = fs.readFileSync(SEED_PATH, 'utf8');
    expect(source).not.toMatch(/TRUNCATE/i);
  });

  it('contains no hardcoded admin123 password', () => {
    const source = fs.readFileSync(SEED_PATH, 'utf8');
    expect(source).not.toMatch(/admin123/);
  });

  it('generates a password when no override is set', () => {
    const result = seedModule.resolveSeedPassword({});

    expect(result.source).toBe('generated');
    expect(result.value.length).toBeGreaterThanOrEqual(12);
  });

  it('uses SEED_SUPER_ADMIN_PASSWORD when it is set', () => {
    const result = seedModule.resolveSeedPassword({
      SEED_SUPER_ADMIN_PASSWORD: 'a-long-enough-password',
    });

    expect(result).toEqual({ value: 'a-long-enough-password', source: 'env' });
  });

  it('rejects a short SEED_SUPER_ADMIN_PASSWORD', () => {
    expect(() =>
      seedModule.resolveSeedPassword({ SEED_SUPER_ADMIN_PASSWORD: 'too-short' }),
    ).toThrow(/at least 12 characters/);
  });
});
