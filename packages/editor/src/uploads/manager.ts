/**
 * Upload manager: one per editor instance.
 *
 * Bytes go to the server over HTTP (`api.uploadAsset`), never through Yjs.
 * The document only ever holds a placeholder node with a stable `uploadId`
 * and, after completion, the asset id. This class is the state machine
 * behind those placeholders:
 *
 *   queued → uploading → done
 *                     ↘ queued    (transient failure: automatic retry with backoff)
 *                     ↘ failed    (retry → queued)
 *                     ↘ cancelled (retry → queued)
 *
 * Transient failures (rate limit, network, busy server) never fail a file on
 * the first attempt: the file goes back to the queue and is retried with
 * capped exponential backoff and jitter. A rate-limit answer additionally
 * pauses the whole queue for the time the server asks for, so a paste of many
 * images drains at the pace the server accepts instead of being rejected.
 * Identical files (same SHA-256) are sent once and share the stored asset.
 *
 * Progress and state are local UI state exposed through a per-upload external
 * store, so byte progress never causes document transactions.
 */
import type { ApiClient, Asset } from '@realtimedocs/contracts';
import { describeUploadError, isTransientUploadError, uploadRetryAfterMs } from './limits';

export type UploadPhase = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';
export type UploadKind = 'image' | 'attachment';

export interface UploadSnapshot {
  id: string;
  kind: UploadKind;
  name: string;
  sizeBytes: number;
  phase: UploadPhase;
  /** Fraction of bytes sent (0–1), as reported by the browser. */
  progress: number;
  error: string | null;
  /** Retrying without changing the file can succeed. */
  retryable: boolean;
  /** Local object URL for an instant preview of images (never stored in the document). */
  previewUrl: string | null;
  asset: Asset | null;
  /** Attempts started so far (1 while the first attempt runs). */
  attempt: number;
  /** Epoch milliseconds of the next automatic attempt; null when none is scheduled. */
  retryAt: number | null;
}

interface Entry {
  snapshot: UploadSnapshot;
  blob: Blob;
  abort: AbortController | null;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  digest: string | null;
}

export interface UploadManagerOptions {
  api: ApiClient;
  documentId: string;
  /** Simultaneous uploads; the rest wait in order. */
  concurrency?: number;
  /** Attempts per file before it is shown as failed (manual retry starts over). */
  maxAttempts?: number;
  /** First backoff delay; doubles per attempt up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Test seams. */
  random?: () => number;
  now?: () => number;
  /** Set to false to send identical files separately. */
  dedupe?: boolean;
}

/** Uploads running at the same time per editor. */
export const UPLOAD_CONCURRENCY = 3;
/** Automatic attempts per file for transient failures. */
export const UPLOAD_MAX_ATTEMPTS = 8;
export const UPLOAD_BASE_DELAY_MS = 1_000;
export const UPLOAD_MAX_DELAY_MS = 60_000;

/** Capped exponential backoff with full jitter in the upper half: `[d/2, d]`. */
export function uploadBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

