/**
 * P2-06 — static verification for local infrastructure hardening.
 *
 * Run with: node --test scripts/verify-compose.test.mjs
 *
 * This does not start Docker. It fails when compose reintroduces a known
 * default password, publishes a port beyond loopback, or drops the required
 * environment interpolation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const compose = read('docker-compose.yml');
const rootEnvExample = read('.env.example');
const backendEnvExample = read('backend/.env.example');

const serviceBlock = (name) => {
  const start = compose.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `docker-compose.yml is missing the ${name} service`);

  const rest = compose.slice(start + 1);
  const next = rest.search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
};

test('compose requires every infrastructure value from the environment', () => {
  for (const name of [
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'MINIO_ROOT_PASSWORD',
    'MINIO_BUCKET',
    'MINIO_APP_ACCESS_KEY',
    'MINIO_APP_SECRET_KEY',
    'PGADMIN_DEFAULT_PASSWORD',
  ]) {
    assert.ok(
      compose.includes(`${name}: \${${name}:?`),
      `${name} must use required compose interpolation`,
    );
  }
});

test('compose no longer contains known default passwords', () => {
  for (const value of ['lottrace:lottrace', 'minioadmin', 'admin123']) {
    assert.ok(!compose.includes(value), `docker-compose.yml still contains "${value}"`);
  }
});

test('every compose image is pinned to an immutable digest', () => {
  const images = [...compose.matchAll(/^\s+image:\s*(\S+)\s*$/gm)].map((match) => match[1]);

  assert.ok(images.length >= 6, `expected at least 6 pinned services, found ${images.length}`);
  for (const image of images) {
    assert.match(
      image,
      /^[\w./-]+@sha256:[a-f0-9]{64}$/,
      `image must be pinned to a sha256 digest: ${image}`,
    );
    assert.ok(!image.includes(':latest'), `image still uses a floating tag: ${image}`);
  }
});

test('minio-init bootstraps the bucket and a least-privilege app user', () => {
  const init = serviceBlock('minio-init');
  const minio = serviceBlock('minio');

  const digest = minio.match(/image:\s*(\S+)/)[1];
  assert.ok(init.includes(`image: ${digest}`), 'minio-init must reuse the pinned MinIO image');

  assert.match(init, /MINIO_ROOT_PASSWORD: \$\{MINIO_ROOT_PASSWORD:\?/);
  assert.match(init, /MINIO_BUCKET: \$\{MINIO_BUCKET:\?/);
  assert.match(init, /MINIO_APP_ACCESS_KEY: \$\{MINIO_APP_ACCESS_KEY:\?/);
  assert.match(init, /MINIO_APP_SECRET_KEY: \$\{MINIO_APP_SECRET_KEY:\?/);

  assert.match(init, /mc alias set local http:\/\/minio:9000/);
  assert.match(init, /mc mb --ignore-existing/);
  assert.match(init, /mc admin policy create local lottrace-app/);
  assert.match(init, /mc admin user add local/);
  assert.match(init, /mc admin policy attach local lottrace-app --user/);
  assert.match(init, /s3:ListBucket/);
  assert.match(init, /s3:GetObject/);
  assert.match(init, /s3:PutObject/);
  assert.match(init, /s3:DeleteObject/);

  assert.match(init, /condition: service_healthy/, 'minio-init must wait for MinIO health');
  assert.match(minio, /healthcheck:/, 'minio needs a healthcheck');
  assert.ok(!/ports:/.test(init), 'minio-init must not publish a port');
});

test('every published port binds to loopback only', () => {
  const portLines = compose
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s*["']?[\d.]+:\d+:\d+/.test(line));

  assert.ok(portLines.length > 0, 'docker-compose.yml publishes no ports');
  for (const line of portLines) {
    assert.match(line, /^-\s*["']?127\.0\.0\.1:\d+:\d+/, `port is not loopback-only: ${line}`);
  }
});

test('admin consoles are opt-in tools', () => {
  for (const name of ['pgadmin', 'redisinsight']) {
    assert.match(
      serviceBlock(name),
      /profiles:\s*(?:\[["']?tools["']?\]|["']?tools["']?)/,
      `${name} must stay behind the tools profile`,
    );
  }
});

test('redis requires a password for every connection', () => {
  const redis = serviceBlock('redis');

  assert.match(redis, /REDIS_PASSWORD: \$\{REDIS_PASSWORD:\?/);
  assert.match(redis, /--requirepass/);
  assert.match(redis, /redis-cli .*--no-auth-warning/);
});

test('root .env.example lists every required secret with no value', () => {
  const lines = rootEnvExample.split('\n');

  for (const name of [
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'MINIO_ROOT_PASSWORD',
    'PGADMIN_DEFAULT_PASSWORD',
  ]) {
    const line = lines.find((entry) => entry.startsWith(`${name}=`));
    assert.ok(line, `.env.example is missing ${name}`);
    assert.equal(line, `${name}=`, `${name} must be blank until the developer generates it`);
  }

  assert.ok(!rootEnvExample.includes('lottrace:lottrace'));
  assert.ok(!rootEnvExample.includes('minioadmin'));
  assert.ok(!rootEnvExample.includes('admin123'));
});

test('root .env.example declares the MinIO bucket and app credentials', () => {
  const lines = rootEnvExample.split('\n');
  const valueOf = (name) => lines.find((entry) => entry.startsWith(`${name}=`));

  assert.equal(valueOf('MINIO_BUCKET'), 'MINIO_BUCKET=lottrace-dev');
  assert.equal(valueOf('MINIO_APP_ACCESS_KEY'), 'MINIO_APP_ACCESS_KEY=');
  assert.equal(valueOf('MINIO_APP_SECRET_KEY'), 'MINIO_APP_SECRET_KEY=');
});

test('backend .env.example uses the MinIO app user, not the root user', () => {
  assert.match(backendEnvExample, /S3_ACCESS_KEY_ID=<minio-app-access-key>/);
  assert.match(backendEnvExample, /S3_SECRET_ACCESS_KEY=<minio-app-secret-key>/);
  assert.match(backendEnvExample, /S3_BUCKET=lottrace-dev/);
  assert.ok(!backendEnvExample.includes('<minio-root-user>'));
  assert.ok(!backendEnvExample.includes('<minio-root-password>'));
});

test('backend .env.example no longer ships default credentials', () => {
  assert.ok(!backendEnvExample.includes('lottrace:lottrace'));
  assert.ok(!backendEnvExample.includes('minioadmin'));
  assert.match(
    backendEnvExample,
    /DATABASE_URL=postgresql:\/\/lottrace:<postgres-password>@127\.0\.0\.1:5432\/lottrace/,
  );
  assert.match(backendEnvExample, /REDIS_URL=redis:\/\/:<redis-password>@127\.0\.0\.1:6379/);
  assert.match(backendEnvExample, /S3_ENDPOINT=http:\/\/127\.0\.0\.1:9000/);
});
