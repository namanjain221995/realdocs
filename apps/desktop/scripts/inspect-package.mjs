#!/usr/bin/env node
// Inspects packaged RealtimeDocs Desktop builds WITHOUT running them: reads
// the executable headers, the fuse bytes, app.asar, Info.plist (macOS) and
// the embedded resources (Windows), and lists the entries of the .zip files.
//
//   node scripts/inspect-package.mjs            every build and archive in ./out
//   node scripts/inspect-package.mjs <dir>...   specific RealtimeDocs-<platform>-<arch> folders
//
// A pass means the files have the expected structure. It says nothing about
// whether a Windows or macOS build starts: that needs the real system.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import {
  APP_ID,
  APP_NAME,
  LINUX_EXECUTABLE,
  PUBLIC_PLATFORM,
  URL_SCHEME,
  fuseSettings,
} from './lib/app-config.mjs';
import { NATIVE_MANIFEST_NAME, NATIVE_MODULE_FILE } from './lib/native-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// These three are dependencies of @electron/packager; using its copies keeps
// this script free of extra installs.
const requireFromPackager = createRequire(import.meta.resolve('@electron/packager'));
const plist = requireFromPackager('plist');
const loadAsar = () => import(pathToFileURL(requireFromPackager.resolve('@electron/asar')).href);
const loadResedit = () => import(pathToFileURL(requireFromPackager.resolve('resedit')).href);

/** The marker Electron embeds in front of the fuse bytes (see @electron/fuses). */
const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
/** Only present in development builds (src/main/test-hook.ts). */
const TEST_HOOK_MARKER = 'rd-desktop-test-hook';
const TEST_KEYSTORE_MARKER = 'rd-desktop-test-keystore';

const REQUIRED_ASAR_ENTRIES = [
  'package.json',
  'main/main.cjs',
  'preload/preload.cjs',
  'renderer/panel.html',
  'renderer/settings.html',
  'renderer/probe.html',
  // Sets zod's "jitless" switch before any module runs (the CSP forbids eval).
  'renderer/boot.js',
];

const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x014c: 'ia32' };
const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64' };
const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' };

function createReport(title) {
  const report = { title, ok: true, checks: [], notes: [] };
  return {
    report,
    pass: (name, detail = '') => report.checks.push({ ok: true, name, detail }),
    fail: (name, detail = '') => {
      report.ok = false;
      report.checks.push({ ok: false, name, detail });
    },
    check(condition, name, detail = '') {
      if (condition) this.pass(name, detail);
      else this.fail(name, detail);
    },
    note: (text) => report.notes.push(text),
  };
}

function readHead(file, length) {
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(handle);
  }
}

