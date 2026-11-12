#!/usr/bin/env node
// Operator tool: turns a directory of built desktop artifacts into a published release directory.
//
//   node scripts/publish-release.mjs <artifacts-dir> --channel stable --notes-file NOTES.md \
//        --target ./release-out [--signed-windows] [--notarized-macos] [--minimum-supported 1.0.0] \
//        [--rollout 25] [--no-activate]
//   node scripts/publish-release.mjs --rollback 1.2.0 --channel stable --target <dir>
//   node scripts/publish-release.mjs --rollout 50 --channel stable --target <dir>
//
// <target> is the server's DOWNLOAD_DIR (or a staging copy of it that you then `docker cp` into the
// rd_downloads volume; see docs/desktop-release.md). Previous releases are never deleted or changed.
// Signing is stated, never inferred: without --signed-windows / --notarized-macos every Windows
// and macOS artifact is recorded as "unsigned".
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CHANNELS,
  SHA256SUMS,
  buildManifest,
  buildPointer,
  isVersion,
  parseArtifactName,
  validateRollout,
} from './lib/release-publish.mjs';

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Atomic replace: write a temporary file next to the destination, then rename over it. */
async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, { mode: 0o644 });
  await rename(tmp, file);
}

async function setPointer(target, channel, version, rolloutPercent) {
  await mkdir(path.join(target, 'channels'), { recursive: true });
  const pointer = buildPointer(version, rolloutPercent);
  await writeAtomic(
    path.join(target, 'channels', `${channel}.json`),
    `${JSON.stringify(pointer, null, 2)}\n`,
  );
  return pointer;
}

async function readPointer(target, channel) {
  try {
    return JSON.parse(await readFile(path.join(target, 'channels', `${channel}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`publish-release: ${message}`);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      channel: { type: 'string', default: 'stable' },
      'notes-file': { type: 'string' },
      target: { type: 'string' },
      version: { type: 'string' },
      'signed-windows': { type: 'boolean', default: false },
      'notarized-macos': { type: 'boolean', default: false },
      'minimum-supported': { type: 'string' },
      rollout: { type: 'string' },
      rollback: { type: 'string' },
      'no-activate': { type: 'boolean', default: false },
    },
  });
  const channel = values.channel;
  if (!CHANNELS.includes(channel)) fail(`--channel must be one of ${CHANNELS.join(', ')}`);
  if (!values.target) fail('--target <DOWNLOAD_DIR or staging directory> is required');
  const target = path.resolve(values.target);

  if (values.rollback) {
    if (!isVersion(values.rollback)) fail('--rollback needs a semantic version');
    const releaseDir = path.join(target, 'releases', channel, values.rollback);
    try {
      await stat(path.join(releaseDir, 'release.json'));
    } catch {
      fail(`${channel}/${values.rollback} is not on disk in ${target}`);
    }
    const pointer = await setPointer(
      target,
      channel,
      values.rollback,
      values.rollout === undefined ? undefined : validateRollout(values.rollout),
    );
    console.log(
      `Channel ${channel} now points at ${JSON.stringify(pointer)}. Nothing was deleted.`,
    );
    return;
  }

  if (positionals.length === 0) {
    if (values.rollout === undefined)
      fail('give an artifacts directory, or --rollback / --rollout');
    const pointer = await readPointer(target, channel);
    if (!pointer) fail(`channel ${channel} has no pointer in ${target}`);
    const next = await setPointer(
      target,
      channel,
      pointer.version,
      validateRollout(values.rollout),
    );
    console.log(`Channel ${channel}: ${JSON.stringify(next)}`);
    return;
  }

  const source = path.resolve(positionals[0]);
  if (!values['notes-file']) fail('--notes-file is required');
  const notes = await readFile(values['notes-file'], 'utf8');
  const names = (await readdir(source)).filter((n) => parseArtifactName(n));
  const skipped = (await readdir(source)).filter((n) => !parseArtifactName(n));
  if (skipped.length > 0)
    console.warn(
      `Ignoring files that do not match the artifact name pattern: ${skipped.join(', ')}`,
    );
  const versions = new Set(names.map((n) => parseArtifactName(n).version));
  if (versions.size !== 1)
    fail(`artifacts must share exactly one version, found: ${[...versions].join(', ') || 'none'}`);
  const version = values.version ?? [...versions][0];

  const files = [];
  for (const name of names) {
    const file = path.join(source, name);
    const info = await lstat(file);
    if (!info.isFile()) fail(`${name} is not a regular file`);
    files.push({ name, sizeBytes: info.size, sha256: await sha256File(file) });
  }
  const manifest = buildManifest({
    version,
    channel,
    notes,
    files,
    signedWindows: values['signed-windows'],
    notarizedMacos: values['notarized-macos'],
    minimumSupportedVersion: values['minimum-supported'],
  });

  const channelDir = path.join(target, 'releases', channel);
  const finalDir = path.join(channelDir, version);
  try {
    await stat(finalDir);
    fail(`${channel}/${version} already exists. Releases are immutable; publish a new version.`);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await mkdir(channelDir, { recursive: true });
  const staging = path.join(channelDir, `.${version}.tmp-${process.pid}`);
  try {
    await mkdir(staging);
    for (const name of names) await copyFile(path.join(source, name), path.join(staging, name));
    await writeFile(path.join(staging, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(staging, 'SHA256SUMS'), SHA256SUMS(manifest));
    await rename(staging, finalDir);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  console.log(`Published ${channel}/${version}: ${manifest.artifacts.length} artifact(s)`);
  for (const a of manifest.artifacts)
    console.log(`  ${a.fileName}  ${a.signatureStatus}  ${a.sha256}`);

  if (values['no-activate']) {
    console.log('Channel pointer NOT changed (--no-activate). Activate with --rollback <version>.');
    return;
  }
  const rollout = values.rollout === undefined ? undefined : validateRollout(values.rollout);
  const pointer = await setPointer(target, channel, version, rollout);
  console.log(`Channel ${channel} now points at ${JSON.stringify(pointer)}.`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
