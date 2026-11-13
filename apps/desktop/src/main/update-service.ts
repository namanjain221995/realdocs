/**
 * Update checks, verified downloads and the user-started "Update and restart". Electron-free: the
 * network, the file locations, the "show / open" actions and the installer are injected, so the
 * unit tests drive it with fakes.
 *
 * What it does (docs/desktop-release.md):
 * - It asks `GET /api/v1/desktop/update` on the CONFIGURED server (and nowhere else) at start, every
 *   6 hours and on request, with platform, architecture, channel, current version and a random
 *   install id (for staged rollouts; it identifies no person and is never sent anywhere else).
 * - It downloads only when the user asks, only from the configured origin, never follows a redirect,
 *   writes to `<name>.part`, and renames to the final name only after size and SHA-256 match.
 * - `install()` ("Update and restart", only ever after a click) downloads if needed, has the
 *   installer unpack and check the build next to the installation, records what is about to happen,
 *   and hands over to the installer, which starts the swap helper and quits the app. Nothing is
 *   installed without that click, and never a version that is not newer than the running one.
 * - The manual path stays: "Open download" hands the verified file to the operating system.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DesktopUpdateResponse,
  compareReleaseVersions,
  type ReleaseArch,
  type ReleasePlatform,
} from '@realtimedocs/contracts';
import {
  artifactKind,
  channelFor,
  initialUpdateSnapshot,
  installFailureMessage,
  isSafeArtifactName,
  resolveDownloadUrl,
  verifyDownload,
  type UpdateNotice,
  type UpdateOffer,
  type UpdateSnapshot,
} from '../shared/updates';
import { silentLogger, type Logger } from './logger';

/** True when `offered` is a later release than `current`; false for anything unparsable. */
function isNewer(offered: string, current: string): boolean {
  try {
    return compareReleaseVersions(offered, current) > 0;
  } catch {
    return false;
  }
}

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_TIMEOUT_MS = 10_000;
const MAX_CHECK_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_STALL_MS = 60_000;

/** A build unpacked next to the installation, checked and ready to be swapped in. */
export interface StagedUpdate {
  stagingDir: string;
  stagedRoot: string;
}

/** The part that touches the installation. The real one is `update-installer.ts`. */
export interface UpdateInstaller {
  /** Why this installation cannot replace itself, or null. */
  blocker(): string | null;
  /** Unpacks and checks the verified archive. Rejects with a displayable message. */
  stage(
    file: string,
    offer: UpdateOffer,
    onPhase: (phase: 'unpacking' | 'checking') => void,
  ): Promise<StagedUpdate>;
  /** Removes a staged build that will not be used. */
  discard(staged: StagedUpdate): void;
  /**
   * Starts the helper that swaps the versions once this process is gone, then asks the app to
   * quit. Rejects (and starts nothing) when the helper cannot run.
   */
  handOver(staged: StagedUpdate, resultFile: string): Promise<void>;
  /** Removes staging and backup folders an interrupted update left behind. */
  cleanup(): void;
}

const NO_INSTALLER =
  'This copy of the app cannot replace itself. Download the new version and replace the app yourself.';
const INSTALLER_PACKAGE =
  'For this computer the server publishes an installer. Download it and run it; it replaces this version.';

export interface UpdateServiceOptions {
  /** Absent in development and in tests of the other paths: only the manual download is offered. */
  installer?: UpdateInstaller;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  getServerOrigin: () => string | null;
  appVersion: string;
  platform: ReleasePlatform;
  arch: ReleaseArch;
  schemaVersion: number;
  protocolVersion: number;
  /** `<userData>/update-state.json`: the install id and the version the user deferred. */
  stateFile: string;
  downloadsDir: () => string;
  showItemInFolder: (file: string) => void;
  openPath: (file: string) => Promise<string>;
  onChange: () => void;
  logger?: Logger;
  now?: () => Date;
}

/** `<userData>/update-pending.json`: written just before the app quits into an update. */
interface PendingInstall {
  version: string;
  previousVersion: string;
  at: string;
}

interface PersistedState {
  installId: string;
  deferredVersion: string | null;
}

