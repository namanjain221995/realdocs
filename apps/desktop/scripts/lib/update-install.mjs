// In-place update of a packaged installation: check an archive, unpack it next to the
// installation, verify what was unpacked, and hand the swap to a small detached helper script.
//
// Plain Node (no Electron), so the main process bundle and scripts/update-check.mjs use the very
// same code. Nothing here downloads anything and nothing here trusts a value from the network: the
// archive was already verified (size and SHA-256) by the update service, every path below is
// computed by the app from its own location, and the helper script contains only those paths.
//
// What protects the installation:
// - the archive listing is validated before unpacking (no absolute path, no "..", one expected
//   top-level folder, the expected executable) and the unpacked tree is walked afterwards (every
//   symbolic link must stay inside it);
// - the unpacked build must be the announced version, for this platform and architecture;
// - the swap is two renames on one volume; the previous installation is kept until the new
//   process has started and is moved back if anything fails.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'RealtimeDocs';
const LINUX_EXECUTABLE = 'realtimedocs';
const STAGING_PREFIX = '.rd-update-';
const BACKUP_PREFIX = '.rd-old-';
const SCRATCH_NAME = /^\.rd-(update|old)-[0-9a-f]{16}$/;

export class UpdateInstallError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'UpdateInstallError';
    this.code = code;
  }
}

/** The directory that is replaced as a whole, and the executable inside it. */
export function installationFor(platform, execPath) {
  if (platform === 'darwin') {
    const macos = path.dirname(execPath);
    const contents = path.dirname(macos);
    const bundle = path.dirname(contents);
    if (
      path.basename(macos) !== 'MacOS' ||
      path.basename(contents) !== 'Contents' ||
      !bundle.endsWith('.app')
    ) {
      return null;
    }
    return { root: bundle, executable: execPath };
  }
  if (platform !== 'win32' && platform !== 'linux') return null;
  const root = path.dirname(execPath);
  if (path.dirname(root) === root) return null;
  return { root, executable: execPath };
}

/** Path of the executable inside a build directory of this platform. */
export function executableIn(platform, root) {
  if (platform === 'darwin') return path.join(root, 'Contents', 'MacOS', APP_NAME);
  if (platform === 'win32') return path.join(root, `${APP_NAME}.exe`);
  return path.join(root, LINUX_EXECUTABLE);
}

function asarIn(platform, root) {
  return platform === 'darwin'
    ? path.join(root, 'Contents', 'Resources', 'app.asar')
    : path.join(root, 'resources', 'app.asar');
}

/**
 * Why this installation cannot be replaced in place, or null when it can. Every reason is a
 * sentence for the person; the caller then offers the manual download instead.
 */
export function installBlocker({ platform, execPath, env = process.env, probe = writableProbe }) {
  const installation = installationFor(platform, execPath);
  if (!installation) {
    return 'This copy of the app is not laid out like a packaged installation, so it cannot replace itself.';
  }
  const { root } = installation;
  if (platform === 'darwin' && root.includes('/AppTranslocation/')) {
    return 'macOS is running the app from a temporary, read-only copy because it was opened straight from the downloaded folder. Move RealtimeDocs to the Applications folder, open it from there, and update again.';
  }
  if (platform === 'linux' && env.APPIMAGE) {
    return 'An AppImage cannot replace itself. Download the new file and use it instead of the old one.';
  }
  if (platform === 'win32') {
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      // Unreadable: the probe below reports it.
    }
    if (names.some((name) => /^uninstall.*\.exe$/i.test(name))) {
      return 'This copy was installed with the installer. Download the new installer and run it; it replaces this version.';
    }
  }
  if (!probe(path.dirname(root)) || !probe(root)) {
    return 'Your account cannot change the folder the app is installed in (it may be read-only or belong to an administrator), so the app cannot replace itself there.';
  }
  return null;
}

/** True when a directory can be created and removed inside `directory`. */
export function writableProbe(directory) {
  const probe = path.join(directory, `.rd-probe-${randomBytes(6).toString('hex')}`);
  try {
    fs.mkdirSync(probe);
    fs.rmdirSync(probe);
    return true;
  } catch {
    return false;
  }
}

