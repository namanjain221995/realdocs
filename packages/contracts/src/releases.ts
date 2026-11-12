/**
 * Desktop release distribution contracts (docs/desktop-release.md).
 *
 * `ReleaseManifest` is the shape of `release.json`, written by `scripts/publish-release.mjs` into
 * `<DOWNLOAD_DIR>/releases/<channel>/<version>/`. The server re-validates it and checks every file
 * it names before offering anything; the manifest is never trusted blindly. The server never infers
 * whether a build is signed: `signatureStatus` is the operator's statement.
 */
import { z } from './zod';
import { IsoDate } from './models';

export const ReleasePlatform = z.enum(['windows', 'macos', 'linux']);
export type ReleasePlatform = z.infer<typeof ReleasePlatform>;
export const ReleaseArch = z.enum(['x64', 'arm64', 'universal']);
export type ReleaseArch = z.infer<typeof ReleaseArch>;
export const ReleaseFormat = z.enum(['zip', 'exe', 'dmg', 'appimage', 'tar.gz']);
export type ReleaseFormat = z.infer<typeof ReleaseFormat>;
export const ReleaseChannel = z.enum(['stable', 'beta']);
export type ReleaseChannel = z.infer<typeof ReleaseChannel>;
export const SignatureStatus = z.enum(['signed', 'unsigned', 'notarized', 'dev-signed']);
export type SignatureStatus = z.infer<typeof SignatureStatus>;

/** Semantic version: `1.2.3` or `1.2.3-beta.1` (no build metadata). */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]{1,32}))?$/;
export const ReleaseVersion = z.string().max(64).regex(SEMVER_PATTERN, 'Not a semantic version');

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

