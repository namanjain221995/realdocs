#!/usr/bin/env node
// Diagnostic for the native runners: writes the update helper script for this platform with
// throw-away paths and runs it in the foreground, so that whatever the script host says is
// visible. The script is expected to report "ready", find no installation to swap, and end with
// a non-zero status after writing its result file. Nothing real is touched.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHelperScript } from './lib/update-install.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-helper-probe-'));
const readyFile = path.join(dir, 'ready');
const resultFile = path.join(dir, 'result.json');
const script = buildHelperScript({
  platform: process.platform,
  pid: 999999,
  root: path.join(dir, 'install dir', 'RealtimeDocs'),
  stagedRoot: path.join(dir, 'staging', 'RealtimeDocs'),
  stagingDir: path.join(dir, 'staging'),
  backupDir: path.join(dir, 'backup'),
  executable: path.join(dir, 'install dir', 'RealtimeDocs', 'RealtimeDocs.exe'),
  readyFile,
  resultFile,
  relaunchArgs: [`--user-data-dir=${path.join(dir, 'profile dir')}`],
});
const file = path.join(dir, `swap${script.extension}`);
fs.writeFileSync(file, script.content);
console.log(`script: ${file} (${script.content.length} characters)`);
const started = Date.now();
const result =
  process.platform === 'win32'
    ? spawnSync(
        path.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
        { encoding: 'utf8', timeout: 150_000, cwd: dir },
      )
    : spawnSync('/bin/sh', [file], { encoding: 'utf8', timeout: 150_000, cwd: dir });
console.log(
  `ended after ${Date.now() - started} ms: status ${result.status}, signal ${result.signal}, error ${result.error?.message ?? 'none'}`,
);
console.log(`stdout: ${(result.stdout ?? '').slice(0, 2000)}`);
console.log(`stderr: ${(result.stderr ?? '').slice(0, 4000)}`);
console.log(`ready file written: ${fs.existsSync(readyFile)}`);
console.log(
  `result file: ${fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8') : 'none'}`,
);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fs.existsSync(readyFile) || result.status !== null ? 0 : 1);