// ── Archive listing ────────────────────────────────────────────────────────

/**
 * Entries of a .zip, read from its central directory (no tool, nothing is unpacked).
 * @returns {{ name: string, symlink: boolean, directory: boolean }[]}
 */
export function readZipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLength);
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);
    let end = -1;
    for (let index = tailLength - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        end = index;
        break;
      }
    }
    if (end === -1) throw new UpdateInstallError('archive', 'The archive is not a zip file.');
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new UpdateInstallError(
        'archive',
        'The archive uses a zip format this app does not read.',
      );
    }
    if (directoryOffset + directorySize > size || directorySize > 64 * 1024 * 1024) {
      throw new UpdateInstallError('archive', 'The archive is damaged.');
    }
    const directory = Buffer.alloc(directorySize);
    fs.readSync(fd, directory, 0, directorySize, directoryOffset);
    const entries = [];
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      if (at + 46 > directorySize || directory.readUInt32LE(at) !== 0x02014b50) {
        throw new UpdateInstallError('archive', 'The archive is damaged.');
      }
      const madeBy = directory.readUInt16LE(at + 4) >> 8;
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const attributes = directory.readUInt32LE(at + 38);
      const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
      const mode = madeBy === 3 ? attributes >>> 16 : 0;
      entries.push({
        name,
        symlink: (mode & 0o170000) === 0o120000,
        directory: name.endsWith('/'),
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/** Top-level folder names an archive of this platform may have. */
function allowedTops(platform, arch) {
  if (platform === 'darwin') return [`${APP_NAME}.app`, `${APP_NAME}-darwin-${arch}`];
  return [`${APP_NAME}-${platform}-${arch}`];
}

/**
 * Checks a listing before anything is unpacked.
 * @param {{ name: string, symlink?: boolean }[]} entries
 * @returns {{ ok: true, buildRelative: string } | { ok: false, reason: string }}
 */
export function validateArchiveEntries(entries, { platform, arch }) {
  if (entries.length === 0) return { ok: false, reason: 'the archive is empty' };
  const tops = new Set();
  const names = new Set();
  for (const entry of entries) {
    const name = entry.name;
    if (typeof name !== 'string' || name === '' || name.includes('\0')) {
      return { ok: false, reason: 'the archive has an entry without a usable name' };
    }
    if (name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) {
      return { ok: false, reason: `the archive has an absolute or foreign path (${show(name)})` };
    }
    const segments = name.replace(/\/+$/, '').split('/');
    if (segments.some((segment) => segment === '..' || segment === '.' || segment === '')) {
      return { ok: false, reason: `the archive has a path that leaves its folder (${show(name)})` };
    }
    // `ditto --sequesterRsrc` keeps resource forks in this side folder; ditto merges them back.
    if (platform === 'darwin' && segments[0] === '__MACOSX') continue;
    if (entry.symlink && platform === 'win32') {
      return { ok: false, reason: `the archive has a link (${show(name)})` };
    }
    tops.add(segments[0]);
    names.add(segments.join('/'));
  }
  if (tops.size !== 1) {
    return { ok: false, reason: 'the archive does not hold exactly one application folder' };
  }
  const [top] = tops;
  if (!allowedTops(platform, arch).includes(top)) {
    return { ok: false, reason: `the archive holds ${show(top)}, not this app for this computer` };
  }
  const buildRelative =
    platform === 'darwin' && top !== `${APP_NAME}.app` ? `${top}/${APP_NAME}.app` : top;
  const executable =
    platform === 'darwin'
      ? `${buildRelative}/Contents/MacOS/${APP_NAME}`
      : platform === 'win32'
        ? `${buildRelative}/${APP_NAME}.exe`
        : `${buildRelative}/${LINUX_EXECUTABLE}`;
  if (!names.has(executable)) {
    return { ok: false, reason: 'the archive does not contain the application' };
  }
  return { ok: true, buildRelative };
}

function show(text) {
  return JSON.stringify(String(text).slice(0, 80));
}

/**
 * Walks an unpacked tree: only files, directories and links, and every link must point inside
 * the tree. Throws otherwise.
 */
export function verifyUnpackedTree(directory) {
  const base = fs.realpathSync(directory);
  const pending = [base];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const info = fs.lstatSync(full);
      count += 1;
      if (count > 200_000) {
        throw new UpdateInstallError('archive', 'The update holds more files than expected.');
      }
      if (info.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        const resolved = path.resolve(current, target);
        if (path.isAbsolute(target) || !isInside(base, resolved)) {
          throw new UpdateInstallError(
            'archive',
            'The update contains a link that points outside the application.',
          );
        }
      } else if (info.isDirectory()) {
        pending.push(full);
      } else if (!info.isFile()) {
        throw new UpdateInstallError(
          'archive',
          'The update contains something that is not a file.',
        );
      }
    }
  }
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// ── What was unpacked ──────────────────────────────────────────────────────

/** `version` of the package.json inside an app.asar, or null. */
export function readAsarVersion(asarFile) {
  let fd;
  try {
    fd = fs.openSync(asarFile, 'r');
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) !== 16) return null;
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    if (jsonLength <= 0 || jsonLength > 16 * 1024 * 1024 || jsonLength > headerSize) return null;
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    const index = JSON.parse(json.toString('utf8'));
    const entry = index?.files?.['package.json'];
    const size = Number(entry?.size);
    const offset = Number(entry?.offset);
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size > 1024 * 1024) {
      return null;
    }
    const content = Buffer.alloc(size);
    fs.readSync(fd, content, 0, size, 8 + headerSize + offset);
    const version = JSON.parse(content.toString('utf8'))?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Architecture of a Windows, Linux or macOS executable: 'x64', 'arm64', 'universal' or null. */
