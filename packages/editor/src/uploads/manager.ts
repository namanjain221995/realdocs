/**
 * Upload manager: one per editor instance.
 *
 * Bytes go to the server over HTTP (`api.uploadAsset`), never through Yjs.
 * The document only ever holds a placeholder node with a stable `uploadId`
 * and, after completion, the asset id. This class is the state machine
 * behind those placeholders:
 *
 *   queued → uploading → done
 *                     ↘ failed    (retry → queued)
 *                     ↘ cancelled (retry → queued)
 *
 * Progress and state are local UI state exposed through a per-upload external
 * store, so byte progress never causes document transactions.
 */
import type { ApiClient, Asset } from '@realtimedocs/contracts';
import { describeUploadError } from './limits';

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
}

interface Entry {
  snapshot: UploadSnapshot;
  blob: Blob;
  abort: AbortController | null;
  listeners: Set<() => void>;
}

export interface UploadManagerOptions {
  api: ApiClient;
  documentId: string;
  /** Simultaneous uploads; the rest wait in order. */
  concurrency?: number;
}

/** Uploads running at the same time per editor. */
export const UPLOAD_CONCURRENCY = 3;

export class UploadManager {
  private readonly api: ApiClient;
  private readonly documentId: string;
  private readonly concurrency: number;
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private readonly completionListeners = new Set<(id: string, asset: Asset) => void>();
  private readonly previewsByAsset = new Map<string, string>();
  private active = 0;
  private destroyed = false;

  constructor(options: UploadManagerOptions) {
    this.api = options.api;
    this.documentId = options.documentId;
    this.concurrency = Math.max(1, options.concurrency ?? UPLOAD_CONCURRENCY);
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
      },
      blob,
      abort: null,
      listeners: new Set(),
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
      this.patch(entry, {
        phase: 'cancelled',
        error: 'The upload was cancelled.',
        retryable: true,
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
    this.patch(entry, { phase: 'queued', progress: 0, error: null });
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
    for (const entry of this.entries.values()) {
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
    while (!this.destroyed && this.active < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      const entry = id === undefined ? undefined : this.entries.get(id);
      if (!entry || entry.snapshot.phase !== 'queued') continue;
      void this.run(entry);
    }
  }

  private async run(entry: Entry): Promise<void> {
    this.active += 1;
    const abort = new AbortController();
    entry.abort = abort;
    this.patch(entry, { phase: 'uploading', progress: 0, error: null });
    try {
      const asset = await this.api.uploadAsset(this.documentId, entry.blob, entry.snapshot.name, {
        signal: abort.signal,
        onProgress: (fraction) => {
          if (entry.snapshot.phase !== 'uploading') return;
          const progress = Math.min(1, Math.max(entry.snapshot.progress, fraction));
          if (progress !== entry.snapshot.progress) this.patch(entry, { progress });
        },
      });
      if (this.destroyed) return;
      if (entry.snapshot.previewUrl) this.previewsByAsset.set(asset.id, entry.snapshot.previewUrl);
      this.patch(entry, { phase: 'done', progress: 1, asset });
      for (const listener of [...this.completionListeners]) listener(entry.snapshot.id, asset);
    } catch (error) {
      if (this.destroyed) return;
      const failure = describeUploadError(error);
      this.patch(entry, {
        phase: failure.cancelled ? 'cancelled' : 'failed',
        error: failure.message,
        retryable: failure.retryable,
      });
    } finally {
      entry.abort = null;
      this.active -= 1;
      this.pump();
    }
  }
}
