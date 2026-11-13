#!/usr/bin/env node
// End-to-end check of "Update and restart" on the host's own operating system.
//
//   node --import tsx apps/desktop/scripts/update-check.mjs [--arch x64|arm64] [--keep]
//
// Needs a packaged build of this platform in apps/desktop/out (scripts/package.mjs). It then
//   1. packages the same source once more as the next patch version (out-update/);
//   2. copies the first build into a scratch "installation" and starts it with its own profile;
//   3. serves the newer archive from a local HTTP server that answers the two requests the app
//      makes (the update manifest and the download);
//   4. runs the app's real update service (src/main/update-service.ts) and its real installer
//      (src/main/update-installer.ts, scripts/lib/update-install.mjs) against that server, with the
//      process id of the running app: check, download, SHA-256, unpack, verify, helper script;
//   5. ends the old process the way a quit would, and waits for the helper to swap and relaunch;
//   6. verifies: the old process is gone, a process runs from the SAME installation path, the
//      installed version is the new one and that process reported it, the profile is untouched,
//      and no staging or backup folder is left.
//
// EXERCISED: update check, download, checksum, unpacking, verification of the unpacked build, the
// helper script, the swap and the relaunch, all with the code the app ships.
// NOT EXERCISED: the click in Settings, the IPC call, and the app quitting itself. A packaged
// build accepts no debugger and has no test hook, so it cannot be driven from outside; this
// script ends the old process instead. The Settings flow is covered by unit and smoke tests.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { APP_NAME, executableIn, findScratch, readAsarVersion } from './lib/update-install.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: process.arch },
    keep: { type: 'boolean', default: false },
    out: { type: 'string', default: path.join(desktopRoot, 'out') },
  },
});
const platform = process.platform;
const arch = values.arch;
const PUBLIC = { win32: 'windows', darwin: 'macos', linux: 'linux' };

const lines = [];
let failed = false;
function check(ok, name, detail = '') {
  if (!ok) failed = true;
  const line = `${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`;
  lines.push(line);
  console.log(line);
}
function stop(message) {
  console.error(`update-check: ${message}`);
  console.log(`RESULT: update check did not run (${message})`);
  process.exit(1);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!['win32', 'darwin', 'linux'].includes(platform)) stop(`unsupported platform ${platform}`);
if (arch !== process.arch)
  stop(`this host is ${process.arch}; a ${arch} build is not started here`);

const baseDir = path.join(values.out, `${APP_NAME}-${platform}-${arch}`);
const baseBuild = platform === 'darwin' ? path.join(baseDir, `${APP_NAME}.app`) : baseDir;
if (!fs.existsSync(executableIn(platform, baseBuild))) {
  stop(`no packaged build at ${baseBuild}; run scripts/package.mjs first`);
}
const asarOf = (root) =>
  platform === 'darwin'
    ? path.join(root, 'Contents', 'Resources', 'app.asar')
    : path.join(root, 'resources', 'app.asar');
const oldVersion = readAsarVersion(asarOf(baseBuild));
if (!oldVersion) stop('the packaged build has no readable version');
const [major, minor, patch] = oldVersion.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;