export class UpdateService {
  private snap: UpdateSnapshot;
  private persisted: PersistedState | null = null;
  private downloadedPath: string | null = null;
  /** The path the server announced for the current offer (kept out of the renderer-visible state). */
  private offerUrl: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;
  private downloading: Promise<void> | null = null;
  private installing: Promise<void> | null = null;
  /** True from the click on "Update and restart" until that attempt ends. */
  private installActive = false;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor(private readonly options: UpdateServiceOptions) {
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
    this.snap = initialUpdateSnapshot(options.appVersion, channelFor(options.appVersion));
  }

  snapshot(): UpdateSnapshot {
    return this.snap;
  }

  /** True when the server says this version must be replaced. */
  get required(): boolean {
    return this.snap.required;
  }

  /** First check shortly after start, then every 6 hours. Timers never keep the process alive. */
  start(): void {
    if (this.timer || this.first) return;
    this.first = setTimeout(() => {
      this.first = null;
      void this.check();
    }, FIRST_CHECK_DELAY_MS);
    this.first.unref?.();
    this.timer = setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }

  private set(change: Partial<UpdateSnapshot>): void {
    this.snap = { ...this.snap, ...change };
    this.options.onChange();
  }

  private async loadState(): Promise<PersistedState> {
    if (this.persisted) return this.persisted;
    let state: PersistedState = { installId: randomUUID(), deferredVersion: null };
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.options.stateFile, 'utf8'));
      if (raw && typeof raw === 'object') {
        const { installId, deferredVersion } = raw as Record<string, unknown>;
        if (typeof installId === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(installId)) {
          state = {
            installId,
            deferredVersion: typeof deferredVersion === 'string' ? deferredVersion : null,
          };
        }
      }
    } catch {
      // First run, or an unreadable file: a fresh id is generated and written below.
    }
    this.persisted = state;
    await this.saveState();
    return state;
  }

  private async saveState(): Promise<void> {
    if (!this.persisted) return;
    const temporary = `${this.options.stateFile}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.options.stateFile), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(this.persisted), { mode: 0o600 });
      await fs.rename(temporary, this.options.stateFile);
    } catch (error) {
      this.logger.warn('updates.state_not_saved', { reason: errorName(error) });
    }
  }

  // ── Check ─────────────────────────────────────────────────────────────────

  check(): Promise<void> {
    if (this.checking) return this.checking;
    this.checking = this.runCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async runCheck(): Promise<void> {
    if (this.snap.status === 'downloading' || this.installActive) return;
    const origin = this.options.getServerOrigin();
    if (!origin) {
      this.set({
        status: 'unavailable',
        message: 'No server is set, so there is nothing to check.',
      });
      return;
    }
    const state = await this.loadState();
    this.set({ status: this.snap.offer ? this.snap.status : 'checking', message: null });
    const url = new URL('/api/v1/desktop/update', origin);
    url.searchParams.set('platform', this.options.platform);
    url.searchParams.set('arch', this.options.arch);
    url.searchParams.set('channel', this.snap.channel);
    url.searchParams.set('currentVersion', this.options.appVersion);
    url.searchParams.set('installId', state.installId);
    url.searchParams.set('schemaVersion', String(this.options.schemaVersion));
    url.searchParams.set('protocolVersion', String(this.options.protocolVersion));
    try {
      const response = await this.options.fetch(url.href, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const text = await readLimited(response, MAX_CHECK_BYTES);
      if (response.status === 404 || response.status === 405) {
        this.set({
          status: 'unavailable',
          message: 'This server does not publish desktop updates.',
          checkedAt: this.now().toISOString(),
        });
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = DesktopUpdateResponse.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error('unexpected response');
      this.apply(parsed.data, origin, state);
    } catch (error) {
      this.logger.warn('updates.check_failed', { reason: errorName(error) });
      this.set({
        status: this.snap.status === 'downloaded' ? 'downloaded' : 'failed',
        message: 'The update check could not be completed. It will be tried again later.',
        checkedAt: this.now().toISOString(),
      });
    }
  }

  private apply(response: DesktopUpdateResponse, origin: string, state: PersistedState): void {
    const checkedAt = this.now().toISOString();
    const offerable =
      (response.updateAvailable || response.required) &&
      response.version !== null &&
      // Never an older or equal version, whatever the server says.
      isNewer(response.version, this.options.appVersion) &&
      response.downloadUrl !== null &&
      response.sha256 !== null &&
      response.sizeBytes !== null &&
      response.signatureStatus !== null &&
      response.fileName !== null;
    if (!offerable) {
      // Required without anything to download: say so, offer nothing.
      this.set({
        status: response.required ? 'failed' : 'up_to_date',
        required: response.required,
        offer: null,
        deferred: false,
        message: response.required
          ? 'This version is no longer supported, but the server has no download for this computer. Ask its administrator.'
          : null,
        checkedAt,
      });
      return;
    }
    const version = response.version as string;
    const fileName = response.fileName as string;
    const sizeBytes = response.sizeBytes as number;
    // The announced file must be one this app would accept before it is even shown.
    const allowed =
      isSafeArtifactName(fileName) &&
      sizeBytes > 0 &&
      sizeBytes <= MAX_DOWNLOAD_BYTES &&
      resolveDownloadUrl(origin, response.downloadUrl as string, { version, fileName }) !== null;
    if (!allowed) {
      this.logger.warn('updates.offer_rejected', {});
      this.set({
        status: 'failed',
        required: response.required,
        offer: null,
        message: 'The server announced an update this app will not download.',
        checkedAt,
      });
      return;
    }
    const sameOffer = this.snap.offer?.version === version;
    this.offerUrl = response.downloadUrl;
    this.set({
      installBlocker: this.blockerFor(artifactKind(fileName)),
      status: sameOffer && this.snap.status === 'downloaded' ? 'downloaded' : 'available',
      required: response.required,
      offer: {
        version,
        notes: response.notes,
        sizeBytes,
        sha256: response.sha256 as string,
        signatureStatus: response.signatureStatus!,
        releaseNotesUrl: response.releaseNotesUrl,
        fileName,
        kind: artifactKind(fileName),
      },
      deferred: !response.required && state.deferredVersion === version,
      message: null,
      checkedAt,
      ...(sameOffer ? {} : { downloadedFile: null }),
    });
    if (!sameOffer) this.downloadedPath = null;
  }

  // ── Download ──────────────────────────────────────────────────────────────

  download(): Promise<void> {
    if (this.downloading) return this.downloading;
    this.downloading = this.runDownload().finally(() => {
      this.downloading = null;
    });
    return this.downloading;
  }

  private async runDownload(): Promise<void> {
    const offer = this.snap.offer;
    const origin = this.options.getServerOrigin();
    if (!offer || !origin) return;
    // Re-derive the URL from the server's announcement for THIS offer, against the CURRENT origin.
    const url = this.offerUrl ? resolveDownloadUrl(origin, this.offerUrl, offer) : null;
    if (!url) {
      this.fail('The download address is not one this app will use.');
      return;
    }
    const directory = this.options.downloadsDir();
    const finalPath = path.join(directory, offer.fileName);
    const partPath = `${finalPath}.part`;
    this.downloadedPath = null;
    this.set({
      status: 'downloading',
      progress: 0,
      receivedBytes: 0,
      message: null,
      downloadedFile: null,
      ...(this.installActive ? { stage: 'downloading' as const } : {}),
    });
    let handle: fs.FileHandle | null = null;
    try {
      await fs.mkdir(directory, { recursive: true });
      const controller = new AbortController();
      let stall = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
      const response = await this.options.fetch(url.href, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? offer.sizeBytes);
      if (declared !== offer.sizeBytes) throw new SizeMismatch();
      handle = await fs.open(partPath, 'w', 0o644);
      const hash = createHash('sha256');
      let bytes = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          clearTimeout(stall);
          stall = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
          bytes += value.byteLength;
          // More than announced: stop at once instead of filling the disk.
          if (bytes > offer.sizeBytes) throw new SizeMismatch();
          hash.update(value);
          await handle.write(value);
          this.set({ progress: bytes / offer.sizeBytes, receivedBytes: bytes });
        }
      } finally {
        clearTimeout(stall);
      }
      await handle.close();
      handle = null;
      if (this.installActive) this.set({ stage: 'verifying' });
      const verdict = verifyDownload({ bytes, sha256: hash.digest('hex') }, offer);
      if (!verdict.ok) {
        await fs.rm(partPath, { force: true });
        this.fail(
          verdict.reason === 'size'
            ? 'The download is not the size the server announced. It was deleted.'
            : 'The download does not match its SHA-256 checksum. It was deleted and not offered.',
        );
        return;
      }
      await fs.rename(partPath, finalPath);
      this.downloadedPath = finalPath;
      this.set({
        status: 'downloaded',
        progress: 1,
        receivedBytes: bytes,
        downloadedFile: offer.fileName,
      });
      this.logger.info('updates.downloaded', { version: offer.version });
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.rm(partPath, { force: true }).catch(() => undefined);
      this.logger.warn('updates.download_failed', { reason: errorName(error) });
      this.fail(
        error instanceof SizeMismatch
          ? 'The download is not the size the server announced. It was deleted.'
          : 'The download did not finish. Nothing was installed. Try again.',
      );
    }
  }

  private fail(message: string): void {
    this.set({
      status: 'failed',
      progress: null,
      receivedBytes: null,
      stage: null,
      message,
      downloadedFile: null,
    });
  }

  // ── Update and restart ────────────────────────────────────────────────────

  private get outcomeDir(): string {
    return path.dirname(this.options.stateFile);
  }
  private get pendingFile(): string {
    return path.join(this.outcomeDir, 'update-pending.json');
  }
  private get resultFile(): string {
    return path.join(this.outcomeDir, 'update-result.json');
  }

  private blockerFor(kind: 'installer' | 'archive'): string | null {
    if (!this.options.installer) return NO_INSTALLER;
    if (kind !== 'archive') return INSTALLER_PACKAGE;
    try {
      return this.options.installer.blocker();
    } catch {
      return NO_INSTALLER;
    }
  }

  /**
   * "Update and restart". Resolves when the app has been asked to quit into the new version, or
   * when the attempt ended earlier; the snapshot says which. Nothing is changed on failure.
   */
  install(): Promise<void> {
    if (this.installing) return this.installing;
    this.installActive = true;
    this.installing = this.runInstall().finally(() => {
      this.installing = null;
      this.installActive = false;
    });
    return this.installing;
  }

  private async runInstall(): Promise<void> {
    const offer = this.snap.offer;
    const installer = this.options.installer;
    if (!offer) return;
    // Whatever the server says: only ever a later version than the one that runs.
    if (!isNewer(offer.version, this.options.appVersion)) {
      this.set({ message: 'That version is not newer than the one you have.' });
      return;
    }
    const blocker = this.blockerFor(offer.kind);
    if (!installer || blocker) {
      this.set({ installBlocker: blocker ?? NO_INSTALLER });
      return;
    }
    this.set({ notice: null, message: null });

    let file = this.downloadedPath;
    if (this.snap.status === 'downloaded' && file) {
      try {
        await fs.access(file);
      } catch {
        file = null;
      }
    } else {
      file = null;
    }
    if (!file) {
      await this.download();
      file = this.downloadedPath;
      // The download says why it failed; nothing more to do here.
      if (this.snap.status !== 'downloaded' || !file) {
        this.set({ stage: null });
        return;
      }
    }

    const keep = (message: string): void => {
      this.set({ status: 'downloaded', stage: null, message });
    };
    this.set({ status: 'installing', stage: 'unpacking', progress: null });
    let staged: StagedUpdate;
    try {
      staged = await installer.stage(file, offer, (phase) => {
        this.set({ stage: phase === 'unpacking' ? 'unpacking' : 'installing' });
      });
    } catch (error) {
      this.logger.warn('updates.stage_failed', { reason: errorName(error) });
      keep(
        `${displayable(error, 'The update could not be prepared.')} The version you have was kept and nothing was changed.`,
      );
      return;
    }
    this.set({ stage: 'installing' });
    try {
      const pending: PendingInstall = {
        version: offer.version,
        previousVersion: this.options.appVersion,
        at: this.now().toISOString(),
      };
      await fs.mkdir(this.outcomeDir, { recursive: true });
      await fs.writeFile(this.pendingFile, JSON.stringify(pending), { mode: 0o600 });
      this.set({ stage: 'restarting' });
      await installer.handOver(staged, this.resultFile);
      this.logger.info('updates.handed_over', { version: offer.version });
    } catch (error) {
      this.logger.warn('updates.hand_over_failed', { reason: errorName(error) });
      installer.discard(staged);
      await fs.rm(this.pendingFile, { force: true }).catch(() => undefined);
      keep(
        `${displayable(error, 'The update could not be started.')} The version you have was kept and nothing was changed.`,
      );
    }
  }

  /**
   * Called once at start: what did an update started by the previous run come to? The answer is
   * this process's own version, not a file's claim: the update worked exactly when the version
   * that runs now is the one that was to be installed.
   */
  async loadOutcome(): Promise<UpdateNotice | null> {
    let pending: PendingInstall | null = null;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.pendingFile, 'utf8'));
      if (raw && typeof raw === 'object') {
        const { version, previousVersion, at } = raw as Record<string, unknown>;
        if (typeof version === 'string' && version.length <= 64) {
          pending = {
            version,
            previousVersion: typeof previousVersion === 'string' ? previousVersion : '',
            at: typeof at === 'string' ? at : '',
          };
        }
      }
    } catch {
      // No update was under way.
    }
    try {
      this.options.installer?.cleanup();
    } catch {
      // Leftovers are removed on a later start.
    }
    if (!pending) return null;
    let step: string | null = null;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.resultFile, 'utf8'));
      const value = (raw as { step?: unknown } | null)?.step;
      if (typeof value === 'string' && /^[a-z]{1,16}$/.test(value)) step = value;
    } catch {
      // The helper writes a result only when it had to put the previous version back.
    }
    await fs.rm(this.pendingFile, { force: true }).catch(() => undefined);
    await fs.rm(this.resultFile, { force: true }).catch(() => undefined);
    const ok = pending.version === this.options.appVersion;
    const notice: UpdateNotice = ok
      ? { kind: 'updated', version: pending.version }
      : {
          kind: 'failed',
          version: pending.version,
          message: `${installFailureMessage(step)} The version you had (${this.options.appVersion}) was kept and is running.`,
        };
    try {
      await fs.writeFile(
        path.join(this.outcomeDir, 'update-history.json'),
        JSON.stringify({
          ok,
          version: pending.version,
          previousVersion: pending.previousVersion,
          runningVersion: this.options.appVersion,
          step,
          at: this.now().toISOString(),
        }),
        { mode: 0o600 },
      );
    } catch {
      // The record is a convenience.
    }
    this.logger.info('updates.outcome', { ok, step: step ?? 'none' });
    this.set({ notice });
    return notice;
  }

  /** The person closed the "Updated to…" or "Update failed" notice. */
  dismissNotice(): void {
    if (this.snap.notice) this.set({ notice: null });
  }

  // ── After the download ────────────────────────────────────────────────────

  /** `show-in-folder` / `open-installer`: only for a file this service verified, only on request. */
  async reveal(
    action: 'show-in-folder' | 'open-installer',
  ): Promise<{ ok: boolean; message?: string }> {
    const file = this.downloadedPath;
    if (!file || this.snap.status !== 'downloaded') {
      return { ok: false, message: 'There is no verified download to open.' };
    }
    try {
      await fs.access(file);
    } catch {
      this.downloadedPath = null;
      this.set({ status: 'available', downloadedFile: null, progress: null });
      return { ok: false, message: 'The downloaded file is gone. Download it again.' };
    }
    if (action === 'show-in-folder') {
      this.options.showItemInFolder(file);
      return { ok: true };
    }
    const failure = await this.options.openPath(file);
    if (failure) {
      this.logger.warn('updates.open_failed', {});
      return { ok: false, message: 'The operating system could not open the file.' };
    }
    return { ok: true };
  }

  /** "Remind me later". Refused while the update is required. */
  async defer(): Promise<boolean> {
    const offer = this.snap.offer;
    if (!offer || this.snap.required) return false;
    const state = await this.loadState();
    state.deferredVersion = offer.version;
    await this.saveState();
    this.set({ deferred: true });
    return true;
  }
}

class SizeMismatch extends Error {}

/** The installer's errors carry sentences written for the person; anything else gets the fallback. */
function displayable(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'UpdateInstallError' && error.message) {
    return error.message;
  }
  return fallback;
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw new Error('response too large');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (error instanceof Error) return error.name;
  }
  return 'unknown';
}