/** Windows PE: machine type and whether an Authenticode signature is attached. */
function readPe(file) {
  const head = readHead(file, 4096);
  if (head.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a PE file (no MZ header)');
  const peOffset = head.readUInt32LE(0x3c);
  if (head.toString('latin1', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    throw new Error('not a PE file (no PE signature)');
  }
  const machine = head.readUInt16LE(peOffset + 4);
  const optional = peOffset + 24;
  const magic = head.readUInt16LE(optional);
  // Data directories start at +96 (PE32) or +112 (PE32+); entry 4 is the certificate table.
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const certificateSize = head.readUInt32LE(directories + 4 * 8 + 4);
  return {
    arch: PE_MACHINE[machine] ?? `unknown (0x${machine.toString(16)})`,
    format: magic === 0x20b ? 'PE32+' : 'PE32',
    signed: certificateSize > 0,
  };
}

function readElf(file) {
  const head = readHead(file, 64);
  if (head.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  const machine = head.readUInt16LE(18);
  return { arch: ELF_MACHINE[machine] ?? `unknown (0x${machine.toString(16)})` };
}

/** Mach-O: the architectures in the file and whether each carries an embedded code signature. */
function readMachO(file) {
  const data = fs.readFileSync(file);
  const slice = (offset) => {
    if (data.readUInt32LE(offset) !== 0xfeedfacf) throw new Error('not a 64-bit Mach-O slice');
    const cpu = data.readUInt32LE(offset + 4);
    const commandCount = data.readUInt32LE(offset + 16);
    let cursor = offset + 32;
    let codeSignature = false;
    for (let index = 0; index < commandCount; index += 1) {
      const command = data.readUInt32LE(cursor);
      const size = data.readUInt32LE(cursor + 4);
      if (command === 0x1d) codeSignature = true; // LC_CODE_SIGNATURE
      if (size === 0) break;
      cursor += size;
    }
    return { arch: MACHO_CPU[cpu] ?? `unknown (0x${cpu.toString(16)})`, codeSignature };
  };
  if (data.readUInt32BE(0) === 0xcafebabe) {
    const count = data.readUInt32BE(4);
    const slices = [];
    for (let index = 0; index < count; index += 1) {
      slices.push(slice(data.readUInt32BE(8 + index * 20 + 8)));
    }
    return slices;
  }
  return [slice(0)];
}

/** Every copy of the fuse bytes in a binary (two in a universal macOS framework). */
function readFuseWires(file) {
  const data = fs.readFileSync(file);
  const wires = [];
  let position = data.indexOf(FUSE_SENTINEL);
  while (position !== -1) {
    const start = position + FUSE_SENTINEL.length;
    const version = data[start];
    const length = data[start + 1];
    wires.push({ version, states: [...data.subarray(start + 2, start + 2 + length)] });
    position = data.indexOf(FUSE_SENTINEL, position + 1);
  }
  return wires;
}

function describeFuseState(state) {
  if (state === FuseState.ENABLE) return 'on';
  if (state === FuseState.DISABLE) return 'off';
  if (state === FuseState.REMOVED) return 'removed';
  return `unknown (${state})`;
}

async function checkFuses(context, binary, platform) {
  const wires = readFuseWires(binary);
  context.check(
    wires.length >= 1,
    'fuse bytes found in the binary',
    `${wires.length} cop${wires.length === 1 ? 'y' : 'ies'} in ${path.basename(binary)}`,
  );
  if (wires.length === 0) return;

  // Cross-check this reader against the library's own.
  const library = await getCurrentFuseWire(binary);
  const first = wires[0];
  const agrees = first.states.every((state, index) => library[index] === state);
  context.check(agrees, 'fuse reader agrees with @electron/fuses');

  const expected = fuseSettings(platform);
  for (const [index, wire] of wires.entries()) {
    const label = wires.length > 1 ? ` (copy ${index + 1})` : '';
    const seen = new Set();
    for (const [position, state] of wire.states.entries()) {
      const name = FuseV1Options[position];
      if (name === undefined) {
        context.fail(
          `fuse #${position}${label} is unknown to this script`,
          describeFuseState(state),
        );
        continue;
      }
      seen.add(name);
      const want = expected[name];
      const good =
        state === FuseState.REMOVED || state === (want ? FuseState.ENABLE : FuseState.DISABLE);
      context.check(
        good,
        `fuse ${name}${label}: ${describeFuseState(state)}`,
        good ? '' : `expected ${want ? 'on' : 'off'}`,
      );
    }
    for (const name of Object.keys(expected)) {
      if (!seen.has(name)) context.fail(`fuse ${name}${label} is missing from the binary`);
    }
  }
}

async function checkAsar(context, asarPath) {
  context.check(fs.existsSync(asarPath), 'app.asar present', path.basename(asarPath));
  if (!fs.existsSync(asarPath)) return null;
  const asar = await loadAsar();
  const entries = asar
    .listPackage(asarPath, { isPack: false })
    .map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''));
  for (const required of REQUIRED_ASAR_ENTRIES) {
    context.check(entries.includes(required), `app.asar contains ${required}`);
  }
  const nodeModules = entries.filter((entry) => entry.split('/').includes('node_modules'));
  context.check(
    nodeModules.length === 0,
    'app.asar has no node_modules',
    nodeModules.length > 0 ? `${nodeModules.length} entries` : `${entries.length} entries in total`,
  );
  const sourceMaps = entries.filter((entry) => entry.endsWith('.map'));
  context.check(sourceMaps.length === 0, 'app.asar has no source maps');

  if (entries.includes('main/main.cjs')) {
    const main = asar.extractFile(asarPath, 'main/main.cjs').toString('utf8');
    context.check(
      !main.includes(TEST_HOOK_MARKER) && !main.includes('__rdTest'),
      'test hook is not in the production main bundle',
    );
    context.check(
      !main.includes(TEST_KEYSTORE_MARKER) && !main.includes('RD_DESKTOP_TEST_KEYSTORE'),
      'the stand-in key store of the tests is not in the production main bundle',
    );
    context.check(!main.includes('sourceMappingURL=data:'), 'main bundle has no inline source map');
  }
  if (entries.includes('package.json')) {
    const manifest = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    context.check(
      manifest.main === 'main/main.cjs',
      'package.json main is main/main.cjs',
      `version ${manifest.version}`,
    );
    context.check(
      manifest.dependencies === undefined && manifest.devDependencies === undefined,
      'package.json declares no dependencies',
    );
  }
  const { headerString } = asar.getRawHeader(asarPath);
  return crypto.createHash('SHA256').update(headerString).digest('hex');
}

/**
 * The optional Windows diagnostics module. When it was built and packaged, the
 * `.node` file lies OUTSIDE the asar and its SHA-256 equals the entry of
 * `native-manifest.json` INSIDE the asar (which asar integrity covers). When it
 * was not built (every cross-build from Linux), nothing of it may ship.
 */
async function checkNativeModule(context, resources, asarPath, arch) {
  const tag = `win32-${arch}`;
  const file = path.join(resources, 'native', tag, NATIVE_MODULE_FILE);
  const asar = await loadAsar();
  const entries = fs.existsSync(asarPath)
    ? asar
        .listPackage(asarPath, { isPack: false })
        .map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''))
    : [];
  const hasManifest = entries.includes(NATIVE_MANIFEST_NAME);
  const hasFile = fs.existsSync(file);
  if (!hasFile && !hasManifest) {
    context.note('native module: not built — Electron-only status');
    context.check(
      !fs.existsSync(path.join(resources, 'native')),
      'no native directory is shipped without a module',
    );
    return;
  }
  context.check(
    hasFile,
    `native module present outside the asar (native/${tag}/${NATIVE_MODULE_FILE})`,
  );
  context.check(hasManifest, `${NATIVE_MANIFEST_NAME} present inside the asar`);
  if (!hasFile || !hasManifest) return;
  const manifest = JSON.parse(asar.extractFile(asarPath, NATIVE_MANIFEST_NAME).toString('utf8'));
  const expected = manifest?.files?.[`${tag}/${NATIVE_MODULE_FILE}`];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  context.check(
    expected === actual,
    'native module SHA-256 equals the manifest entry',
    `${actual.slice(0, 12)}… (manifest ${String(expected).slice(0, 12)}…)`,
  );
}