async function digestOf(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof blob.arrayBuffer !== 'function') return null;
    const hash = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export class UploadManager {
  private readonly api: ApiClient;
  private readonly documentId: string;
  private readonly concurrency: number;
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private readonly completionListeners = new Set<(id: string, asset: Asset) => void>();
  private readonly previewsByAsset = new Map<string, string>();
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly dedupe: boolean;
  /** In-flight or finished upload per content digest and kind. */
  private readonly byDigest = new Map<string, Promise<Asset>>();
  private active = 0;
  private destroyed = false;
  /** The server asked every upload to wait until this time (rate limit). */
  private pausedUntil = 0;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: UploadManagerOptions) {
    this.api = options.api;
    this.documentId = options.documentId;
    this.concurrency = Math.max(1, options.concurrency ?? UPLOAD_CONCURRENCY);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? UPLOAD_MAX_ATTEMPTS);
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? UPLOAD_BASE_DELAY_MS);
    this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? UPLOAD_MAX_DELAY_MS);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.dedupe = options.dedupe ?? true;
  }

  /** Registers a file under `id` and starts (or queues) its upload. */
  start(id: string, blob: Blob, name: string, kind: UploadKind): UploadSnapshot {
    let previewUrl: string | null = null;
    if (
      kind === 'image' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      try {
        previewUrl = URL.createObjectURL(blob);
      } catch {
        previewUrl = null;
      }
    }
    const entry: Entry = {
      snapshot: {
        id,
        kind,
        name,
        sizeBytes: blob.size,
        phase: 'queued',
        progress: 0,
        error: null,
        retryable: true,
        previewUrl,
        asset: null,
        attempt: 0,
        retryAt: null,
      },
      blob,
      abort: null,
      listeners: new Set(),
      timer: null,
      digest: null,
    };
    this.entries.set(id, entry);
    this.queue.push(id);
    this.pump();
    return entry.snapshot;
  }

  /** Snapshot of a local upload; undefined for placeholders of other clients. */
  get(id: string): UploadSnapshot | undefined {
    return this.entries.get(id)?.snapshot;
  }

  subscribe(id: string, listener: () => void): () => void {
    const entry = this.entries.get(id);
    if (!entry) return () => {};
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  /** Called with every upload that finishes (also after a retry). */
  onCompleted(listener: (id: string, asset: Asset) => void): () => void {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }

  /** Uploads that finished in this session, by upload id. */
  completedAsset(id: string): Asset | null {
    return this.entries.get(id)?.snapshot.asset ?? null;
  }

  /** Local preview of an image this session uploaded, until the page is closed. */
  previewForAsset(assetId: string): string | null {
    return this.previewsByAsset.get(assetId) ?? null;
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.active + this.queue.length;
  }

  /** Stops an upload that is queued or in flight. */
  cancel(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const { phase } = entry.snapshot;
    if (phase === 'queued') {
      const index = this.queue.indexOf(id);
      if (index !== -1) this.queue.splice(index, 1);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      this.patch(entry, {
        phase: 'cancelled',
        error: 'The upload was cancelled.',
        retryable: true,
        retryAt: null,
      });
    } else if (phase === 'uploading') {
      entry.abort?.abort();
    }
  }

  /** Queues a failed or cancelled upload again. */
  retry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || this.destroyed) return;
    const { phase } = entry.snapshot;
    if (phase !== 'failed' && phase !== 'cancelled') return;
    this.patch(entry, { phase: 'queued', progress: 0, error: null, attempt: 0, retryAt: null });
    this.queue.push(id);
    this.pump();
  }

  /** Makes a destroyed manager usable again (React re-runs effects in development). */
  resume(): void {
    this.destroyed = false;
  }

  destroy(): void {
    this.destroyed = true;
    this.queue.length = 0;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.pausedUntil = 0;
    this.byDigest.clear();
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.abort?.abort();
      entry.listeners.clear();
      const url = entry.snapshot.previewUrl;
      if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    }
    this.entries.clear();
    this.previewsByAsset.clear();
    this.completionListeners.clear();
  }

  private patch(entry: Entry, change: Partial<UploadSnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...change };
    for (const listener of [...entry.listeners]) listener();
  }

  private pump(): void {
    if (this.destroyed) return;
    const wait = this.pausedUntil - this.now();
    if (wait > 0) {
      if (!this.pauseTimer) {
        this.pauseTimer = setTimeout(() => {
          this.pauseTimer = null;
          this.pump();
        }, wait);
      }
      return;
    }
    while (!this.destroyed && this.active < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      const entry = id === undefined ? undefined : this.entries.get(id);
      if (!entry || entry.snapshot.phase !== 'queued') continue;
      void this.run(entry);
    }
  }

  /** Sends the bytes, or joins an identical upload that is running or finished. */
  private async send(entry: Entry, signal: AbortSignal): Promise<Asset> {
    const upload = () =>
      this.api.uploadAsset(this.documentId, entry.blob, entry.snapshot.name, {
        signal,
        onProgress: (fraction) => {
          if (entry.snapshot.phase !== 'uploading') return;
          const progress = Math.min(1, Math.max(entry.snapshot.progress, fraction));
          if (progress !== entry.snapshot.progress) this.patch(entry, { progress });
        },
      });
    if (!this.dedupe) return upload();
    entry.digest ??= await digestOf(entry.blob);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (entry.digest === null) return upload();
    const key = `${entry.snapshot.kind}:${entry.digest}`;
    const existing = this.byDigest.get(key);
    if (existing) {
      try {
        // Cancelling this file must not wait for (or cancel) the upload it joined.
        return await new Promise<Asset>((resolve, reject) => {
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', onAbort, { once: true });
          existing.then(resolve, reject).finally(() => {
            signal.removeEventListener('abort', onAbort);
          });
        });
      } catch (error) {
        if (signal.aborted) throw error;
        // The other upload failed; this file makes its own attempt below.
      }
    }
    const mine = upload();
    this.byDigest.set(key, mine);
    mine.catch(() => {
      if (this.byDigest.get(key) === mine) this.byDigest.delete(key);
    });
    return mine;
  }

  private async run(entry: Entry): Promise<void> {
    this.active += 1;
    const abort = new AbortController();
    entry.abort = abort;
    this.patch(entry, {
      phase: 'uploading',
      progress: 0,
      error: null,
      retryAt: null,
      attempt: entry.snapshot.attempt + 1,
    });
    try {
      const asset = await this.send(entry, abort.signal);
      if (this.destroyed) return;
      if (entry.snapshot.previewUrl) this.previewsByAsset.set(asset.id, entry.snapshot.previewUrl);
      this.patch(entry, { phase: 'done', progress: 1, asset });
      for (const listener of [...this.completionListeners]) listener(entry.snapshot.id, asset);
    } catch (error) {
      if (this.destroyed) return;
      const failure = abort.signal.aborted
        ? { message: 'The upload was cancelled.', retryable: true, cancelled: true }
        : describeUploadError(error);
      const transient = !failure.cancelled && isTransientUploadError(error);
      const asked = uploadRetryAfterMs(error);
      if (asked !== null) {
        // Rate limit: hold the whole queue, not only this file.
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + asked);
      }
      if (transient && entry.snapshot.attempt < this.maxAttempts) {
        const delay = Math.max(
          asked ?? 0,
          uploadBackoffMs(entry.snapshot.attempt, this.baseDelayMs, this.maxDelayMs, this.random),
        );
        this.patch(entry, {
          phase: 'queued',
          progress: 0,
          error: failure.message,
          retryable: true,
          retryAt: this.now() + delay,
        });
        entry.timer = setTimeout(() => {
          entry.timer = null;
          if (this.destroyed || entry.snapshot.phase !== 'queued') return;
          this.queue.push(entry.snapshot.id);
          this.pump();
        }, delay);
      } else {
        this.patch(entry, {
          phase: failure.cancelled ? 'cancelled' : 'failed',
          error: failure.message,
          retryable: failure.retryable,
          retryAt: null,
        });
      }
    } finally {
      entry.abort = null;
      this.active -= 1;
      this.pump();
    }
  }
}
