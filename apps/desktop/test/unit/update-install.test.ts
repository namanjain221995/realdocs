import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildHelperScript,
  executableArch,
  findScratch,
  installBlocker,
  installationFor,
  readAsarVersion,
  readZipEntries,
  safeRelaunchArgs,
  stageUpdate,
  startSwapHelper,
  validateArchiveEntries,
  verifyUnpackedTree,
} from '../../scripts/lib/update-install.mjs';
import {
  UpdateService,
  type StagedUpdate,
  type UpdateInstaller,
  type UpdateServiceOptions,
} from '../../src/main/update-service';
import { INSTALL_STAGES, installFailureMessage } from '../../src/shared/updates';

// ── Fixtures ───────────────────────────────────────────────────────────────

interface ZipInput {
  name: string;
  data?: Buffer;
  /** Unix mode; 0o120777 makes a symbolic link whose data is the target. */
  mode?: number;
}

/** A stored (uncompressed) zip, written by hand so every field is under the test's control. */
function makeZip(entries: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data ?? Buffer.alloc(0);
    const mode = entry.mode ?? (entry.name.endsWith('/') ? 0o040755 : 0o100644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(zlib.crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(zlib.crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A minimal app.asar that holds only package.json. */
function makeAsar(version: string): Buffer {
  const manifest = Buffer.from(JSON.stringify({ name: 'realtimedocs', version }));
  const index = Buffer.from(
    JSON.stringify({ files: { 'package.json': { size: manifest.length, offset: '0' } } }),
  );
  const padded = Math.ceil(index.length / 4) * 4;
  const head = Buffer.alloc(16 + padded);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded, 4);
  head.writeUInt32LE(4 + padded, 8);
  head.writeUInt32LE(index.length, 12);
  index.copy(head, 16);
  return Buffer.concat([head, manifest]);
}

function elf(machine: number): Buffer {
  const header = Buffer.alloc(128);
  header.writeUInt32BE(0x7f454c46, 0);
  header.writeUInt16LE(machine, 18);
  return header;
}

function pe(machine: number): Buffer {
  const header = Buffer.alloc(256);
  header.write('MZ', 0, 'latin1');
  header.writeUInt32LE(0x80, 0x3c);
  header.writeUInt32LE(0x00004550, 0x80);
  header.writeUInt16LE(machine, 0x84);
  return header;
}

let work: string;
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-install-test-')));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

// ── Archive listing ────────────────────────────────────────────────────────

describe('archive listing', () => {
  const linux = { platform: 'linux' as const, arch: 'x64' };
  const good = [
    { name: 'RealtimeDocs-linux-x64/' },
    { name: 'RealtimeDocs-linux-x64/realtimedocs' },
    { name: 'RealtimeDocs-linux-x64/resources/app.asar' },
  ];

  it('reads names and links from the central directory of a zip', () => {
    const file = path.join(work, 'a.zip');
    fs.writeFileSync(
      file,
      makeZip([
        { name: 'App/' },
        { name: 'App/file.txt', data: Buffer.from('x') },
        { name: 'App/link', data: Buffer.from('file.txt'), mode: 0o120777 },
        { name: 'App/é ü.txt' },
      ]),
    );
    expect(readZipEntries(file)).toEqual([
      { name: 'App/', symlink: false, directory: true },
      { name: 'App/file.txt', symlink: false, directory: false },
      { name: 'App/link', symlink: true, directory: false },
      { name: 'App/é ü.txt', symlink: false, directory: false },
    ]);
    fs.writeFileSync(file, 'not a zip at all');
    expect(() => readZipEntries(file)).toThrow(/not a zip/);
  });

  it('accepts the one expected folder with the application in it', () => {
    expect(validateArchiveEntries(good, linux)).toEqual({
      ok: true,
      buildRelative: 'RealtimeDocs-linux-x64',
    });
    expect(
      validateArchiveEntries([{ name: 'RealtimeDocs-win32-arm64/RealtimeDocs.exe' }], {
        platform: 'win32',
        arch: 'arm64',
      }),
    ).toMatchObject({ ok: true });
  });

  it('accepts both macOS layouts and ignores the resource-fork side folder', () => {
    const mac = { platform: 'darwin' as const, arch: 'arm64' };
    expect(
      validateArchiveEntries(
        [
          { name: 'RealtimeDocs.app/Contents/MacOS/RealtimeDocs' },
          { name: 'RealtimeDocs.app/Contents/Frameworks/x', symlink: true },
          { name: '__MACOSX/RealtimeDocs.app/._x' },
        ],
        mac,
      ),
    ).toEqual({ ok: true, buildRelative: 'RealtimeDocs.app' });
    expect(
      validateArchiveEntries(
        [{ name: 'RealtimeDocs-darwin-arm64/RealtimeDocs.app/Contents/MacOS/RealtimeDocs' }],
        mac,
      ),
    ).toEqual({ ok: true, buildRelative: 'RealtimeDocs-darwin-arm64/RealtimeDocs.app' });
  });

  it.each([
    ['a parent path', '../evil'],
    ['a parent path further in', 'RealtimeDocs-linux-x64/../../evil'],
    ['an absolute path', '/etc/passwd'],
    ['a drive letter', 'C:/Windows/x'],
    ['a backslash path', 'RealtimeDocs-linux-x64\\..\\x'],
    ['a second top-level folder', 'Other/file'],
    ['a NUL byte', 'RealtimeDocs-linux-x64/a\0b'],
    ['an empty segment', 'RealtimeDocs-linux-x64//x'],
  ])('refuses %s', (_label, name) => {
    expect(validateArchiveEntries([...good, { name }], linux).ok).toBe(false);
  });

  it('refuses the wrong folder, another architecture, a missing application and an empty archive', () => {
    expect(validateArchiveEntries([{ name: 'Something/realtimedocs' }], linux).ok).toBe(false);
    expect(validateArchiveEntries(good, { platform: 'linux', arch: 'arm64' })).toMatchObject({
      ok: false,
    });
    expect(
      validateArchiveEntries([{ name: 'RealtimeDocs-linux-x64/readme.txt' }], linux),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('does not contain') });
    expect(validateArchiveEntries([], linux).ok).toBe(false);
  });

  it('refuses a link in a Windows archive', () => {
    expect(
      validateArchiveEntries(
        [
          { name: 'RealtimeDocs-win32-x64/RealtimeDocs.exe' },
          { name: 'RealtimeDocs-win32-x64/link', symlink: true },
        ],
        { platform: 'win32', arch: 'x64' },
      ).ok,
    ).toBe(false);
  });
});

describe('unpacked tree', () => {
  it.skipIf(process.platform === 'win32')(
    'accepts links that stay inside and refuses links that leave',
    () => {
      const tree = path.join(work, 'tree');
      fs.mkdirSync(path.join(tree, 'a', 'b'), { recursive: true });
      fs.writeFileSync(path.join(tree, 'a', 'file'), 'x');
      fs.symlinkSync('../file', path.join(tree, 'a', 'b', 'inside'));
      expect(() => verifyUnpackedTree(tree)).not.toThrow();
      fs.symlinkSync('../../../outside', path.join(tree, 'a', 'b', 'escape'));
      expect(() => verifyUnpackedTree(tree)).toThrow(/outside/);
      fs.rmSync(path.join(tree, 'a', 'b', 'escape'));
      fs.symlinkSync('/etc/hosts', path.join(tree, 'a', 'absolute'));
      expect(() => verifyUnpackedTree(tree)).toThrow(/outside/);
    },
  );
});

describe('what a build is', () => {
  it('reads the version out of an app.asar', () => {
    const file = path.join(work, 'app.asar');
    fs.writeFileSync(file, makeAsar('3.4.5'));
    expect(readAsarVersion(file)).toBe('3.4.5');
    fs.writeFileSync(file, Buffer.from('garbage'));
    expect(readAsarVersion(file)).toBeNull();
    expect(readAsarVersion(path.join(work, 'missing'))).toBeNull();
  });

  it('tells the architecture of Windows, Linux and macOS executables', () => {
    const file = path.join(work, 'exe');
    const cases: [Buffer, string | null][] = [
      [pe(0x8664), 'x64'],
      [pe(0xaa64), 'arm64'],
      [pe(0x014c), null],
      [elf(62), 'x64'],
      [elf(183), 'arm64'],
      [
        Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01]), Buffer.alloc(120)]),
        'arm64',
      ],
      [
        Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 0x01]), Buffer.alloc(120)]),
        'x64',
      ],
      [Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.alloc(124)]), 'universal'],
      [Buffer.alloc(200, 1), null],
    ];
    for (const [bytes, expected] of cases) {
      fs.writeFileSync(file, bytes);
      expect(executableArch(file)).toBe(expected);
    }
  });
});

