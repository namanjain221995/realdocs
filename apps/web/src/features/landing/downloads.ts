import {
  pickArtifact,
  type DownloadsResponse,
  type ReleaseArch,
  type ReleaseArtifact,
  type ReleaseFormat,
  type ReleasePlatform,
  type ReleaseSummary,
  type SignatureStatus,
} from '@realtimedocs/contracts';

/** `84.3 MB`, `512 KB`, `900 B`: decimal units, as download pages and file managers show them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export const PLATFORM_NAMES: Record<ReleasePlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export const PLATFORMS: readonly ReleasePlatform[] = ['windows', 'macos', 'linux'];

/** Signature status as the web page knows it: the legacy listing can also be silent about it. */
export type DisplaySignature = SignatureStatus | 'unknown';

/** One file as the page shows it. Built from a release or, until migration, the legacy listing. */
export interface DisplayArtifact {
  platform: ReleasePlatform;
  arch: ReleaseArch;
  format: ReleaseFormat;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  minimumOsVersion: string | null;
  signatureStatus: DisplaySignature;
  downloadUrl: string;
}

export interface DisplayRelease {
  version: string | null;
  publishedAt: string | null;
  notes: string;
  artifacts: DisplayArtifact[];
  /** True when this came from the legacy `GET /api/downloads` listing (no release manifest). */
  legacy: boolean;
}

export function archLabel(arch: ReleaseArch, platform: ReleasePlatform): string {
  if (arch === 'universal') return 'Universal (Intel and Apple Silicon)';
  if (platform === 'macos') return arch === 'arm64' ? 'Apple Silicon (arm64)' : 'Intel (x64)';
  return arch === 'arm64' ? 'Arm (arm64)' : '64-bit (x64)';
}

export const FORMAT_LABELS: Record<ReleaseFormat, string> = {
  zip: 'ZIP archive',
  exe: 'Installer (.exe)',
  dmg: 'Disk image (.dmg)',
  appimage: 'AppImage',
  'tar.gz': 'Tarball (.tar.gz)',
};

/** The name a person knows a build by. */
export function buildLabel(
  artifact: Pick<DisplayArtifact, 'platform' | 'arch' | 'format'>,
): string {
  return `${PLATFORM_NAMES[artifact.platform]} ${archLabel(artifact.arch, artifact.platform)} — ${FORMAT_LABELS[artifact.format]}`;
}

/** Truthful words for the signature, for the platform the file is for. */
export function signatureNotice(status: DisplaySignature, platform: ReleasePlatform): string {
  switch (status) {
    case 'signed':
      return platform === 'windows'
        ? 'Signed build.'
        : 'Signed build (not notarised by Apple unless stated).';
    case 'notarized':
      return 'Signed and notarised by Apple.';
    case 'dev-signed':
      return 'Signed with a development certificate. Your operating system does not trust it: expect warnings.';
    case 'unsigned':
      return platform === 'windows'
        ? 'Unsigned build — Windows SmartScreen will warn you before it opens.'
        : platform === 'macos'
          ? 'Unsigned build — macOS Gatekeeper will warn you before it opens.'
          : 'Not code-signed. Check the SHA-256 checksum before you run it.';
    default:
      return platform === 'windows'
        ? 'Signature not stated by this server — treat it as unsigned; Windows SmartScreen may warn you.'
        : platform === 'macos'
          ? 'Signature not stated by this server — treat it as unsigned; macOS Gatekeeper may warn you.'
          : 'Signature not stated by this server. Check the SHA-256 checksum before you run it.';
  }
}

export function fromRelease(release: ReleaseSummary): DisplayRelease {
  return {
    version: release.version,
    publishedAt: release.publishedAt,
    notes: release.notes,
    artifacts: release.artifacts.map((a: ReleaseArtifact) => ({ ...a })),
    legacy: false,
  };
}

/** Maps the legacy flat-file listing (before the operator migrates to versioned releases). */
export function fromLegacy(data: DownloadsResponse): DisplayRelease | null {
  const artifacts = data.artifacts
    .filter((item) => isDownloadPath(item.url))
    .map<DisplayArtifact>((item) => ({
      platform: item.platform,
      arch: item.arch,
      format: 'zip',
      fileName: item.file,
      sizeBytes: item.bytes,
      sha256: item.sha256,
      minimumOsVersion: null,
      signatureStatus:
        data.release?.signed === true
          ? 'signed'
          : data.release?.signed === false
            ? 'unsigned'
            : 'unknown',
      downloadUrl: item.url,
    }));
  if (artifacts.length === 0) return null;
  return {
    version: data.release?.version ?? null,
    publishedAt: null,
    notes: data.release?.notes ?? '',
    artifacts,
    legacy: true,
  };
}

/** Only same-origin download paths become links; anything else the server sent is not offered. */
export function isDownloadPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

/** The file to offer for a detected platform, or null (then the page says nothing is published). */
export function chooseBuild(
  release: DisplayRelease,
  platform: ReleasePlatform,
  arch: ReleaseArch,
): DisplayArtifact | null {
  // pickArtifact only reads platform, arch, format and signatureStatus.
  const candidates = release.artifacts
    .filter((a) => isDownloadPath(a.downloadUrl))
    .map((a) => ({
      ...a,
      signatureStatus: a.signatureStatus === 'unknown' ? ('unsigned' as const) : a.signatureStatus,
    }));
  const picked = pickArtifact(candidates, platform, arch);
  return picked ? (release.artifacts.find((a) => a.fileName === picked.fileName) ?? null) : null;
}

const PLATFORM_ORDER: Record<ReleasePlatform, number> = { windows: 0, macos: 1, linux: 2 };
const ARCH_ORDER: Record<ReleaseArch, number> = { x64: 0, arm64: 1, universal: 2 };

/** Every file in a stable order: platform, architecture, then format. */
export function orderBuilds(artifacts: readonly DisplayArtifact[]): DisplayArtifact[] {
  return [...artifacts].sort(
    (a, b) =>
      PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform] ||
      ARCH_ORDER[a.arch] - ARCH_ORDER[b.arch] ||
      a.format.localeCompare(b.format),
  );
}

export const LINUX_CAPTURE_NOTE =
  'On Linux, whether the window can be left out of screen capture depends on the display server and the compositor, and it may be unavailable. The app tells you what it could and could not do.';