export function parseReleaseVersion(version: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  // A release without a pre-release tag is newer than one with it.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Semantic-version precedence: negative when `a < b`. Throws on an invalid version. */
export function compareReleaseVersions(a: string, b: string): number {
  const x = parseReleaseVersion(a);
  const y = parseReleaseVersion(b);
  if (!x || !y) throw new Error(`Not a semantic version: ${!x ? a : b}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}

/** File extension of each format inside an artifact name. */
export const RELEASE_FORMAT_EXTENSION: Readonly<Record<ReleaseFormat, string>> = {
  zip: 'zip',
  exe: 'exe',
  dmg: 'dmg',
  appimage: 'AppImage',
  'tar.gz': 'tar.gz',
};

/** `RealtimeDocs-<version>-<platform>-<arch>.<ext>` */
export function releaseArtifactName(
  version: string,
  platform: ReleasePlatform,
  arch: ReleaseArch,
  format: ReleaseFormat,
): string {
  return `RealtimeDocs-${version}-${platform}-${arch}.${RELEASE_FORMAT_EXTENSION[format]}`;
}

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ReleaseArtifactManifest = z.object({
  platform: ReleasePlatform,
  arch: ReleaseArch,
  format: ReleaseFormat,
  fileName: z.string().min(1).max(160),
  sizeBytes: z.number().int().positive(),
  sha256: Sha256,
  /** Human-readable minimum, e.g. `Windows 10 (1809)`, `macOS 12`, `glibc 2.31`. */
  minimumOsVersion: z.string().min(1).max(80),
  signatureStatus: SignatureStatus,
});
export type ReleaseArtifactManifest = z.infer<typeof ReleaseArtifactManifest>;

export const ReleaseManifest = z.object({
  version: ReleaseVersion,
  channel: ReleaseChannel,
  publishedAt: IsoDate,
  /** Markdown release notes. */
  notes: z.string().max(20_000),
  /** Clients older than this are told the update is required. */
  minimumSupportedVersion: ReleaseVersion.optional(),
  artifacts: z.array(ReleaseArtifactManifest).max(40),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifest>;

/** `<DOWNLOAD_DIR>/channels/<channel>.json`: which release is current. */
export const ChannelPointer = z.object({
  version: ReleaseVersion,
  /** 1–100. Absent means 100. Applies to the desktop update check only. */
  rolloutPercent: z.number().int().min(0).max(100).optional(),
});
export type ChannelPointer = z.infer<typeof ChannelPointer>;

// ── API shapes ──────────────────────────────────────────────────────────────

/** One downloadable file as the API describes it (only verified files are listed). */
export const ReleaseArtifact = ReleaseArtifactManifest.extend({ downloadUrl: z.string() });
export type ReleaseArtifact = z.infer<typeof ReleaseArtifact>;

export const ReleaseSummary = z.object({
  version: z.string(),
  channel: ReleaseChannel,
  publishedAt: IsoDate,
  notes: z.string(),
  minimumSupportedVersion: z.string().nullable(),
  /** True for the release the channel pointer names. */
  current: z.boolean(),
  artifacts: z.array(ReleaseArtifact),
});
export type ReleaseSummary = z.infer<typeof ReleaseSummary>;

/** `GET /api/v1/desktop/releases?channel=` */
export const ReleaseListResponse = z.object({
  channel: ReleaseChannel,
  releases: z.array(ReleaseSummary),
});
export type ReleaseListResponse = z.infer<typeof ReleaseListResponse>;

/** `GET /api/v1/desktop/releases/latest` */
export const LatestReleaseResponse = z.object({
  version: z.string(),
  channel: ReleaseChannel,
  platform: ReleasePlatform,
  arch: ReleaseArch,
  format: ReleaseFormat,
  fileName: z.string(),
  downloadUrl: z.string(),
  sha256: Sha256,
  sizeBytes: z.number().int(),
  minimumOsVersion: z.string(),
  publishedAt: IsoDate,
  releaseNotesUrl: z.string(),
  signatureStatus: SignatureStatus,
  /** Set only when `platform` was absent and was guessed from request headers. */
  detected: z
    .object({ source: z.enum(['sec-ch-ua-platform', 'user-agent']), platform: ReleasePlatform })
    .optional(),
});
export type LatestReleaseResponse = z.infer<typeof LatestReleaseResponse>;

/** `GET /api/v1/desktop/update` */
export const DesktopUpdateResponse = z.object({
  updateAvailable: z.boolean(),
  /** The installed version is below the supported minimum, or the schema/protocol is incompatible. */
  required: z.boolean(),
  version: z.string().nullable(),
  notes: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  sha256: Sha256.nullable(),
  sizeBytes: z.number().int().nullable(),
  signatureStatus: SignatureStatus.nullable(),
  releaseNotesUrl: z.string().nullable(),
  fileName: z.string().nullable(),
});
export type DesktopUpdateResponse = z.infer<typeof DesktopUpdateResponse>;

/** `GET /api/admin/releases` (browser administrator). */
export const AdminReleasesResponse = z.object({
  configured: z.boolean(),
  channels: z.array(
    z.object({
      channel: ReleaseChannel,
      pointer: ChannelPointer.nullable(),
      releases: z.array(
        ReleaseSummary.extend({
          downloads: z.number().int().nonnegative(),
          artifacts: z.array(ReleaseArtifact.extend({ downloads: z.number().int().nonnegative() })),
        }),
      ),
      /** Releases found on disk that have a problem (bad manifest, hash mismatch, missing file). */
      problems: z.array(z.object({ version: z.string(), problem: z.string() })),
    }),
  ),
  legacyFiles: z.array(z.string()),
});
export type AdminReleasesResponse = z.infer<typeof AdminReleasesResponse>;

// ── Choosing a file for a computer ──────────────────────────────────────────

/** Architectures to try, best first. Windows on Arm runs x64 builds; macOS may ship a universal build. */
export function archCandidates(platform: ReleasePlatform, arch: ReleaseArch): ReleaseArch[] {
  if (arch === 'universal') return ['universal'];
  if (platform === 'windows' && arch === 'arm64') return ['arm64', 'universal', 'x64'];
  return [arch, 'universal'];
}

/** Lower is better. Installers are preferred only when the operator states they are trustworthy. */
function formatRank(
  platform: ReleasePlatform,
  artifact: Pick<ReleaseArtifactManifest, 'format' | 'signatureStatus'>,
): number {
  const fmt = artifact.format;
  if (platform === 'windows') {
    if (fmt === 'exe') return artifact.signatureStatus === 'signed' ? 0 : 3;
    return fmt === 'zip' ? 1 : 2;
  }
  if (platform === 'macos') {
    if (fmt === 'dmg') return artifact.signatureStatus === 'notarized' ? 0 : 3;
    return fmt === 'zip' ? 1 : 2;
  }
  // The .zip is offered before the .tar.gz: one archive format on every platform. Both keep the
  // executable bits (`zip -y`), and both are listed for a visitor who prefers the other.
  const order: ReleaseFormat[] = ['appimage', 'zip', 'tar.gz'];
  const at = order.indexOf(fmt);
  return at === -1 ? 9 : at;
}

/** The artifact to offer for a platform/arch, or null when none fits. Never returns another platform. */
export function pickArtifact<
  T extends Pick<ReleaseArtifactManifest, 'platform' | 'arch' | 'format' | 'signatureStatus'>,
>(artifacts: readonly T[], platform: ReleasePlatform, arch: ReleaseArch): T | null {
  for (const candidate of archCandidates(platform, arch)) {
    const matches = artifacts
      .filter((a) => a.platform === platform && a.arch === candidate)
      .sort((a, b) => formatRank(platform, a) - formatRank(platform, b));
    if (matches[0]) return matches[0];
  }
  return null;
}
