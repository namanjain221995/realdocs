#!/usr/bin/env node
// Diagnostic for the Windows runner: which way of starting the update helper in the background
// actually runs it? Each variant gets its own throw-away script; a variant passes when the script
// reports "ready". Nothing real is touched. Exits 1 on purpose so the job ends and its log is
// readable at once.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHelperScript } from './lib/update-install.mjs';

if (process.platform !== 'win32') {
  console.log('helper-probe: Windows only.');
  process.exit(0);
}
const powershell = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const base = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const variants = {
  'A current (detached, stdin ignore, -WindowStyle Hidden, -File)': (file, log) => ({
    args: [...base, '-WindowStyle', 'Hidden', '-File', file],
    options: { detached: true, stdio: ['ignore', log, log], windowsHide: true },
  }),
  'B no -WindowStyle': (file, log) => ({
    args: [...base, '-File', file],
    options: { detached: true, stdio: ['ignore', log, log], windowsHide: true },
  }),
  'C stdin pipe': (file, log) => ({
    args: [...base, '-WindowStyle', 'Hidden', '-File', file],
    options: { detached: true, stdio: ['pipe', log, log], windowsHide: true },
  }),
  'D not detached': (file, log) => ({
    args: [...base, '-WindowStyle', 'Hidden', '-File', file],
    options: { detached: false, stdio: ['ignore', log, log], windowsHide: true },
  }),
  'E -Command': (file, log) => ({
    args: [...base, '-WindowStyle', 'Hidden', '-Command', `& '${file.replace(/'/g, "''")}'`],
    options: { detached: true, stdio: ['ignore', log, log], windowsHide: true },
  }),
  'F detached, no windowsHide, no -WindowStyle': (file, log) => ({
    args: [...base, '-File', file],
    options: { detached: true, stdio: ['ignore', log, log] },
  }),
  'G all stdio ignore, no -WindowStyle': (file) => ({
    args: [...base, '-File', file],
    options: { detached: true, stdio: 'ignore', windowsHide: true },
  }),
};

for (const [name, make] of Object.entries(variants)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-helper-probe-'));
  const readyFile = path.join(dir, 'ready');
  const script = buildHelperScript({
    platform: 'win32',
    pid: 999999,
    root: path.join(dir, 'install dir', 'RealtimeDocs'),
    stagedRoot: path.join(dir, 'staging', 'RealtimeDocs'),
    stagingDir: path.join(dir, 'staging'),
    backupDir: path.join(dir, 'backup'),
    executable: path.join(dir, 'install dir', 'RealtimeDocs', 'RealtimeDocs.exe'),
    readyFile,
    resultFile: path.join(dir, 'result.json'),
    relaunchArgs: [],
  });
  const file = path.join(dir, 'swap.ps1');
  fs.writeFileSync(file, script.content);
  const logFile = path.join(dir, 'log.txt');
  const log = fs.openSync(logFile, 'w');
  const { args, options } = make(file, log);
  const started = Date.now();
  let exited = null;
  let failure = null;
  const child = spawn(powershell, args, { cwd: dir, ...options });
  child.on('exit', (code, signal) => {
    exited = { code, signal, afterMs: Date.now() - started };
  });
  child.on('error', (error) => {
    failure = error.message;
  });
  child.stdin?.end();
  fs.closeSync(log);
  while (Date.now() - started < 20_000 && !fs.existsSync(readyFile)) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const ready = fs.existsSync(readyFile);
  const said = fs.readFileSync(logFile, 'utf8').replace(/\s+/g, ' ').trim().slice(0, 300);
  console.log(
    `${ready ? 'RUNS ' : 'SILENT'} ${name}: ready after ${ready ? Date.now() - started : '-'} ms; exit ${JSON.stringify(exited)}; error ${failure}; said: ${said}`,
  );
  try {
    child.kill();
  } catch {
    // already gone
  }
}
process.exit(1);