// ── Where the app is, and when it must not replace itself ──────────────────

describe('installation and fallbacks', () => {
  it('finds the folder that is replaced', () => {
    expect(
      installationFor('darwin', '/Applications/RealtimeDocs.app/Contents/MacOS/RealtimeDocs'),
    ).toEqual({
      root: '/Applications/RealtimeDocs.app',
      executable: '/Applications/RealtimeDocs.app/Contents/MacOS/RealtimeDocs',
    });
    expect(installationFor('darwin', '/usr/local/bin/RealtimeDocs')).toBeNull();
    expect(installationFor('linux', '/opt/RealtimeDocs-linux-x64/realtimedocs')?.root).toBe(
      '/opt/RealtimeDocs-linux-x64',
    );
    expect(installationFor('linux', '/realtimedocs')).toBeNull();
    expect(installationFor('freebsd', '/opt/x/realtimedocs')).toBeNull();
  });

  const yes = () => true;
  it('falls back for App Translocation, AppImage, read-only folders and installer copies', () => {
    expect(
      installBlocker({
        platform: 'darwin',
        execPath:
          '/private/var/folders/xy/T/AppTranslocation/1234-ABCD/d/RealtimeDocs.app/Contents/MacOS/RealtimeDocs',
        probe: yes,
      }),
    ).toMatch(/Applications/);
    expect(
      installBlocker({
        platform: 'darwin',
        execPath: '/Volumes/RealtimeDocs/RealtimeDocs.app/Contents/MacOS/RealtimeDocs',
        probe: () => false,
      }),
    ).toMatch(/cannot change the folder/);
    expect(
      installBlocker({
        platform: 'linux',
        execPath: '/tmp/.mount_x/realtimedocs',
        env: { APPIMAGE: '/home/a/RealtimeDocs.AppImage' },
        probe: yes,
      }),
    ).toMatch(/AppImage/);
    expect(
      installBlocker({
        platform: 'linux',
        execPath: '/opt/app/realtimedocs',
        env: {},
        probe: () => false,
      }),
    ).toMatch(/cannot change the folder/);
    expect(
      installBlocker({ platform: 'linux', execPath: '/opt/app/realtimedocs', env: {}, probe: yes }),
    ).toBeNull();

    const installed = path.join(work, 'Programs', 'RealtimeDocs');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'Uninstall RealtimeDocs.exe'), '');
    expect(
      installBlocker({
        platform: 'win32',
        execPath: path.join(installed, 'RealtimeDocs.exe'),
        env: {},
        probe: yes,
      }),
    ).toMatch(/installer/);
  });
});

