/**
 * Desktop update state and the pure rules around it (no Electron, no Node I/O).
 *
 * The app NEVER replaces itself. It asks the configured server whether a newer release exists,
 * downloads the installer or archive into the user's Downloads folder only when asked, verifies its
 * size and SHA-256 against what the server announced, and then offers to show the file or open it.
 * Silent in-place replacement needs a signed build (Windows Authenticode / Apple notarisation) and
 * is deliberately not implemented; see docs/desktop-release.md.
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
