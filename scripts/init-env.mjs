#!/usr/bin/env node
// Creates `.env` from `.env.example` with freshly generated secrets.
// Never overwrites an existing file.
//
//   node scripts/init-env.mjs                 -> ./.env
//   node scripts/init-env.mjs --file <path>   -> another location (isolated test setups)
//   options: --port <server port> --db-port <postgres host port> --public-origin <origin>
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    port: { type: 'string' },
    'db-port': { type: 'string' },
    'public-origin': { type: 'string' },
  },
  strict: true,
});

const target = path.resolve(values.file ?? path.join(root, '.env'));
if (existsSync(target)) {
  console.log(`${target} already exists; it was not changed.`);
  process.exit(0);
}

for (const [flag, value] of [
  ['--port', values.port],
  ['--db-port', values['db-port']],
]) {
  if (value !== undefined && !/^[1-9][0-9]{0,4}$/.test(value)) {
    console.error(`${flag} must be a port number.`);
    process.exit(1);
  }
}

// URL-safe characters only, so the password can be embedded in DATABASE_URL as it is.
const secret = (bytes) => randomBytes(bytes).toString('base64url');
const postgresPassword = secret(24);
const sessionSecret = secret(48);
const port = values.port ?? '4310';
const dbPort = values['db-port'] ?? '54310';
const publicOrigin = values['public-origin'] ?? `http://127.0.0.1:${port}`;

// Every origin in ALLOWED_ORIGINS is trusted like PUBLIC_ORIGIN for cookie sessions. The Vite
// development origins are therefore only kept for a local setup on a loopback address; a
// deployment created with `--public-origin https://…` starts with an empty list.
const isLocalSetup = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$/.test(publicOrigin);
const allowedOrigins = isLocalSetup ? 'http://127.0.0.1:4311,http://localhost:4311' : '';

const replacements = new Map([
  ['POSTGRES_PASSWORD', postgresPassword],
  ['SESSION_SECRET', sessionSecret],
  ['DATABASE_URL', `postgres://realtimedocs:${postgresPassword}@127.0.0.1:${dbPort}/realtimedocs`],
  ['RD_PORT', port],
  ['RD_DB_PORT', dbPort],
  ['PUBLIC_ORIGIN', publicOrigin],
  ['ALLOWED_ORIGINS', allowedOrigins],
]);

const template = readFileSync(path.join(root, '.env.example'), 'utf8');
const seen = new Set();
const output = template
  .split('\n')
  .map((line) => {
    const match = /^([A-Z_]+)=/.exec(line);
    if (!match || !replacements.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${replacements.get(match[1])}`;
  })
  .join('\n');
for (const name of replacements.keys()) {
  if (!seen.has(name)) {
    console.error(`.env.example has no ${name}= line; refusing to write an incomplete file.`);
    process.exit(1);
  }
}

mkdirSync(path.dirname(target), { recursive: true });
// Owner-only: the file holds the database password and the session secret.
writeFileSync(target, output, { mode: 0o600, flag: 'wx' });
console.log(`Wrote ${target} with a generated database password and session secret.`);
console.log(
  isLocalSetup
    ? 'Local setup: the Vite development origins are listed in ALLOWED_ORIGINS so `pnpm dev` works.'
    : 'Deployment setup: ALLOWED_ORIGINS is empty; only PUBLIC_ORIGIN may use cookie sessions.',
);
console.log('Next: `pnpm db:up`, `pnpm db:migrate`, `pnpm bootstrap:admin`.');