// ── Helper script ──────────────────────────────────────────────────────────

describe('helper script', () => {
  const base = {
    pid: 4242,
    readyFile: '/tmp/h/ready',
    resultFile: '/home/a b/.config/RealtimeDocs/update-result.json',
  };
  const nasty = `/home/o'brien & co/Rëal "quoted" $HOME \`x\`/RealtimeDocs-linux-x64`;

  it('quotes every path for sh so that nothing in a path is interpreted', () => {
    const { extension, content } = buildHelperScript({
      ...base,
      platform: 'linux',
      root: nasty,
      stagedRoot: '/home/x/.rd-update-00/RealtimeDocs-linux-x64',
      stagingDir: '/home/x/.rd-update-00',
      backupDir: '/home/x/.rd-old-00',
      executable: `${nasty}/realtimedocs`,
      relaunchArgs: ['--user-data-dir=/tmp/pro file', '--no-sandbox', 'rm -rf /', '--x="y"'],
    });
    expect(extension).toBe('.sh');
    expect(content).toContain(
      `ROOT='/home/o'\\''brien & co/Rëal "quoted" $HOME \`x\`/RealtimeDocs-linux-x64'`,
    );
    expect(content).toContain(`'--user-data-dir=/tmp/pro file' '--no-sandbox'`);
    expect(content).not.toContain('rm -rf /');
    expect(content).not.toContain('--x=');
    expect(content).toContain('APP_PID=4242');
    // The script is valid for a POSIX shell.
    if (process.platform !== 'win32') {
      const file = path.join(work, 'h.sh');
      fs.writeFileSync(file, content);
      expect(spawnSync('/bin/sh', ['-n', file]).status).toBe(0);
    }
  });

  it('starts the bundle through LaunchServices on macOS', () => {
    const { content } = buildHelperScript({
      ...base,
      platform: 'darwin',
      root: '/Applications/RealtimeDocs.app',
      stagedRoot: '/Applications/.rd-update-00/RealtimeDocs.app',
      stagingDir: '/Applications/.rd-update-00',
      backupDir: '/Applications/.rd-old-00',
      executable: '/Applications/RealtimeDocs.app/Contents/MacOS/RealtimeDocs',
    });
    expect(content).toContain('/usr/bin/open -n "$ROOT"');
    expect(content).toContain('grep -Fqx -- "$EXE"');
  });

  it('writes a PowerShell script with literal, single-quoted paths', () => {
    const root = `C:\\Users\\O'Brien & Söhne\\Apps $x \`n\\RealtimeDocs-win32-x64`;
    const { extension, content } = buildHelperScript({
      ...base,
      platform: 'win32',
      readyFile: 'C:\\Temp\\h\\ready',
      resultFile: 'C:\\Users\\a\\AppData\\Roaming\\RealtimeDocs\\update-result.json',
      root,
      stagedRoot: 'C:\\Users\\.rd-update-00\\RealtimeDocs-win32-x64',
      stagingDir: 'C:\\Users\\.rd-update-00',
      backupDir: 'C:\\Users\\.rd-old-00',
      executable: `${root}\\RealtimeDocs.exe`,
      relaunchArgs: ['--user-data-dir=C:\\Temp\\pro file', '--bad="x"'],
    });
    expect(extension).toBe('.ps1');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain(
      `$Root = 'C:\\Users\\O''Brien & Söhne\\Apps $x \`n\\RealtimeDocs-win32-x64'`,
    );
    expect(content).toContain(`$AppArgs = @('"--user-data-dir=C:\\Temp\\pro file"')`);
    expect(content).not.toContain('--bad');
    expect(content).toContain('$AppPid = 4242');
    // No expandable (double-quoted) string holds a path.
    expect(content).not.toMatch(/"[^"\r\n]*(Users|Temp)[^"\r\n]*"(?!')/);
    expect(content).not.toMatch(/-Verb|RunAs/i);
  });

  it('refuses relative or multi-line paths and a nonsensical process id', () => {
    const good = {
      ...base,
      platform: 'linux' as const,
      root: '/a/app',
      stagedRoot: '/a/.rd-update-00/app',
      stagingDir: '/a/.rd-update-00',
      backupDir: '/a/.rd-old-00',
      executable: '/a/app/realtimedocs',
    };
    expect(() => buildHelperScript({ ...good, root: 'relative/app' })).toThrow();
    expect(() => buildHelperScript({ ...good, root: '/a/app\nrm -rf /' })).toThrow();
    expect(() => buildHelperScript({ ...good, pid: 0 })).toThrow();
    expect(() => buildHelperScript({ ...good, pid: 1.5 })).toThrow();
  });

  it('passes on plain switches only', () => {
    expect(
      safeRelaunchArgs([
        '--user-data-dir=/x y',
        '--no-sandbox',
        'file.txt',
        '--a="b"',
        '-x',
        '--a\nb',
      ]),
    ).toEqual(['--user-data-dir=/x y', '--no-sandbox']);
  });
});

// ── Staging and the swap, for real, on Linux ───────────────────────────────

const linuxArch = process.arch === 'arm64' ? 'arm64' : 'x64';
const hasUnzip =
  process.platform === 'linux' &&
  (spawnSync('unzip', ['-v']).status === 0 || spawnSync('bsdtar', ['--version']).status === 0);

/** A stand-in installation: a shell script as the "application", which stays up or exits. */
function fakeBuild(directory: string, version: string, behaviour: 'stay' | 'exit'): void {
  fs.mkdirSync(path.join(directory, 'resources'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'realtimedocs'),
    `#!/bin/sh\necho ${version} >> "$(dirname "$0")/../started.log"\n${behaviour === 'stay' ? 'exec sleep 30' : 'exit 3'}\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(directory, 'resources', 'app.asar'), makeAsar(version));
}

describe.skipIf(!hasUnzip)('staging a real archive (Linux)', () => {
  function archiveOf(version: string, machine = linuxArch === 'arm64' ? 183 : 62): string {
    const top = `RealtimeDocs-linux-${linuxArch}`;
    const file = path.join(work, `RealtimeDocs-${version}-linux-${linuxArch}.zip`);
    fs.writeFileSync(
      file,
      makeZip([
        { name: `${top}/` },
        { name: `${top}/realtimedocs`, data: elf(machine), mode: 0o100755 },
        { name: `${top}/resources/` },
        { name: `${top}/resources/app.asar`, data: makeAsar(version) },
      ]),
    );
    return file;
  }
  let root: string;
  beforeEach(() => {
    root = path.join(work, 'install', 'RealtimeDocs');
    fakeBuild(root, '1.0.0', 'stay');
  });
  const stage = (archive: string, version: string) =>
    stageUpdate({ archive, platform: 'linux', arch: linuxArch, root, version });

  it('unpacks next to the installation and checks executable, architecture and version', async () => {
    const phases: string[] = [];
    const staged = await stageUpdate({
      archive: archiveOf('1.1.0'),
      platform: 'linux',
      arch: linuxArch,
      root,
      version: '1.1.0',
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toEqual(['unpacking', 'checking']);
    expect(path.dirname(staged.stagingDir)).toBe(path.dirname(root));
    expect(path.basename(staged.stagingDir)).toMatch(/^\.rd-update-[0-9a-f]{16}$/);
    expect(fs.statSync(path.join(staged.stagedRoot, 'realtimedocs')).mode & 0o111).not.toBe(0);
    expect(findScratch(root)).toEqual([staged.stagingDir]);
  });

  it('refuses another version, another processor and a folder with foreign files, leaving nothing behind', async () => {
    await expect(stage(archiveOf('1.1.0'), '1.2.0')).rejects.toThrow(/contains version 1.1.0/);
    await expect(
      stage(archiveOf('1.3.0', linuxArch === 'arm64' ? 62 : 183), '1.3.0'),
    ).rejects.toThrow(/different kind of processor/);
    fs.writeFileSync(path.join(root, 'my-notes.txt'), 'mine');
    await expect(stage(archiveOf('1.4.0'), '1.4.0')).rejects.toThrow(/other things/);
    expect(findScratch(root)).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'my-notes.txt'), 'utf8')).toBe('mine');
  });

  it('refuses an archive that tries to leave its folder before unpacking anything', async () => {
    const file = path.join(work, `RealtimeDocs-9.9.9-linux-${linuxArch}.zip`);
    fs.writeFileSync(
      file,
      makeZip([
        { name: `RealtimeDocs-linux-${linuxArch}/realtimedocs`, data: elf(62), mode: 0o100755 },
        { name: '../../escaped.txt', data: Buffer.from('x') },
      ]),
    );
    await expect(stage(file, '9.9.9')).rejects.toThrow(/leaves its folder/);
    expect(fs.existsSync(path.join(work, 'escaped.txt'))).toBe(false);
    expect(findScratch(root)).toEqual([]);
  });
});

describe.skipIf(process.platform !== 'linux')('the swap helper, run for real (Linux)', () => {
  async function swap(newBehaviour: 'stay' | 'exit') {
    const parent = path.join(work, 'in stall');
    const root = path.join(parent, 'RealtimeDocs');
    fakeBuild(root, '1.0.0', 'stay');
    const stagingDir = path.join(parent, '.rd-update-0123456789abcdef');
    const stagedRoot = path.join(stagingDir, 'RealtimeDocs-linux-x64');
    fakeBuild(stagedRoot, '2.0.0', newBehaviour);
    const resultFile = path.join(work, 'update-result.json');
    const running = spawn('sleep', ['300'], { stdio: 'ignore' });
    const helper = await startSwapHelper({
      platform: 'linux',
      pid: running.pid as number,
      root,
      stagedRoot,
      stagingDir,
      resultFile,
    });
    // Nothing is touched while the "app" still runs.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(readAsarVersion(path.join(root, 'resources', 'app.asar'))).toBe('1.0.0');
    running.kill('SIGKILL');
    const log = path.join(parent, 'started.log');
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && fs.existsSync(helper.scriptFile)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (fs.existsSync(resultFile)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    spawnSync('pkill', ['-f', path.join(parent, 'RealtimeDocs', 'realtimedocs')]);
    return {
      root,
      resultFile,
      started: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [],
      leftovers: fs.readdirSync(parent).filter((name) => name.startsWith('.rd-')),
    };
  }

  it('moves the new version into place, starts it, and removes the old one only then', async () => {
    const outcome = await swap('stay');
    expect(readAsarVersion(path.join(outcome.root, 'resources', 'app.asar'))).toBe('2.0.0');
    expect(outcome.started).toEqual(['2.0.0']);
    expect(outcome.leftovers).toEqual([]);
    expect(fs.existsSync(outcome.resultFile)).toBe(false);
  }, 40_000);

  it('puts the previous version back and starts it when the new one does not stay up', async () => {
    const outcome = await swap('exit');
    expect(readAsarVersion(path.join(outcome.root, 'resources', 'app.asar'))).toBe('1.0.0');
    expect(outcome.started).toEqual(['2.0.0', '1.0.0']);
    expect(outcome.leftovers).toEqual([]);
    expect(JSON.parse(fs.readFileSync(outcome.resultFile, 'utf8'))).toEqual({
      ok: false,
      step: 'start',
    });
  }, 40_000);
});

// ── The update service: "Update and restart" ───────────────────────────────

describe('UpdateService.install', () => {
  const ORIGIN = 'https://docs.example.com';
  const BYTES = Buffer.from('pretend archive bytes '.repeat(40));
  const SHA = createHash('sha256').update(BYTES).digest('hex');
  const NAME = 'RealtimeDocs-1.2.0-linux-x64.zip';
  let service: UpdateService;
  let stages: (string | null)[];
  let calls: string[];
  let offered: Record<string, unknown>;

  function installer(over: Partial<UpdateInstaller> = {}): UpdateInstaller {
    const staged: StagedUpdate = {
      stagingDir: '/x/.rd-update-00',
      stagedRoot: '/x/.rd-update-00/app',
    };
    return {
      blocker: () => null,
      stage: async (_file, _offer, onPhase) => {
        calls.push('stage');
        onPhase('unpacking');
        onPhase('checking');
        return staged;
      },
      discard: () => void calls.push('discard'),
      handOver: async () => void calls.push('handOver'),
      cleanup: () => void calls.push('cleanup'),
      ...over,
    };
  }

  function make(over: Partial<UpdateServiceOptions> = {}) {
    service = new UpdateService({
      installer: installer(),
      fetch: async (url) =>
        url.includes('/api/v1/desktop/update')
          ? new Response(JSON.stringify(offered), { status: 200 })
          : new Response(BYTES, {
              status: 200,
              headers: { 'content-length': String(BYTES.length) },
            }),
      getServerOrigin: () => ORIGIN,
      appVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      schemaVersion: 3,
      protocolVersion: 1,
      stateFile: path.join(work, 'data', 'update-state.json'),
      downloadsDir: () => path.join(work, 'Downloads'),
      showItemInFolder: () => undefined,
      openPath: async () => '',
      onChange: () => {
        const stage = service?.snapshot().stage ?? null;
        if (stages[stages.length - 1] !== stage) stages.push(stage);
      },
      ...over,
    });
    return service;
  }

  beforeEach(() => {
    stages = [];
    calls = [];
    offered = {
      updateAvailable: true,
      required: false,
      version: '1.2.0',
      notes: null,
      downloadUrl: `/download/releases/stable/1.2.0/${NAME}`,
      sha256: SHA,
      sizeBytes: BYTES.length,
      signatureStatus: 'unsigned',
      releaseNotesUrl: null,
      fileName: NAME,
    };
  });
  afterEach(() => service?.stop());

  it('goes through the stages in order and hands over only after staging', async () => {
    make();
    await service.check();
    expect(service.snapshot()).toMatchObject({
      status: 'available',
      installBlocker: null,
      stage: null,
    });
    await service.install();
    expect(stages.filter((stage) => stage !== null)).toEqual([...INSTALL_STAGES]);
    expect(calls).toEqual(['stage', 'handOver']);
    expect(service.snapshot()).toMatchObject({ status: 'installing', stage: 'restarting' });
    const pending = JSON.parse(
      fs.readFileSync(path.join(work, 'data', 'update-pending.json'), 'utf8'),
    );
    expect(pending).toMatchObject({ version: '1.2.0', previousVersion: '1.0.0' });
  });

  it('reports real download progress: bytes received and a fraction', async () => {
    const seen: number[] = [];
    make({
      onChange: () => {
        const snap = service.snapshot();
        if (snap.stage === 'downloading' && snap.receivedBytes) seen.push(snap.receivedBytes);
      },
    });
    await service.check();
    await service.install();
    expect(seen[seen.length - 1]).toBe(BYTES.length);
    expect(service.snapshot().receivedBytes).toBe(BYTES.length);
  });

  it('does not download again when a verified download is there', async () => {
    let downloads = 0;
    make({
      fetch: async (url) => {
        if (url.includes('/api/v1/desktop/update')) return new Response(JSON.stringify(offered));
        downloads += 1;
        return new Response(BYTES, { headers: { 'content-length': String(BYTES.length) } });
      },
    });
    await service.check();
    await service.download();
    await service.install();
    expect(downloads).toBe(1);
    expect(calls).toEqual(['stage', 'handOver']);
  });

  it('runs one update at a time', async () => {
    make();
    await service.check();
    await Promise.all([service.install(), service.install(), service.install()]);
    expect(calls).toEqual(['stage', 'handOver']);
  });

  it('keeps the installation when the download fails its checksum', async () => {
    offered.sha256 = 'f'.repeat(64);
    make();
    await service.check();
    await service.install();
    expect(calls).toEqual([]);
    expect(service.snapshot()).toMatchObject({ status: 'failed', stage: null });
    expect(service.snapshot().message).toMatch(/SHA-256/);
    expect(fs.existsSync(path.join(work, 'data', 'update-pending.json'))).toBe(false);
  });

  it('says why and keeps the verified download when the build cannot be prepared', async () => {
    const failure = Object.assign(
      new Error('The update contains version 9.9.9, not the announced 1.2.0.'),
      {
        name: 'UpdateInstallError',
      },
    );
    make({
      installer: installer({
        stage: async () => {
          throw failure;
        },
      }),
    });
    await service.check();
    await service.install();
    expect(calls).toEqual([]);
    const snap = service.snapshot();
    expect(snap).toMatchObject({ status: 'downloaded', stage: null });
    expect(snap.message).toMatch(/version 9\.9\.9.*was kept and nothing was changed/);
  });

  it('discards the staged build and stays running when the helper cannot start', async () => {
    make({
      installer: installer({
        handOver: async () => {
          throw new Error('spawn EPERM');
        },
      }),
    });
    await service.check();
    await service.install();
    expect(calls).toEqual(['stage', 'discard']);
    expect(service.snapshot()).toMatchObject({ status: 'downloaded', stage: null });
    expect(service.snapshot().message).toMatch(/could not be started.*was kept/);
    expect(fs.existsSync(path.join(work, 'data', 'update-pending.json'))).toBe(false);
  });

  it('never installs a version that is not newer, and never without an installer', async () => {
    make();
    await service.check();
    // The server changes its mind to an older version between check and click.
    (service as unknown as { snap: { offer: { version: string } } }).snap.offer.version = '0.9.0';
    await service.install();
    expect(calls).toEqual([]);

    const { installer: _none, ...rest } = { installer: undefined };
    void _none;
    make({ ...rest, installer: undefined });
    await service.check();
    expect(service.snapshot().installBlocker).toMatch(/cannot replace itself/);
    await service.install();
    expect(calls).toEqual([]);
    expect(service.snapshot().stage).toBeNull();
  });

  it('offers only the manual download for an installer package or a blocked installation', async () => {
    offered.fileName = 'RealtimeDocs-1.2.0-windows-x64.exe';
    offered.downloadUrl = '/download/releases/stable/1.2.0/RealtimeDocs-1.2.0-windows-x64.exe';
    make();
    await service.check();
    expect(service.snapshot().installBlocker).toMatch(/installer/);
    await service.install();
    expect(calls).toEqual([]);

    offered.fileName = NAME;
    offered.downloadUrl = `/download/releases/stable/1.2.0/${NAME}`;
    make({
      installer: installer({ blocker: () => 'Move RealtimeDocs to the Applications folder.' }),
    });
    await service.check();
    expect(service.snapshot().installBlocker).toMatch(/Applications/);
    await service.install();
    expect(calls).toEqual([]);
    // The manual path still works.
    await service.download();
    expect(service.snapshot().status).toBe('downloaded');
  });

  it('says "Updated to" once when the running version is the one that was to be installed', async () => {
    const data = path.join(work, 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      path.join(data, 'update-pending.json'),
      JSON.stringify({ version: '1.2.0', previousVersion: '1.0.0', at: 'x' }),
    );
    make({ appVersion: '1.2.0' });
    expect(await service.loadOutcome()).toEqual({ kind: 'updated', version: '1.2.0' });
    expect(calls).toEqual(['cleanup']);
    expect(service.snapshot().notice).toEqual({ kind: 'updated', version: '1.2.0' });
    expect(fs.existsSync(path.join(data, 'update-pending.json'))).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(data, 'update-history.json'), 'utf8')),
    ).toMatchObject({
      ok: true,
      version: '1.2.0',
      runningVersion: '1.2.0',
    });
    // Once: the next start has nothing to say.
    expect(await service.loadOutcome()).toBeNull();
    service.dismissNotice();
    expect(service.snapshot().notice).toBeNull();
  });

  it('says what failed when the previous version is the one running again', async () => {
    const data = path.join(work, 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(
      path.join(data, 'update-pending.json'),
      JSON.stringify({ version: '1.2.0', previousVersion: '1.0.0', at: 'x' }),
    );
    fs.writeFileSync(path.join(data, 'update-result.json'), '{"ok":false,"step":"start"}');
    make();
    const notice = await service.loadOutcome();
    expect(notice).toMatchObject({ kind: 'failed', version: '1.2.0' });
    expect(notice && 'message' in notice ? notice.message : '').toMatch(
      /did not start\. The version you had \(1\.0\.0\) was kept/,
    );
    expect(fs.existsSync(path.join(data, 'update-result.json'))).toBe(false);
  });

  it('has a sentence for every step the helper can report, and ignores anything else', () => {
    for (const step of ['wait', 'backup', 'swap', 'start']) {
      expect(installFailureMessage(step)).not.toBe(installFailureMessage(null));
    }
    expect(installFailureMessage('<script>')).toBe(installFailureMessage(null));
  });
});
