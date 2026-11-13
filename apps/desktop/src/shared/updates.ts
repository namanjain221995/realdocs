/**
 * Desktop update state and the pure rules around it (no Electron, no Node I/O).
 *
 * The app asks the configured server whether a newer release exists. Nothing is downloaded or
 * installed until the person asks: "Update and restart" downloads the archive, verifies its size
 * and SHA-256 against what the server announced, unpacks it next to the installation, checks the
 * unpacked build, and restarts into it (docs/desktop-release.md, "Updates"). Where the installation
 * cannot be replaced in place, the verified download is offered for a manual replacement instead.
 * The builds are not code-signed: what an update is trusted on is the configured server (HTTPS)
 * and the checksum it announces.
 */
import {
  RELEASE_FORMAT_EXTENSION,
  SEMVER_PATTERN,
  type ReleaseChannel,
  type SignatureStatus,
} from '@realtimedocs/contracts';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  /** "Update and restart" is past the download: unpacking, checking, handing over. */
  | 'installing'
  | 'failed'
  | 'unavailable';

export interface UpdateOffer {
  version: string;
  /** Markdown source from the server; shown as plain text, never as HTML. */
  notes: string | null;
  sizeBytes: number;
  sha256: string;
  signatureStatus: SignatureStatus;
  /** Path on the configured server (never followed by the app itself). */
  releaseNotesUrl: string | null;
  fileName: string;
  /** `installer` for .exe/.dmg/.AppImage, `archive` for .zip/.tar.gz. */
  kind: 'installer' | 'archive';
}

/** Where an "Update and restart" is. Only `downloading` has a measurable progress. */
export const INSTALL_STAGES = [
  'downloading',
  'verifying',
  'unpacking',
  'installing',
  'restarting',
] as const;
export type InstallStage = (typeof INSTALL_STAGES)[number];

export const INSTALL_STAGE_LABELS: Record<InstallStage, string> = {
  downloading: 'Downloading',
  verifying: 'Verifying',
  unpacking: 'Unpacking',
  installing: 'Installing',
  restarting: 'Restarting',
};

/** What the previous run's update came to; shown once after the restart. */
export type UpdateNotice =
  { kind: 'updated'; version: string } | { kind: 'failed'; version: string; message: string };

/** A sentence for each step at which the swap can fail. The previous version runs in every case. */
export function installFailureMessage(step: string | null): string {
  switch (step) {
    case 'wait':
      return 'The app did not close in time, so the update was not installed.';
    case 'backup':
      return 'The installed files were still in use, so the update was not installed.';
    case 'swap':
      return 'The new version could not be moved into place.';
    case 'start':
      return 'The new version did not start.';
    default:
      return 'The update was not completed.';
  }
}

export interface UpdateSnapshot {
  status: UpdateStatus;
  currentVersion: string;
  channel: ReleaseChannel;
  /** The server says this version can no longer be used (below its minimum, or incompatible). */
  required: boolean;
  offer: UpdateOffer | null;
  /** 0–1 while downloading. */
  progress: number | null;
  checkedAt: string | null;
  /** Displayable reason for `failed` / `unavailable`. */
  message: string | null;
  /** The user chose "Remind me later" for `offer.version` (never possible when `required`). */
  deferred: boolean;
  /** File name of the verified download, once there is one. The folder is not exposed. */
  downloadedFile: string | null;
  /** Bytes received so far while downloading. */
  receivedBytes: number | null;
  /** The stage of a running "Update and restart", else null. */
  stage: InstallStage | null;
  /**
   * Why this installation cannot replace itself (then only the manual download is offered), or
   * null when "Update and restart" is possible.
   */
  installBlocker: string | null;
  /** Outcome of an update started in the previous run. Not persisted: shown once. */
  notice: UpdateNotice | null;
}

export function initialUpdateSnapshot(
  currentVersion: string,
  channel: ReleaseChannel = 'stable',
): UpdateSnapshot {
  return {
    status: 'idle',
    currentVersion,
    channel,
    required: false,
    offer: null,
    progress: null,
    checkedAt: null,
    message: null,
    deferred: false,
    downloadedFile: null,
    receivedBytes: null,
    stage: null,
    installBlocker: null,
    notice: null,
  };
}

/** A build with a pre-release tag (`1.2.0-beta.3`) follows the beta channel. */
export function channelFor(version: string): ReleaseChannel {
  return /-beta(\.|$)/.test(version) ? 'beta' : 'stable';
}

const NAME_EXTENSIONS = Object.values(RELEASE_FORMAT_EXTENSION)
  .map((ext) => ext.replace('.', '\\.'))
  .join('|');
const ARTIFACT_NAME = new RegExp(
  `^RealtimeDocs-(${SEMVER_PATTERN.source.slice(1, -1)})-(windows|macos|linux)-(x64|arm64|universal)\\.(${NAME_EXTENSIONS})$`,
);

/** The only file names the app will write: `RealtimeDocs-<version>-<platform>-<arch>.<ext>`. */
export function isSafeArtifactName(name: string): boolean {
  return name.length <= 160 && ARTIFACT_NAME.test(name);
}

export function artifactKind(fileName: string): 'installer' | 'archive' {
  return /\.(zip|tar\.gz)$/.test(fileName) ? 'archive' : 'installer';
}

const DOWNLOAD_PATH = /^\/download\/releases\/(stable|beta)\/([^/]+)\/([^/]+)$/;

/**
 * The URL a download may use, or null. Only the configured server origin is allowed (a relative
 * path, or an absolute URL with exactly that origin), only the release download path, and the
 * version and file name in the path must be the ones announced. No credentials, no fragment.
 */
export function resolveDownloadUrl(
  serverOrigin: string,
  downloadUrl: string,
  expected: { version: string; fileName: string },
): URL | null {
  let url: URL;
  try {
    url = new URL(downloadUrl, `${serverOrigin}/`);
  } catch {
    return null;
  }
  if (url.origin !== serverOrigin) return null;
  if (url.username !== '' || url.password !== '' || url.hash !== '' || url.search !== '')
    return null;
  const match = DOWNLOAD_PATH.exec(url.pathname);
  if (!match) return null;
  const [, , version, name] = match;
  if (version !== expected.version || name !== expected.fileName) return null;
  if (!isSafeArtifactName(expected.fileName)) return null;
  return url;
}

/** Size and SHA-256 of what was received against what the server announced. */
export function verifyDownload(
  received: { bytes: number; sha256: string },
  expected: { sizeBytes: number; sha256: string },
): { ok: true } | { ok: false; reason: 'size' | 'hash' } {
  if (received.bytes !== expected.sizeBytes) return { ok: false, reason: 'size' };
  if (received.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    return { ok: false, reason: 'hash' };
  }
  return { ok: true };
}

export const SIGNATURE_WORDS: Record<SignatureStatus, string> = {
  signed: 'Signed',
  notarized: 'Signed and notarised',
  'dev-signed': 'Signed with a development certificate (not trusted by the operating system)',
  unsigned:
    'Unsigned build: Windows SmartScreen or macOS Gatekeeper will warn you before it opens.',
};

/** The panel renders other people's content; it needs to know an update is required, not the notes. */
export function panelUpdateView(updates: UpdateSnapshot): UpdateSnapshot {
  return {
    ...updates,
    offer: updates.offer ? { ...updates.offer, notes: null } : null,
  };
}
