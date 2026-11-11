#!/usr/bin/env node
// Development loop: build (development mode), start Electron on the build,
// then rebuild and restart whenever a source file changes.
//
//   node scripts/dev.mjs [--no-watch] [-- <arguments for the app, e.g. a realtimedocs:// link>]
//
// The app runs with its own profile directory (.stage/dev-profile, or
// RD_DESKTOP_USER_DATA when set), so a development run never touches the
// profile of an installed build. There is no hot reload and no dev server:
// the renderer is always served from app://realtimedocs with the production
// Content-Security-Policy, exactly as in a packaged build.
//
// Needs a desktop session (Windows, macOS, or Linux with a display).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { buildApp } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '../..');
const dist = path.join(root, 'dist');

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const own = separator === -1 ? argv : argv.slice(0, separator);
const appArgs = separator === -1 ? [] : argv.slice(separator + 1);
const watch = !own.includes('--no-watch');
for (const arg of own) {
  if (arg !== '--no-watch') {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const userData = path.resolve(
  process.env.RD_DESKTOP_USER_DATA || path.join(root, '.stage', 'dev-profile'),
);

let child = null;
let restarting = false;
let stopping = false;
let building = false;
let buildQueued = false;

function start() {
  child = spawn(electronPath, [dist, ...appArgs], {
    stdio: 'inherit',
    env: { ...process.env, RD_DESKTOP_USER_DATA: userData },
  });
  child.on('exit', (code) => {
    child = null;
    if (restarting) {
      // The previous instance has released the single-instance lock.
      restarting = false;
      start();
      return;
    }
    // Quitting the app (tray menu, Ctrl+C) ends the development loop.
    process.exit(stopping ? 0 : (code ?? 0));
  });
}

async function rebuild() {
  if (building) {
    buildQueued = true;
    return;
  }
  building = true;
  try {
    const started = Date.now();
    await buildApp({ mode: 'development' });
    console.log(`[dev] rebuilt in ${Date.now() - started} ms, restarting the app`);
    if (child) {
      restarting = true;
      child.kill('SIGTERM');
    } else {
      start();
    }
  } catch (error) {
    // Keep the running app: a syntax error must not end the loop.
    console.error(`[dev] build failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    building = false;
    if (buildQueued) {
      buildQueued = false;
      void rebuild();
    }
  }
}

function stop() {
  stopping = true;
  if (child) child.kill('SIGTERM');
  else process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await buildApp({ mode: 'development' });
console.log(`[dev] profile directory: ${userData}`);
start();

if (watch) {
  const watched = [
    path.join(root, 'src'),
    // Workspace packages the renderer and the main process are built from.
    path.join(repoRoot, 'packages', 'contracts', 'src'),
    path.join(repoRoot, 'packages', 'ui', 'src'),
    path.join(repoRoot, 'packages', 'editor', 'src'),
  ].filter((directory) => fs.existsSync(directory));
  let timer = null;
  for (const directory of watched) {
    fs.watch(directory, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 250);
    });
  }
  console.log(
    `[dev] watching ${watched.map((directory) => path.relative(repoRoot, directory)).join(', ')}`,
  );
}