function checkResourcesFolder(context, resources) {
  const names = fs.existsSync(resources) ? fs.readdirSync(resources) : [];
  const defaultApp = names.includes('default_app.asar');
  context.check(
    !defaultApp,
    "Electron's default app is not shipped",
    defaultApp ? 'default_app.asar found' : 'no default_app.asar',
  );
  context.check(!names.includes('app'), 'no loose app folder next to app.asar');
}

async function inspectWindows(context, directory, arch) {
  const exe = path.join(directory, `${APP_NAME}.exe`);
  context.check(fs.existsSync(exe), `${APP_NAME}.exe present`);
  if (!fs.existsSync(exe)) return;
  const pe = readPe(exe);
  context.check(
    pe.arch === arch,
    `executable is ${pe.format} for ${pe.arch}`,
    pe.arch === arch ? '' : `expected ${arch}`,
  );
  context.note(
    pe.signed
      ? 'Authenticode: a signature is attached to the executable (not validated here).'
      : 'Authenticode: NOT SIGNED (no certificate table in the executable).',
  );

  const resources = path.join(directory, 'resources');
  const asarHash = await checkAsar(context, path.join(resources, 'app.asar'));
  checkResourcesFolder(context, resources);
  await checkNativeModule(context, resources, path.join(resources, 'app.asar'), arch);
  await checkFuses(context, exe, 'win32');

  const { NtExecutable, NtExecutableResource, Resource } = await loadResedit();
  const executable = NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const resource = NtExecutableResource.from(executable);
  const integrity = resource.entries.find(
    (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR',
  );
  context.check(Boolean(integrity), 'asar integrity resource embedded in the executable');
  if (integrity && asarHash) {
    const list = JSON.parse(Buffer.from(integrity.bin).toString('utf8'));
    const record = list.find((item) => item.file.toLowerCase() === 'resources\\app.asar');
    context.check(
      Boolean(record) && record.alg === 'SHA256' && record.value === asarHash,
      'embedded asar hash matches app.asar',
      record ? `${record.alg} ${String(record.value).slice(0, 16)}...` : 'no record for app.asar',
    );
  }
  const [version] = Resource.VersionInfo.fromEntries(resource.entries);
  if (version) {
    const [language] = version.getAllLanguagesForStringValues();
    const strings = language ? version.getStringValues(language) : {};
    context.check(
      strings.ProductName === APP_NAME,
      'version resource names the product',
      `ProductName=${strings.ProductName}, FileDescription=${strings.FileDescription}, ProductVersion=${strings.ProductVersion}`,
    );
  } else {
    context.fail('version resource present');
  }
  context.check(
    Resource.IconGroupEntry.fromEntries(resource.entries).length >= 1,
    'icon resource present',
  );
  // No administrator rights: the embedded application manifest asks to run as the user.
  const manifestEntry = resource.entries.find((entry) => entry.type === 24);
  const manifestXml = manifestEntry ? Buffer.from(manifestEntry.bin).toString('utf8') : '';
  context.check(
    /requestedExecutionLevel[^>]*level="asInvoker"/.test(manifestXml) &&
      !/requireAdministrator|highestAvailable/.test(manifestXml),
    'the executable asks for no administrator rights (requestedExecutionLevel asInvoker)',
    manifestEntry ? '' : 'no application manifest found',
  );
}

function listInfoPlists(appPath) {
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.name === 'Info.plist') found.push(full);
    }
  };
  visit(appPath);
  return found;
}