export function executableArch(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, 4096, 0);
    if (read < 64) return null;
    if (head[0] === 0x4d && head[1] === 0x5a) {
      const pe = head.readUInt32LE(0x3c);
      if (pe + 6 > read || head.readUInt32LE(pe) !== 0x00004550) return null;
      const machine = head.readUInt16LE(pe + 4);
      return machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : null;
    }
    if (head.readUInt32BE(0) === 0x7f454c46) {
      const machine = head.readUInt16LE(18);
      return machine === 62 ? 'x64' : machine === 183 ? 'arm64' : null;
    }
    if (head.readUInt32LE(0) === 0xfeedfacf) {
      const cpu = head.readUInt32LE(4);
      return cpu === 0x01000007 ? 'x64' : cpu === 0x0100000c ? 'arm64' : null;
    }
    if (head.readUInt32BE(0) === 0xcafebabe) return 'universal';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function listArchive(archive) {
  if (archive.endsWith('.zip')) return readZipEntries(archive);
  if (archive.endsWith('.tar.gz')) {
    const listing = await run('tar', ['-tzf', archive]);
    return listing
      .split('\n')
      .filter((line) => line !== '')
      .map((name) => ({ name, symlink: false, directory: name.endsWith('/') }));
  }
  throw new UpdateInstallError(
    'archive',
    'Only .zip and .tar.gz packages can be installed in place.',
  );
}

