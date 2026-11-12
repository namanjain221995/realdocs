// Pure parts of scripts/publish-release.mjs (unit-tested in apps/server/test/unit/publish-release.test.ts).
// The shapes mirror packages/contracts/src/releases.ts; the server validates them again at load.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]{1,32}))?$/;
const ARTIFACT =
  /^RealtimeDocs-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]{1,32})?)-(windows|macos|linux)-(x64|arm64|universal)\.(zip|exe|dmg|AppImage|tar\.gz)$/;
const FORMAT = { zip: 'zip', exe: 'exe', dmg: 'dmg', AppImage: 'appimage', 'tar.gz': 'tar.gz' };

export const CHANNELS = ['stable', 'beta'];

export function isVersion(value) {
  return typeof value === 'string' && value.length <= 64 && SEMVER.test(value);
}

/** Strict `RealtimeDocs-<version>-<platform>-<arch>.<ext>` parse, or null. */
export function parseArtifactName(fileName) {
  const match = ARTIFACT.exec(fileName);
  if (!match) return null;
  return { version: match[1], platform: match[2], arch: match[3], format: FORMAT[match[4]] };
}

/** Defaults come from what Electron 45 supports; the operator can override with --min-os. */
export const DEFAULT_MINIMUM_OS = {
  windows: 'Windows 10 or newer (64-bit)',
  macos: 'macOS 12 Monterey or newer',
  linux: 'Desktop Linux with glibc 2.31 or newer (Ubuntu 20.04 or later)',
};

/**
 * Signature status is the operator's statement, never inferred from the files: Windows and macOS
 * builds are "unsigned" unless the matching flag is given explicitly. Linux packages are not signed.
 */
export function signatureFor(platform, { signedWindows = false, notarizedMacos = false } = {}) {
  if (platform === 'windows') return signedWindows ? 'signed' : 'unsigned';
  if (platform === 'macos') return notarizedMacos ? 'notarized' : 'unsigned';
  return 'unsigned';
}

/**
 * @param {{name: string, sizeBytes: number, sha256: string}[]} files already read from disk
 */
export function buildManifest({
  version,
  channel,
  notes,
  files,
  signedWindows = false,
  notarizedMacos = false,
  minimumSupportedVersion,
  minimumOs = {},
  publishedAt = new Date().toISOString(),
}) {
  if (!isVersion(version)) throw new Error(`Not a semantic version: ${version}`);
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);
  if (minimumSupportedVersion !== undefined && !isVersion(minimumSupportedVersion)) {
    throw new Error(`Not a semantic version: ${minimumSupportedVersion}`);
  }
  if (typeof notes !== 'string' || notes.length > 20_000) {
    throw new Error('Release notes must be text of at most 20000 characters');
  }
  if (files.length === 0) throw new Error('No artifacts to publish');
  const artifacts = files
    .map((file) => {
      const parsed = parseArtifactName(file.name);
      if (!parsed) throw new Error(`Not a valid artifact name: ${file.name}`);
      if (parsed.version !== version) {
        throw new Error(`${file.name} is version ${parsed.version}, expected ${version}`);
      }
      if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error(`Bad SHA-256 for ${file.name}`);
      if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
        throw new Error(`Empty or invalid file: ${file.name}`);
      }
      return {
        platform: parsed.platform,
        arch: parsed.arch,
        format: parsed.format,
        fileName: file.name,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        minimumOsVersion: minimumOs[parsed.platform] ?? DEFAULT_MINIMUM_OS[parsed.platform],
        signatureStatus: signatureFor(parsed.platform, { signedWindows, notarizedMacos }),
      };
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  const seen = new Set();
  for (const a of artifacts) {
    const key = `${a.platform}/${a.arch}/${a.format}`;
    if (seen.has(key)) throw new Error(`Two artifacts for ${key}`);
    seen.add(key);
  }
  return {
    version,
    channel,
    publishedAt,
    notes,
    ...(minimumSupportedVersion ? { minimumSupportedVersion } : {}),
    artifacts,
  };
}

export function validateRollout(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100)
    throw new Error('--rollout must be an integer from 0 to 100');
  return n;
}

/** Pointer file content. rolloutPercent 100 is written as "absent". */
export function buildPointer(version, rolloutPercent) {
  if (!isVersion(version)) throw new Error(`Not a semantic version: ${version}`);
  return rolloutPercent === undefined || rolloutPercent >= 100
    ? { version }
    : { version, rolloutPercent };
}

export const SHA256SUMS = (manifest) =>
  `${manifest.artifacts.map((a) => `${a.sha256}  ${a.fileName}`).join('\n')}\n`;