async function inspectMac(context, directory, arch) {
  const appPath = path.join(directory, `${APP_NAME}.app`);
  const contents = path.join(appPath, 'Contents');
  const executable = path.join(contents, 'MacOS', APP_NAME);
  context.check(fs.existsSync(executable), `${APP_NAME}.app/Contents/MacOS/${APP_NAME} present`);
  if (!fs.existsSync(executable)) return;

  const expectedArchs = arch === 'universal' ? ['arm64', 'x64'] : [arch];
  const slices = readMachO(executable);
  const found = slices.map((slice) => slice.arch).sort();
  context.check(
    JSON.stringify(found) === JSON.stringify(expectedArchs),
    `executable is Mach-O for ${found.join(' + ')}`,
    JSON.stringify(found) === JSON.stringify(expectedArchs)
      ? ''
      : `expected ${expectedArchs.join(' + ')}`,
  );
  const mode = fs.statSync(executable).mode;
  context.check((mode & 0o111) !== 0, 'executable bit is set');

  const framework = path.join(
    contents,
    'Frameworks',
    'Electron Framework.framework',
    'Electron Framework',
  );
  context.check(fs.existsSync(framework), 'Electron Framework present');
  const current = path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions');
  context.check(
    fs.existsSync(path.join(current, 'Current')) &&
      fs.lstatSync(path.join(current, 'Current')).isSymbolicLink(),
    'framework symbolic links are intact',
  );

  const info = plist.parse(fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8'));
  context.check(
    info.CFBundleIdentifier === APP_ID,
    'bundle identifier',
    String(info.CFBundleIdentifier),
  );
  context.check(
    info.CFBundleExecutable === APP_NAME,
    'bundle executable name',
    String(info.CFBundleExecutable),
  );
  const schemes = (info.CFBundleURLTypes ?? []).flatMap((type) => type.CFBundleURLSchemes ?? []);
  context.check(
    schemes.includes(URL_SCHEME),
    `Info.plist registers the ${URL_SCHEME}:// URL scheme`,
    `CFBundleURLSchemes=${JSON.stringify(schemes)}`,
  );
  // The packager keeps Electron's file name (electron.icns) and replaces its content.
  const bundleIcon = path.join(contents, 'Resources', String(info.CFBundleIconFile));
  const ownIcon = path.join(root, 'build', 'icons', 'icon.icns');
  const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  context.check(
    typeof info.CFBundleIconFile === 'string' && fs.existsSync(bundleIcon),
    'application icon present',
    String(info.CFBundleIconFile),
  );
  if (fs.existsSync(bundleIcon) && fs.existsSync(ownIcon)) {
    context.check(
      sha256(bundleIcon) === sha256(ownIcon),
      'application icon is the RealtimeDocs icon, not the Electron one',
    );
  }
  context.note(
    `Info.plist: version ${info.CFBundleShortVersionString}, LSMinimumSystemVersion ${info.LSMinimumSystemVersion}, category ${info.LSApplicationCategoryType}`,
  );

  // No usage-description key anywhere in the bundle: the app must never be able
  // to show a camera, microphone, screen-recording or similar permission prompt.
  const plists = listInfoPlists(appPath);
  const offending = [];
  for (const file of plists) {
    let data;
    try {
      data = plist.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      context.fail(
        `could not parse ${path.relative(appPath, file)}`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }
    for (const key of Object.keys(data)) {
      if (/UsageDescription/.test(key)) offending.push(`${path.relative(appPath, file)}: ${key}`);
    }
  }
  context.check(
    offending.length === 0,
    'no usage-description keys in any Info.plist',
    offending.length === 0 ? `${plists.length} Info.plist files checked` : offending.join('; '),
  );

  for (const helper of ['', ' (GPU)', ' (Renderer)', ' (Plugin)']) {
    const helperPlist = path.join(
      contents,
      'Frameworks',
      `${APP_NAME} Helper${helper}.app`,
      'Contents',
      'Info.plist',
    );
    const present = fs.existsSync(helperPlist);
    const identifier = present
      ? plist.parse(fs.readFileSync(helperPlist, 'utf8')).CFBundleIdentifier
      : '';
    context.check(
      present && String(identifier).startsWith(`${APP_ID}.helper`),
      `${APP_NAME} Helper${helper}.app present`,
      String(identifier),
    );
  }

  const resources = path.join(contents, 'Resources');
  const asarHash = await checkAsar(context, path.join(resources, 'app.asar'));
  checkResourcesFolder(context, resources);
  const integrity = info.ElectronAsarIntegrity?.['Resources/app.asar'];
  context.check(
    Boolean(integrity) && integrity.algorithm === 'SHA256' && integrity.hash === asarHash,
    'Info.plist asar hash matches app.asar',
    integrity ? `${integrity.algorithm} ${String(integrity.hash).slice(0, 16)}...` : 'no record',
  );

  await checkFuses(context, framework, 'darwin');

  const sealed = fs.existsSync(path.join(contents, '_CodeSignature', 'CodeResources'));
  const frameworkSlices = readMachO(framework);
  context.note(
    `code signing (structure only, nothing is validated here): bundle seal ${sealed ? 'present' : 'ABSENT'}; ` +
      `embedded signature in the main executable: ${slices.map((slice) => `${slice.arch} ${slice.codeSignature ? 'yes' : 'no'}`).join(', ')}; ` +
      `in the Electron Framework: ${frameworkSlices.map((slice) => `${slice.arch} ${slice.codeSignature ? 'yes' : 'no'}`).join(', ')}`,
  );
}

async function inspectLinux(context, directory, arch) {
  const executable = path.join(directory, LINUX_EXECUTABLE);
  context.check(fs.existsSync(executable), `${LINUX_EXECUTABLE} present`);
  if (!fs.existsSync(executable)) return;
  const elf = readElf(executable);
  context.check(
    elf.arch === arch,
    `executable is ELF for ${elf.arch}`,
    elf.arch === arch ? '' : `expected ${arch}`,
  );
  context.check((fs.statSync(executable).mode & 0o111) !== 0, 'executable bit is set');
  const resources = path.join(directory, 'resources');
  await checkAsar(context, path.join(resources, 'app.asar'));
  checkResourcesFolder(context, resources);
  await checkFuses(context, executable, 'linux');
  context.note('Linux has no asar integrity validation in Electron; that fuse stays off.');
}

/** Inspect one packaged folder (out/RealtimeDocs-<platform>-<arch>). */
export async function inspectPackage(directory, platform, arch) {
  const context = createReport(`${platform}-${arch}: ${path.relative(process.cwd(), directory)}`);
  try {
    if (!fs.existsSync(directory)) context.fail('package folder exists');
    else if (platform === 'win32') await inspectWindows(context, directory, arch);
    else if (platform === 'darwin') await inspectMac(context, directory, arch);
    else if (platform === 'linux') await inspectLinux(context, directory, arch);
    else context.fail(`unknown platform ${platform}`);
  } catch (error) {
    context.fail('inspection completed', error instanceof Error ? error.message : String(error));
  }
  return context.report;
}

/** List a .zip and check that the entries a user needs are in it. */
export function inspectArchive(zipPath, platform, arch) {
  const context = createReport(`archive: ${path.relative(process.cwd(), zipPath)}`);
  if (!fs.existsSync(zipPath)) {
    context.fail('archive exists');
    return context.report;
  }
  const listing = spawnSync('unzip', ['-Z', zipPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.error || listing.status !== 0) {
    context.note('unzip is not available here: the archive was not listed.');
    return context.report;
  }
  // zipinfo lines: "<mode> <version> <system> <size> <type> <method> <date> <time> <name>";
  // the name is the rest of the line and may contain spaces.
  const line = /^([-dl?][-rwxsStT]{9})\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s(.*)$/;
  const entries = listing.stdout
    .split('\n')
    .map((text) => line.exec(text))
    .filter((match) => match !== null)
    .map((match) => ({ mode: match[1], name: match[2] }));
  context.check(entries.length > 0, 'archive listing readable', `${entries.length} entries`);
  const names = new Set(entries.map((entry) => entry.name));
  const folder = `${APP_NAME}-${platform}-${arch}`;
  const required =
    platform === 'win32'
      ? [`${folder}/${APP_NAME}.exe`, `${folder}/resources/app.asar`]
      : platform === 'darwin'
        ? [
            `${folder}/${APP_NAME}.app/Contents/Info.plist`,
            `${folder}/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`,
            `${folder}/${APP_NAME}.app/Contents/Resources/app.asar`,
          ]
        : [`${folder}/${LINUX_EXECUTABLE}`, `${folder}/resources/app.asar`];
  for (const name of required) context.check(names.has(name), `archive contains ${name}`);
  if (platform === 'darwin') {
    const links = entries.filter((entry) => entry.mode.startsWith('l'));
    context.check(
      links.length > 0,
      'archive stores the bundle symbolic links as links',
      `${links.length} links`,
    );
    const main = entries.find(
      (entry) => entry.name === `${folder}/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`,
    );
    context.check(
      Boolean(main) && main.mode.includes('x'),
      'archive keeps the executable bit',
      main ? main.mode : '',
    );
  }
  context.note(`${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);
  return context.report;
}

/** List a Linux `.tar.gz` and check that the launcher and the app archive are in it. */
export function inspectTarGz(tarPath, platform, arch) {
  const context = createReport(`archive: ${path.relative(process.cwd(), tarPath)}`);
  if (!fs.existsSync(tarPath)) {
    context.fail('archive exists');
    return context.report;
  }
  const listing = spawnSync('tar', ['-tzvf', tarPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.error || listing.status !== 0) {
    context.note('tar is not available here: the archive was not listed.');
    return context.report;
  }
  // "-rwxr-xr-x user/group 1234 2026-11-12 10:00 name"; names may contain spaces.
  const entries = listing.stdout
    .split('\n')
    .map((text) => /^([-dlh][-rwxsStT]{9})\s+\S+\s+\d+\s+\S+\s+\S+\s(.*?)(?: -> .*)?$/.exec(text))
    .filter((match) => match !== null)
    .map((match) => ({ mode: match[1], name: match[2].replace(/\/$/, '') }));
  context.check(entries.length > 0, 'archive listing readable', `${entries.length} entries`);
  const folder = `${APP_NAME}-${platform}-${arch}`;
  const names = new Map(entries.map((entry) => [entry.name, entry.mode]));
  for (const name of [`${folder}/${LINUX_EXECUTABLE}`, `${folder}/resources/app.asar`]) {
    context.check(names.has(name), `archive contains ${name}`);
  }
  context.check(
    (names.get(`${folder}/${LINUX_EXECUTABLE}`) ?? '').includes('x'),
    'archive keeps the executable bit',
  );
  context.note(`${(fs.statSync(tarPath).size / 1024 / 1024).toFixed(1)} MB`);
  return context.report;
}

export function printInspection(report) {
  console.log(`\n  inspect ${report.title}`);
  for (const check of report.checks) {
    console.log(
      `    ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.detail ? ` -- ${check.detail}` : ''}`,
    );
  }
  for (const note of report.notes) console.log(`    note ${note}`);
  console.log(`    => ${report.ok ? 'structure as expected' : 'PROBLEMS FOUND'}`);
}

async function main() {
  const out = path.join(root, 'out');
  const pattern = new RegExp(`^${APP_NAME}-(win32|darwin|linux)-(x64|arm64|universal)$`);
  const directories = process.argv.slice(2).map((argument) => path.resolve(argument));
  if (directories.length === 0 && fs.existsSync(out)) {
    for (const name of fs.readdirSync(out).sort()) {
      if (pattern.test(name)) directories.push(path.join(out, name));
    }
  }
  if (directories.length === 0) {
    console.error('No packaged builds found. Run `pnpm run package` first.');
    process.exit(1);
  }
  let ok = true;
  for (const directory of directories) {
    const match = pattern.exec(path.basename(directory));
    if (!match) {
      console.error(
        `Skipping ${directory}: the folder name must be ${APP_NAME}-<platform>-<arch>.`,
      );
      ok = false;
      continue;
    }
    const [, platform, arch] = match;
    const report = await inspectPackage(directory, platform, arch);
    printInspection(report);
    ok = ok && report.ok;
    const parent = path.dirname(directory);
    for (const name of fs.readdirSync(parent).sort()) {
      const suffix = `-${PUBLIC_PLATFORM[platform]}-${arch}`;
      if (
        name.startsWith(`${APP_NAME}-`) &&
        (name.endsWith(`${suffix}.zip`) || name.endsWith(`${suffix}.tar.gz`))
      ) {
        const archiveReport = name.endsWith('.zip')
          ? inspectArchive(path.join(parent, name), platform, arch)
          : inspectTarGz(path.join(parent, name), platform, arch);
        printInspection(archiveReport);
        ok = ok && archiveReport.ok;
      }
    }
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
