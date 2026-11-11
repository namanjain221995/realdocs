#!/usr/bin/env node
// Checks that a WebSocket reaches the collaboration endpoint through the public
// address (Cloudflare edge -> tunnel -> server).
//
//   . scripts/dev-env.sh; node deploy/checks/ws-check.mjs [public origin] [target]
//
// The public origin defaults to https://realdocs.techsarasolutions.com. The
// target is the address that is dialled and defaults to the public origin; give
// http://127.0.0.1:4310 to ask the server directly, without Cloudflare, when
// you need to tell a tunnel problem from a server problem.
// Two sockets are opened on <target>/collab (as ws:// or wss://) and nothing is sent:
//
//   own origin      the upgrade succeeds and the socket stays open until the
//                   server closes it at its authentication deadline (15 s)
//                   with close code 1008 "authentication_failed";
//   foreign origin  the upgrade succeeds, then the server closes at once with
//                   close code 4400 "bad_origin".
//
// Exit status 0 when both behave like that, 1 otherwise. No account, session
// or secret is involved. This proves that WSS reaches the endpoint and that the
// server sees the real Origin header; it does not test document editing.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// `ws` is a dependency of the server package; no extra install is needed.
const require = createRequire(path.join(root, 'apps/server/package.json'));
const { WebSocket } = require('ws');

const withoutSlash = (value) => value.replace(/\/+$/, '');
const publicOrigin = withoutSlash(process.argv[2] ?? 'https://realdocs.techsarasolutions.com');
const target = withoutSlash(process.argv[3] ?? publicOrigin);
const url = `${target.replace(/^http/, 'ws')}/collab`;
const FOREIGN_ORIGIN = 'https://evil.example';
// The server's deadline is 15 s; allow for the network on top of it.
const GIVE_UP_MS = 25_000;

/** Opens one socket and resolves with what happened to it. */
function probe(origin) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const result = {
      origin,
      upgradeStatus: null,
      servedBy: null,
      openAfterMs: null,
      frames: 0,
      closeCode: null,
      closeReason: null,
      closedAfterOpenMs: null,
      closedBy: null,
      error: null,
    };
    const ws = new WebSocket(url, { origin, handshakeTimeout: 15_000 });
    let openedAt = null;
    const giveUp = setTimeout(() => {
      result.closedBy = 'this script (still open after the waiting time)';
      ws.close(1000, 'check finished');
    }, GIVE_UP_MS);

    ws.on('upgrade', (response) => {
      result.upgradeStatus = response.statusCode;
      result.servedBy = response.headers.server ?? null;
    });
    ws.on('unexpected-response', (_request, response) => {
      result.upgradeStatus = response.statusCode;
      result.servedBy = response.headers.server ?? null;
      result.error = `the upgrade was answered with HTTP ${response.statusCode}`;
      response.resume();
    });
    ws.on('open', () => {
      openedAt = performance.now();
      result.openAfterMs = Math.round(openedAt - startedAt);
    });
    ws.on('message', () => {
      result.frames += 1;
    });
    ws.on('error', (error) => {
      result.error ??= error.message;
    });
    ws.on('close', (code, reason) => {
      clearTimeout(giveUp);
      result.closeCode = code;
      result.closeReason = reason.toString('utf8');
      result.closedBy ??= 'the server';
      if (openedAt !== null) result.closedAfterOpenMs = Math.round(performance.now() - openedAt);
      resolve(result);
    });
  });
}

function describe(label, result) {
  console.log(`${label} (Origin: ${result.origin})`);
  console.log(
    `  upgrade answer        ${result.upgradeStatus ?? 'none'} (server: ${result.servedBy ?? 'unknown'})`,
  );
  console.log(
    `  opened                ${result.openAfterMs === null ? 'no' : `yes, after ${result.openAfterMs} ms`}`,
  );
  console.log(`  frames received       ${result.frames}`);
  console.log(`  close code / reason   ${result.closeCode} / "${result.closeReason}"`);
  console.log(
    `  closed                ${result.closedAfterOpenMs === null ? 'never opened' : `${result.closedAfterOpenMs} ms after opening`}, by ${result.closedBy}`,
  );
  if (result.error) console.log(`  error                 ${result.error}`);
}

console.log(`WebSocket check of ${url} at ${new Date().toISOString()}`);
const [own, foreign] = await Promise.all([probe(publicOrigin), probe(FOREIGN_ORIGIN)]);
describe('1. own origin', own);
describe('2. foreign origin', foreign);

const ownOk =
  own.openAfterMs !== null &&
  own.closedBy === 'the server' &&
  own.closeCode === 1008 &&
  own.closedAfterOpenMs >= 13_000 &&
  own.closedAfterOpenMs <= 20_000;
const foreignOk =
  foreign.openAfterMs !== null && foreign.closeCode === 4400 && foreign.closedAfterOpenMs < 5_000;

console.log('');
console.log(
  `own origin: ${ownOk ? 'as designed' : 'NOT as designed'} (expected: open, then 1008 from the server about 15 s later)`,
);
console.log(
  `foreign origin: ${foreignOk ? 'as designed' : 'NOT as designed'} (expected: open, then 4400 "bad_origin" at once)`,
);
process.exit(ownOk && foreignOk ? 0 : 1);