async function unpack(archive, destination, platform, env) {
  if (platform === 'win32') {
    // bsdtar ships with Windows 10 and later. Named by full path: never a `tar` found on PATH.
    const tar = path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (!fs.existsSync(tar)) {
      throw new UpdateInstallError('tool', 'This Windows has no built-in archive tool (tar.exe).');
    }
    await run(tar, ['-xf', archive, '-C', destination]);
    return;
  }
  if (platform === 'darwin') {
    await run('/usr/bin/ditto', ['-x', '-k', archive, destination]);
    return;
  }
  if (archive.endsWith('.tar.gz')) {
    await run('tar', ['-xzf', archive, '-C', destination]);
    return;
  }
  for (const [tool, args] of [
    ['unzip', ['-q', archive, '-d', destination]],
    ['bsdtar', ['-xf', archive, '-C', destination]],
  ]) {
    try {
      await run(tool, args);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new UpdateInstallError(
    'tool',
    'This computer has neither "unzip" nor "bsdtar", which unpack the update. Install one of them, or unpack the downloaded file yourself.',
  );
}

/**
 * Unpacks a verified archive into a new folder next to the installation and checks the result.
 * On any problem the folder is removed again and an UpdateInstallError is thrown; the
 * installation itself is not touched here.
 *
 * @returns {Promise<{ stagingDir: string, stagedRoot: string }>}
 */
export async function stageUpdate({
  archive,
  platform,
  arch,
  root,
  version,
  env = process.env,
  onPhase = () => {},
}) {
  onPhase('unpacking');
  const verdict = validateArchiveEntries(await listArchive(archive), { platform, arch });
  if (!verdict.ok) {
    throw new UpdateInstallError('archive', `The update was not unpacked: ${verdict.reason}.`);
  }
  const stagingDir = path.join(
    path.dirname(root),
    `${STAGING_PREFIX}${randomBytes(8).toString('hex')}`,
  );
  // Not recursive: an existing path of that name is an error, never reused.
  fs.mkdirSync(stagingDir, { mode: 0o700 });
  try {
    try {
      await unpack(archive, stagingDir, platform, env);
    } catch (error) {
      if (error instanceof UpdateInstallError) throw error;
      throw new UpdateInstallError('unpack', 'The update could not be unpacked.');
    }
    onPhase('checking');
    verifyUnpackedTree(stagingDir);
    const stagedRoot = path.join(stagingDir, ...verdict.buildRelative.split('/'));
    const executable = executableIn(platform, stagedRoot);
    let info;
    try {
      info = fs.statSync(executable);
    } catch {
      throw new UpdateInstallError(
        'verify',
        'The unpacked update does not contain the application.',
      );
    }
    if (!info.isFile() || (platform !== 'win32' && (info.mode & 0o111) === 0)) {
      throw new UpdateInstallError('verify', 'The application in the update cannot be started.');
    }
    const builtFor = executableArch(executable);
    if (builtFor !== arch && builtFor !== 'universal') {
      throw new UpdateInstallError(
        'verify',
        'The update was built for a different kind of processor.',
      );
    }
    const found = readAsarVersion(asarIn(platform, stagedRoot));
    if (found !== version) {
      throw new UpdateInstallError(
        'verify',
        `The update contains version ${found ?? 'unknown'}, not the announced ${version}.`,
      );
    }
    if (platform !== 'darwin') {
      // The whole folder is replaced. Anything in it that is not part of the app would be lost.
      const known = new Set(fs.readdirSync(stagedRoot));
      const extra = fs.readdirSync(root).filter((name) => !known.has(name));
      if (extra.length > 0) {
        throw new UpdateInstallError(
          'foreign',
          `The folder of the app also holds other things (${extra.slice(0, 3).map(show).join(', ')}). Replacing the folder would delete them, so nothing was changed.`,
        );
      }
    }
    return { stagingDir, stagedRoot };
  } catch (error) {
    removeScratch(stagingDir);
    throw error;
  }
}

/** Removes a staging or backup folder this module created (and nothing else). */
export function removeScratch(directory) {
  if (!SCRATCH_NAME.test(path.basename(directory))) return false;
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

/** Staging and backup folders next to an installation (left behind only by an interrupted update). */
export function findScratch(root) {
  try {
    return fs
      .readdirSync(path.dirname(root))
      .filter((name) => SCRATCH_NAME.test(name))
      .map((name) => path.join(path.dirname(root), name));
  } catch {
    return [];
  }
}

// ── Helper script ──────────────────────────────────────────────────────────

const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Arguments handed to the restarted app: plain switches only, nothing a shell could reinterpret. */
export function safeRelaunchArgs(args) {
  return args.filter((arg) => /^--[a-z0-9-]+(=[^"\r\n\0]*)?$/i.test(arg));
}

/**
 * The script that waits for the app to exit, swaps the folders and starts the new version.
 * Every value in it is a path computed by the app, or a number; all are quoted literals.
 *
 * Result protocol (files written by the script): `<ready>` as soon as it runs; `<result>` only
 * when the new version is NOT running at the end (`{"ok":false,"step":…}`), in which case the
 * previous installation is back in place and has been started again.
 */
export function buildHelperScript({
  platform,
  pid,
  root,
  stagedRoot,
  stagingDir,
  backupDir,
  executable,
  readyFile,
  resultFile,
  relaunchArgs = [],
}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('pid must be a positive integer');
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  for (const value of [
    root,
    stagedRoot,
    stagingDir,
    backupDir,
    executable,
    readyFile,
    resultFile,
  ]) {
    if (typeof value !== 'string' || !flavour.isAbsolute(value) || /[\r\n\0]/.test(value)) {
      throw new Error('helper paths must be absolute and single-line');
    }
  }
  const args = safeRelaunchArgs(relaunchArgs);
  if (platform === 'win32') {
    const quotedArgs = args.map((arg) => psQuote(`"${arg}"`)).join(', ');
    const content = `$ErrorActionPreference = 'Stop'
$AppPid = ${pid}
$Root = ${psQuote(root)}
$Staged = ${psQuote(stagedRoot)}
$Staging = ${psQuote(stagingDir)}
$Backup = ${psQuote(backupDir)}
$Exe = ${psQuote(executable)}
$Ready = ${psQuote(readyFile)}
$Result = ${psQuote(resultFile)}
$AppArgs = @(${quotedArgs})

function Finish([string]$step) {
  try { [System.IO.File]::WriteAllText($Result, '{"ok":false,"step":"' + $step + '"}') } catch {}
}
function Start-App {
  if ($AppArgs.Count -gt 0) {
    return Start-Process -FilePath $Exe -WorkingDirectory $Root -ArgumentList $AppArgs -PassThru
  }
  return Start-Process -FilePath $Exe -WorkingDirectory $Root -PassThru
}
function Remove-Scratch {
  Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
}

[System.IO.File]::WriteAllText($Ready, 'ready')

# 1. The running app must be gone.
$deadline = (Get-Date).AddSeconds(90)
while (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $deadline) { Remove-Scratch; Finish 'wait'; exit 1 }
  Start-Sleep -Milliseconds 250
}

# 2. Move the installation aside. Its other processes may hold files for a moment: retry.
$moved = $false
for ($i = 0; $i -lt 120; $i++) {
  try { [System.IO.Directory]::Move($Root, $Backup); $moved = $true; break }
  catch { Start-Sleep -Milliseconds 250 }
}
if (-not $moved) { Remove-Scratch; Finish 'backup'; Start-App | Out-Null; exit 1 }

# 3. Move the new version into place.
try { [System.IO.Directory]::Move($Staged, $Root) }
catch {
  try { [System.IO.Directory]::Move($Backup, $Root) } catch {}
  Remove-Scratch; Finish 'swap'; Start-App | Out-Null; exit 1
}

# 4. Start it; if it does not stay up, put the previous version back.
$started = $null
try { $started = Start-App } catch {}
Start-Sleep -Seconds 6
if (($null -eq $started) -or $started.HasExited) {
  Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
  try { [System.IO.Directory]::Move($Backup, $Root) } catch {}
  Remove-Scratch; Finish 'start'; Start-App | Out-Null; exit 1
}

# 5. Only now is the previous version removed.
Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
Remove-Scratch
Remove-Item -LiteralPath $Result -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
exit 0
`;
    // A byte-order mark: Windows PowerShell 5 reads a script without one in the ANSI code page.
    return { extension: '.ps1', content: `\uFEFF${content.replace(/\n/g, '\r\n')}` };
  }

  const quotedArgs = args.map(shQuote).join(' ');
  const start =
    platform === 'darwin'
      ? // LaunchServices starts the bundle as a normal application, detached from this script.
        `/usr/bin/open -n ${'"$ROOT"'}${quotedArgs ? ` --args ${quotedArgs}` : ''}`
      : `( cd "$ROOT" && exec "$EXE" ${quotedArgs} >/dev/null 2>&1 ) &`;
  const alive =
    platform === 'darwin'
      ? // On macOS `comm` is the full path of the executable.
        `ps -axo comm= | grep -Fqx -- "$EXE"`
      : `kill -0 "$NEW" 2>/dev/null`;
  const content = `#!/bin/sh
APP_PID=${pid}
ROOT=${shQuote(root)}
STAGED=${shQuote(stagedRoot)}
STAGING=${shQuote(stagingDir)}
BACKUP=${shQuote(backupDir)}
EXE=${shQuote(executable)}
READY=${shQuote(readyFile)}
RESULT=${shQuote(resultFile)}
NEW=0

finish() { printf '{"ok":false,"step":"%s"}\\n' "$1" > "$RESULT" 2>/dev/null; }
start_app() {
  ${start}
  NEW=$!
}
remove_scratch() { rm -rf -- "$STAGING"; }

printf 'ready\\n' > "$READY"

# 1. The running app must be gone.
i=0
while kill -0 "$APP_PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 360 ]; then remove_scratch; finish wait; exit 1; fi
  sleep 0.25
done

# 2. Move the installation aside.
if ! mv -- "$ROOT" "$BACKUP"; then remove_scratch; finish backup; start_app; exit 1; fi

# 3. Move the new version into place.
if ! mv -- "$STAGED" "$ROOT"; then
  mv -- "$BACKUP" "$ROOT"
  remove_scratch; finish swap; start_app; exit 1
fi

# 4. Start it; if it does not stay up, put the previous version back.
start_app
sleep 6
if ! ${alive}; then
  rm -rf -- "$ROOT"
  mv -- "$BACKUP" "$ROOT"
  remove_scratch; finish start; start_app; exit 1
fi

# 5. Only now is the previous version removed.
rm -rf -- "$BACKUP"
remove_scratch
rm -f -- "$RESULT" "$0"
exit 0
`;
  return { extension: '.sh', content };
}

/**
 * Writes the helper script into a private temporary folder and starts it detached. Resolves with
 * the paths once the script has reported that it runs; rejects (and removes what it wrote) when
 * it does not start, so the caller never quits the app without a helper waiting for it.
 */
export async function startSwapHelper({
  platform,
  pid,
  root,
  stagedRoot,
  stagingDir,
  resultFile,
  relaunchArgs = [],
  env = process.env,
  readyTimeoutMs = 15_000,
}) {
  const backupDir = path.join(
    path.dirname(root),
    `${BACKUP_PREFIX}${randomBytes(8).toString('hex')}`,
  );
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-update-helper-'));
  const readyFile = path.join(scriptDir, 'ready');
  const script = buildHelperScript({
    platform,
    pid,
    root,
    stagedRoot,
    stagingDir,
    backupDir,
    executable: executableIn(platform, root),
    readyFile,
    resultFile,
    relaunchArgs,
  });
  const scriptFile = path.join(scriptDir, `swap${script.extension}`);
  fs.writeFileSync(scriptFile, script.content, { mode: 0o700 });
  fs.rmSync(resultFile, { force: true });

  let command;
  let args;
  if (platform === 'win32') {
    command = path.join(
      env.SystemRoot ?? env.windir ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      scriptFile,
    ];
  } else {
    command = '/bin/sh';
    args = [scriptFile];
  }
  let failure = null;
  const child = spawn(command, args, {
    // Not inside the installation: a working directory there would keep the folder in use.
    cwd: scriptDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (error) => {
    failure = error;
  });
  child.unref();

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline && failure === null && !fs.existsSync(readyFile)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!fs.existsSync(readyFile)) {
    try {
      child.kill();
    } catch {
      // It never ran.
    }
    fs.rmSync(scriptDir, { recursive: true, force: true });
    throw new UpdateInstallError(
      'helper',
      platform === 'win32'
        ? 'Windows did not run the small script that swaps the versions (PowerShell may be blocked on this computer).'
        : 'The small script that swaps the versions could not be started.',
    );
  }
  return { backupDir, scriptDir, scriptFile };
}