// ── 1. The newer build ──────────────────────────────────────────────────────
const updateOut = path.join(desktopRoot, 'out-update');
console.log(`Installed version ${oldVersion}; packaging ${newVersion} into ${updateOut}`);
fs.rmSync(updateOut, { recursive: true, force: true });
const packaged = spawnSync(
  process.execPath,
  [
    path.join(here, 'package.mjs'),
    '--platform',
    platform,
    '--arch',
    arch,
    '--app-version',
    newVersion,
    '--out',
    updateOut,
    '--no-inspect',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
if (packaged.status !== 0) stop('packaging the newer version failed');
// The .zip where the host can write one; on a Linux host without `zip`, the .tar.gz.
const fileName = [`.zip`, `.tar.gz`]
  .map((extension) => `${APP_NAME}-${newVersion}-${PUBLIC[platform]}-${arch}${extension}`)
  .find((name) => fs.existsSync(path.join(updateOut, name)));
if (!fileName) stop('the newer package was not written');
const archive = path.join(updateOut, fileName);
console.log(`Update package: ${fileName}`);
const archiveBytes = fs.statSync(archive).size;
const archiveSha = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');

// ── 2. A scratch installation ───────────────────────────────────────────────
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-update-check-')));
const installParent = path.join(scratch, 'install dir');
const root = path.join(installParent, path.basename(baseBuild));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(installParent, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
if (platform === 'darwin') {
  // ditto keeps the bundle exactly (links, attributes, the ad-hoc signature).
  if (spawnSync('/usr/bin/ditto', [baseBuild, root]).status !== 0)
    stop('could not copy the bundle');
} else {
  fs.cpSync(baseBuild, root, { recursive: true, verbatimSymlinks: true });
}
const executable = executableIn(platform, root);
const marker = path.join(profile, 'keep-me.txt');
fs.writeFileSync(marker, 'this file belongs to the person');

const appArgs = [`--user-data-dir=${profile}`];
if (platform === 'linux' && process.env.RD_LAUNCH_NO_SANDBOX === '1') appArgs.push('--no-sandbox');

function processesFromInstallation() {
  if (platform === 'win32') {
    const listing = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }',
      ],
      { encoding: 'utf8' },
    );
    return listing.stdout
      .split(/\r?\n/)
      .map((line) => line.split('|'))
      .filter(([, file]) => file && file.toLowerCase() === executable.toLowerCase())
      .map(([pid]) => Number(pid));
  }
  const listing = spawnSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
  return listing.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(executable) && !line.includes('--type='))
    .map((line) => Number(line.split(/\s+/)[0]));
}
function killAll() {
  for (const pid of processesFromInstallation()) {
    if (platform === 'win32')
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let server;
try {
  // ── 3. The server the app would ask ───────────────────────────────────────
  const requests = [];
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(url.pathname);
    if (url.pathname === '/api/v1/desktop/update') {
      const body = JSON.stringify({
        updateAvailable: true,
        required: false,
        version: newVersion,
        notes: 'update-check',
        downloadUrl: `/download/releases/stable/${newVersion}/${fileName}`,
        sha256: archiveSha,
        sizeBytes: archiveBytes,
        signatureStatus: 'unsigned',
        releaseNotesUrl: null,
        fileName,
      });
      response.writeHead(200, { 'content-type': 'application/json' }).end(body);
    } else if (url.pathname === `/download/releases/stable/${newVersion}/${fileName}`) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(archiveBytes),
      });
      fs.createReadStream(archive).pipe(response);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // ── The installed app, running ────────────────────────────────────────────
  console.log(`Starting ${executable}`);
  const app = spawn(executable, appArgs, { stdio: 'ignore', cwd: scratch });
  let appExit = null;
  app.on('exit', (code, signal) => {
    appExit = { code, signal };
  });
  await wait(12_000);
  check(appExit === null, `the installed version ${oldVersion} is running`, `pid ${app.pid}`);
  if (appExit !== null) throw new Error(`the app ended at once: ${JSON.stringify(appExit)}`);
  const profileUsed = fs.readdirSync(profile).length > 1;
  check(profileUsed, 'the app uses the given profile folder');

  // ── 4. The app's own update code against that server ──────────────────────
  const { UpdateService } = await import('../src/main/update-service.ts');
  const { createAppInstaller } = await import('../src/main/update-installer.ts');
  const stages = [];
  let service;
  const installer = createAppInstaller({
    platform,
    arch,
    execPath: executable,
    packaged: true,
    pid: app.pid,
    argv: appArgs,
    env: process.env,
    // What `app.quit()` leads to: the process ends. (The real quit also saves preferences.)
    quit: () => {
      if (platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        app.kill('SIGTERM');
        setTimeout(() => appExit === null && app.kill('SIGKILL'), 5000).unref();
      }
    },
  });
  check(
    installer.blocker() === null,
    'this installation may replace itself',
    installer.blocker() ?? '',
  );
  service = new UpdateService({
    installer,
    fetch: (url, init) => fetch(url, init),
    getServerOrigin: () => origin,
    appVersion: oldVersion,
    platform: PUBLIC[platform],
    arch,
    schemaVersion: 1,
    protocolVersion: 1,
    stateFile: path.join(profile, 'update-check-state.json'),
    downloadsDir: () => path.join(scratch, 'Downloads'),
    showItemInFolder: () => undefined,
    openPath: async () => '',
    onChange: () => {
      const stage = service?.snapshot().stage;
      if (stage && stages[stages.length - 1] !== stage) stages.push(stage);
    },
  });
  await service.check();
  check(service.snapshot().status === 'available', `the update to ${newVersion} is offered`);
  await service.install();
  const after = service.snapshot();
  check(
    after.stage === 'restarting',
    'download, checksum, unpacking and verification passed; helper started',
    after.stage === 'restarting' ? stages.join(' → ') : `${after.status}: ${after.message}`,
  );
  if (after.stage !== 'restarting') throw new Error('the update was not handed over');

  // ── 5 + 6. The swap and the relaunch ──────────────────────────────────────
  const history = path.join(profile, 'update-history.json');
  const result = path.join(profile, 'update-result.json');
  let record = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await wait(1000);
    if (fs.existsSync(history)) {
      try {
        record = JSON.parse(fs.readFileSync(history, 'utf8'));
        break;
      } catch {
        // Being written.
      }
    }
    if (fs.existsSync(result)) break;
  }
  // The helper removes the previous version a few seconds after the new one started.
  await wait(9000);
  const helperResult = fs.existsSync(result) ? fs.readFileSync(result, 'utf8').trim() : null;
  check(!isRunning(app.pid), 'the old process is gone');
  const now = processesFromInstallation();
  check(
    now.length > 0,
    'a process runs from the same installation path',
    `pid ${now.join(', ') || 'none'}`,
  );
  check(
    readAsarVersion(asarOf(root)) === newVersion,
    `the installation is version ${newVersion}`,
    `found ${readAsarVersion(asarOf(root))}`,
  );
  check(
    record?.ok === true && record?.runningVersion === newVersion,
    `the restarted app reports that it runs ${newVersion}`,
    record ? JSON.stringify(record) : `no record; helper result: ${helperResult ?? 'none'}`,
  );
  check(
    fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === 'this file belongs to the person',
    'the profile folder was not touched',
  );
  const leftovers = findScratch(root);
  check(leftovers.length === 0, 'no staging or backup folder is left', leftovers.join(', '));
  check(helperResult === null, 'the helper reported no failure', helperResult ?? '');
} catch (error) {
  check(false, 'run', String(error?.message ?? error).split('\n')[0]);
} finally {
  killAll();
  server?.close();
  await wait(1500);
  if (!values.keep) {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    fs.rmSync(updateOut, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}
console.log(
  failed
    ? `RESULT: UPDATE CHECK FAILED on ${platform}-${arch} (${lines.filter((line) => line.startsWith('FAIL')).length} check(s)).`
    : `RESULT: ${APP_NAME} ${platform}-${arch} updated itself from ${oldVersion} to ${newVersion} and restarted (service, installer and helper exercised; the click and the app's own quit were not).`,
);
process.exit(failed ? 1 : 0);
