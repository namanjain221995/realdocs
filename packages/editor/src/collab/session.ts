/**
 * Collaboration session: one per open document.
 *
 * Owns the Y.Doc, presence, the Hocuspocus link, ticket fetching, the durable
 * acknowledgement protocol (`mark` / `hello` / `saved`, see
 * `@realtimedocs/contracts` collab.ts), reconnection with capped exponential
 * backoff and jitter, generation changes, role changes and device-local
 * pending-change recovery. Framework-agnostic; React bindings live in
 * `useSessionStatus.ts`.
 *
 * Connection model: every attempt gets a fresh ticket and a fresh
 * `HocuspocusProvider` + `HocuspocusProviderWebsocket` pair. Nothing is reused
 * across attempts, so no queued frame of a dead socket can be replayed on a
 * new one, and the retry policy is entirely this module's (the provider's own
 * retry is limited to one attempt).
 */
import '../contract-additions';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  ApiError,
  COLLAB_PROTOCOL_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  PRESENCE_MIN_INTERVAL_MS,
  ServerStateless,
  Y_FRAGMENT_FIELD,
  canEdit as roleCanEdit,
  type ApiClient,
  type ClientHello,
  type ClientMark,
  type CollabTicketResponse,
  type EffectiveRole,
} from '@realtimedocs/contracts';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { toBase64 } from 'lib0/buffer';
import * as decoding from 'lib0/decoding';
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { DocJSON } from '../schema';
import { RECONNECT_BACKOFF, backoffDelay, type BackoffOptions } from './backoff';
import { uuidv4 } from './ids';
import {
  createDraftId,
  openAccountStore,
  saveRecoveryDraft,
  type AccountStore,
  type RecoveryDraft,
} from './localStore';
import { DocPersistence } from './persistence';
import {
  MESSAGE_AWARENESS,
  PresenceThrottle,
  encodeAwarenessMessage,
  participantsFromAwareness,
} from './presence';
import {
  deriveStatus,
  initialStatusModel,
  mapAccessChange,
  mapAuthFailure,
  mapCloseEvent,
  mapTicketError,
  sameStatus,
  type FailureAction,
  type SessionNotice,
  type SessionStatus,
  type StatusModel,
  type TerminalState,
} from './status';

export interface SessionTiming {
  /** Reconnect policy (capped exponential backoff with jitter). */
  backoff: BackoffOptions;
  /** Local transactions inside this window share one `mark`. */
  markCoalesceMs: number;
  /** While waiting for `saved`, the latest marker is repeated at this interval. */
  ackWatchdogMs: number;
  /** A connection attempt that is not synced by then is abandoned. */
  connectTimeoutMs: number;
  /** `resync` / `forceSync` rounds per connection before reconnecting instead. */
  maxResyncs: number;
  resyncBackoff: BackoffOptions;
  /** Minimum spacing of outgoing presence updates. */
  presenceIntervalMs: number;
}

export const DEFAULT_SESSION_TIMING: SessionTiming = {
  backoff: RECONNECT_BACKOFF,
  markCoalesceMs: 5,
  ackWatchdogMs: 4_000,
  connectTimeoutMs: 15_000,
  maxResyncs: 5,
  resyncBackoff: { baseMs: 150, maxMs: 2_000, factor: 2, jitter: 0.5 },
  presenceIntervalMs: PRESENCE_MIN_INTERVAL_MS + 20,
};

export interface CollabSessionOptions {
  api: ApiClient;
  documentId: string;
  /** Account id for local pending-change recovery; null for share-link guests (nothing is persisted). */
  accountId: string | null;
  /** Defaults to `accountId !== null`. Guests can never enable it. */
  localPersistence?: boolean;
  /** Title used for recovery drafts; looked up from the server when omitted. */
  documentTitle?: string;
  /** Test hooks. */
  WebSocketPolyfill?: unknown;
  indexedDB?: IDBFactory;
  timing?: Partial<SessionTiming>;
}

export interface CollabSession {
  readonly documentId: string;
  /** Current Y.Doc. Replaced when the generation changes (subscribe to `onDocumentReplaced`). */
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  getStatus(): SessionStatus;
  /** `useSyncExternalStore`-compatible: stable snapshot identity until something changes. */
  subscribe(listener: () => void): () => void;
  /** Fires with the new Y.Doc after a generation change (editors must rebind). */
  onDocumentReplaced(listener: (ydoc: Y.Doc) => void): () => void;
  dismissNotice(id: string): void;
  /** Skips the backoff timer and reconnects now. */
  retryNow(): void;
  /** Resolves when every local change so far is durably acknowledged; rejects on terminal states. */
  whenSaved(timeoutMs?: number): Promise<void>;
  destroy(): void;
}

/** Transaction origin of updates loaded from the device store (never re-persisted or counted). */
const STORE_ORIGIN = Symbol('realtimedocs-local-store');
/** Awareness origin of states received from the server (never echoed back). */
const REMOTE_PRESENCE = Symbol('realtimedocs-remote-presence');
/** Hocuspocus `MessageType.SyncStatus`: the server applied (1) or refused (0) an update. */
const MESSAGE_SYNC_STATUS = 8;

const WS_OPEN = 1;

type Timer = ReturnType<typeof setTimeout>;

interface Link {
  readonly id: number;
  readonly documentName: string;
  readonly socket: HocuspocusProviderWebsocket;
  readonly provider: HocuspocusProvider;
  /** Single-use ticket fetched before the socket was opened. */
  ticket: string | null;
  authenticated: boolean;
  /** A `hello` was sent on this connection; markers are only valid after it. */
  helloSent: boolean;
  /**
   * The server refused an update on this connection. From then on a marker
   * says nothing about the refused data, so only an acknowledgement at or
   * above `trustFrom` (the `n` of a later `hello` proof) is accepted.
   */
  refused: boolean;
  trustFrom: number;
  resyncs: number;
  resyncTimer: Timer | null;
  dead: boolean;
}

interface Waiter {
  target: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: Timer | null;
}

const NOTICE_TEXT = {
  restored:
    'An administrator restored this document to an earlier version. You are now viewing the restored version.',
  restoredWithDraft:
    'An administrator restored this document to an earlier version. Your unsaved changes were not merged; they were kept as a separate recovery draft.',
  roleViewer: 'Your access to this document changed to view only.',
  roleEditor: 'You can now edit this document.',
  draftDevice:
    'Your unsaved changes were not published. They were kept on this device as a recovery draft.',
  draftMemory:
    'Your unsaved changes were not published. They are kept as a recovery draft until this page is closed.',
  degraded:
    'The server cannot save changes right now. Your edits stay on this device and are sent when saving resumes.',
  recovered: 'Saving has resumed.',
} as const;

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function isEmptyDoc(doc: Y.Doc): boolean {
  return Y.encodeStateVector(doc).byteLength <= 1;
}

class Session implements CollabSession {
  readonly documentId: string;

  private readonly api: ApiClient;
  private readonly accountId: string | null;
  private readonly persistenceAllowed: boolean;
  private readonly webSocketPolyfill: unknown;
  private readonly idbFactory: IDBFactory | undefined;
  private readonly timing: SessionTiming;

  private doc: Y.Doc;
  private aw: Awareness;
  private model: StatusModel = initialStatusModel();
  private status: SessionStatus = deriveStatus(this.model);
  private readonly listeners = new Set<() => void>();
  private readonly docListeners = new Set<(doc: Y.Doc) => void>();
  private readonly waiters = new Set<Waiter>();
  private destroyed = false;

  private link: Link | null = null;
  private linkSeq = 0;
  private attemptSeq = 0;
  private attempting = false;
  private retryTimer: Timer | null = null;
  private connectTimer: Timer | null = null;
  private markTimer: Timer | null = null;
  private watchdogTimer: Timer | null = null;
  private ticketAbort: AbortController | null = null;
  private generationRetries = 0;
  private readonly presence: PresenceThrottle;

  private store: AccountStore | null = null;
  private persistence: DocPersistence | null = null;
  private storedRows = 0;
  private title: string | null;
  private titleRequested = false;

  constructor(options: CollabSessionOptions) {
    this.documentId = options.documentId;
    this.api = options.api;
    this.accountId = options.accountId;
    this.persistenceAllowed = options.accountId !== null && (options.localPersistence ?? true);
    this.webSocketPolyfill = options.WebSocketPolyfill;
    this.idbFactory = options.indexedDB;
    this.timing = { ...DEFAULT_SESSION_TIMING, ...options.timing };
    this.title = options.documentTitle ?? null;
    this.presence = new PresenceThrottle(() => this.sendPresence(), this.timing.presenceIntervalMs);

    this.doc = new Y.Doc();
    this.aw = new Awareness(this.doc);
    this.bindDocument();

    this.model.online = isOnline();
    this.status = deriveStatus(this.model);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }

    void this.loadLocalReplica().then(() => this.connect());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get ydoc(): Y.Doc {
    return this.doc;
  }

  get awareness(): Awareness {
    return this.aw;
  }

  getStatus = (): SessionStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onDocumentReplaced(listener: (ydoc: Y.Doc) => void): () => void {
    this.docListeners.add(listener);
    return () => {
      this.docListeners.delete(listener);
    };
  }

  dismissNotice(id: string): void {
    if (!this.model.notices.some((notice) => notice.id === id)) return;
    this.update((model) => {
      model.notices = model.notices.filter((notice) => notice.id !== id);
    });
  }

  retryNow(): void {
    if (this.destroyed || this.model.terminal || this.link || this.attempting) return;
    this.connect();
  }

  whenSaved(timeoutMs?: number): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('The session was closed.'));
    if (this.model.terminal) {
      return Promise.reject(new Error(`Changes cannot be saved (${this.model.terminal}).`));
    }
    const target = this.model.n;
    if (this.model.acked >= target) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { target, resolve, reject, timer: null };
      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Timed out waiting for the server to confirm the save.'));
        }, timeoutMs);
      }
      this.waiters.add(waiter);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Nothing is published after this point.
    this.listeners.clear();
    this.docListeners.clear();
    this.attemptSeq += 1;
    this.ticketAbort?.abort();
    this.clearTimers();
    this.presence.cancel();
    this.dropLink();
    this.rejectWaiters(new Error('The session was closed.'));
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
    this.unbindDocument(this.doc, this.aw);
    this.aw.destroy();
    const persistence = this.persistence;
    const store = this.store;
    this.persistence = null;
    this.store = null;
    void (async () => {
      await persistence?.close();
      store?.close();
    })();
  }

  // ── Status plumbing ───────────────────────────────────────────────────────

  private update(mutate: (model: StatusModel) => void): void {
    mutate(this.model);
    const next = deriveStatus(this.model);
    if (sameStatus(next, this.status)) return;
    this.status = next;
    for (const listener of [...this.listeners]) listener();
  }

  private addNotice(notice: Omit<SessionNotice, 'id'>): void {
    this.update((model) => {
      // A notice about the current state replaces an older one of its kind
      // ("view only" followed by "you can edit again"); drafts accumulate.
      const kept =
        notice.kind === 'draft_saved'
          ? model.notices
          : model.notices.filter((entry) => entry.kind !== notice.kind);
      model.notices = [...kept, { ...notice, id: uuidv4() }];
    });
  }

  private removeNotices(kind: SessionNotice['kind']): void {
    if (!this.model.notices.some((notice) => notice.kind === kind)) return;
    this.update((model) => {
      model.notices = model.notices.filter((notice) => notice.kind !== kind);
    });
  }

  // ── Document binding ──────────────────────────────────────────────────────

  private bindDocument(): void {
    this.doc.on('update', this.onDocUpdate);
    this.aw.on('update', this.onAwarenessUpdate);
    this.aw.on('change', this.onAwarenessChange);
  }

  private unbindDocument(doc: Y.Doc, awareness: Awareness): void {
    doc.off('update', this.onDocUpdate);
    awareness.off('update', this.onAwarenessUpdate);
    awareness.off('change', this.onAwarenessChange);
  }

  private readonly onDocUpdate = (
    update: Uint8Array,
    origin: unknown,
    _doc: Y.Doc,
    transaction: Y.Transaction,
  ): void => {
    if (origin === STORE_ORIGIN) return;
    if (transaction.local) {
      // Every local-origin transaction counts: insertions, formatting and
      // deletion-only edits alike. The marker is sent a few milliseconds
      // later, after the provider (registered on the same event) sent the update.
      const wasClean = this.model.n <= this.model.acked;
      this.update((model) => {
        model.n += 1;
      });
      if (wasClean) this.persistence?.setPointer({ dirty: true });
      this.scheduleMark();
    }
    this.persistence?.append(update);
  };

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === REMOTE_PRESENCE) return;
    const local = this.aw.clientID;
    if (
      changes.added.includes(local) ||
      changes.updated.includes(local) ||
      changes.removed.includes(local)
    ) {
      this.presence.schedule();
    }
  };

  private readonly onAwarenessChange = (): void => {
    const participants = participantsFromAwareness(this.aw);
    this.update((model) => {
      model.participants = participants;
    });
  };

  private setLocalUser(): void {
    const self = this.model.self;
    if (!self) return;
    const current = this.aw.getLocalState() as { user?: { id?: string; role?: string } } | null;
    if (current?.user?.id === self.id && current.user.role === self.role) return;
    this.aw.setLocalStateField('user', self);
  }

  /** Replaces the Y.Doc and its awareness; local counters start from zero. */
  private replaceDocument(): void {
    const oldDoc = this.doc;
    const oldAwareness = this.aw;
    this.dropLink();
    this.unbindDocument(oldDoc, oldAwareness);
    this.rejectWaiters(new Error('The pending changes were moved to a recovery draft.'));
    if (this.markTimer !== null) {
      clearTimeout(this.markTimer);
      this.markTimer = null;
    }
    this.clearWatchdog();

    this.doc = new Y.Doc();
    this.aw = new Awareness(this.doc);
    this.bindDocument();
    this.update((model) => {
      model.n = 0;
      model.acked = 0;
      model.ready = false;
      model.hasLocalReplica = false;
      model.unsynced = false;
      model.refused = false;
      model.saveError = null;
      model.participants = [];
    });
    this.setLocalUser();
    for (const listener of [...this.docListeners]) listener(this.doc);
    // Editors rebind synchronously in the listeners above; release the old
    // instances afterwards (the awareness owns an interval timer).
    setTimeout(() => {
      oldAwareness.destroy();
      oldDoc.destroy();
    }, 0);
  }

  // ── Device-local replica ──────────────────────────────────────────────────

  private async loadLocalReplica(): Promise<void> {
    if (!this.persistenceAllowed || this.accountId === null) return;
    try {
      const store = await openAccountStore(this.accountId, this.idbFactory);
      if (this.destroyed) {
        store.close();
        return;
      }
      this.store = store;
      const pointer = await store.getPointer(this.documentId);
      if (!pointer || this.destroyed) return;
      const updates = await store.loadUpdates(this.documentId, pointer.generation);
      if (this.destroyed) return;
      this.storedRows = updates.length;
      if (updates.length > 0) {
        Y.applyUpdate(this.doc, Y.mergeUpdates(updates), STORE_ORIGIN);
      }
      this.title ??= pointer.title;
      this.update((model) => {
        model.generation = pointer.generation;
        model.role = pointer.role;
        model.hasLocalReplica = updates.length > 0;
        // Unacknowledged work from a previous page load counts as one pending
        // change until the `hello` proof of the next connection is answered.
        if (pointer.dirty) model.n = Math.max(model.n, model.acked + 1);
      });
      if (pointer.role !== null && roleCanEdit(pointer.role)) this.startPersistence();
    } catch {
      // The store is a recovery aid: continue without it.
    }
  }

  private startPersistence(): void {
    if (this.persistence || !this.store || this.accountId === null) return;
    const generation = this.model.generation;
    if (generation === null) return;
    this.persistence = new DocPersistence(this.store, {
      accountId: this.accountId,
      documentId: this.documentId,
      generation,
      dirty: this.model.n > this.model.acked,
      role: this.model.role,
      title: this.title,
      storedRows: this.storedRows,
      encodeState: () => Y.encodeStateAsUpdate(this.doc),
    });
    // Seed a partition that starts with content, and fold a long update log
    // of a previous page load into one row.
    if (this.storedRows !== 1 && !isEmptyDoc(this.doc)) this.persistence.requestCompaction();
    this.storedRows = 0;
  }

  private stopPersistence(purge: boolean): void {
    const persistence = this.persistence;
    this.persistence = null;
    this.storedRows = 0;
    if (persistence) {
      void (purge ? persistence.purge() : persistence.close());
    } else if (purge && this.store && this.model.generation !== null) {
      void this.store.clearPartition(this.documentId, this.model.generation).catch(() => {});
    }
  }

  private requestTitle(): void {
    if (this.title !== null || this.titleRequested || !this.persistence) return;
    this.titleRequested = true;
    void this.api.documents
      .get(this.documentId)
      .then(({ document }) => {
        this.title = document.title;
        this.persistence?.setPointer({ title: document.title });
      })
      .catch(() => {
        this.titleRequested = false;
      });
  }

  /**
   * Snapshots the current document as a recovery draft. The content is
   * captured synchronously; storing it happens in the background.
   */
  private captureDraft(reason: RecoveryDraft['reason']): string {
    const content = yDocToProsemirrorJSON(this.doc, Y_FRAGMENT_FIELD) as DocJSON;
    const id = createDraftId(this.accountId);
    const generation = this.model.generation ?? 1;
    const knownTitle = this.title;
    void (async () => {
      let title = knownTitle;
      if (title === null) {
        try {
          title = (await this.api.documents.get(this.documentId)).document.title;
        } catch {
          title = null;
        }
      }
      await saveRecoveryDraft(
        {
          id,
          accountId: this.accountId ?? 'guest',
          documentId: this.documentId,
          documentTitle: title ?? 'Untitled document',
          generation,
          reason,
          createdAt: Date.now(),
          content,
        },
        this.accountId === null ? null : this.idbFactory,
      );
    })();
    return id;
  }

  private draftNoticeText(): string {
    return this.accountId !== null && this.store?.persistent
      ? NOTICE_TEXT.draftDevice
      : NOTICE_TEXT.draftMemory;
  }

  // ── Connection loop ───────────────────────────────────────────────────────

  private clearTimers(): void {
    for (const timer of [this.retryTimer, this.connectTimer, this.markTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.retryTimer = null;
    this.connectTimer = null;
    this.markTimer = null;
    this.clearWatchdog();
  }

  private connect(): void {
    if (this.destroyed || this.model.terminal || this.link || this.attempting) return;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.attempting = true;
    const attempt = ++this.attemptSeq;
    this.update((model) => {
      model.link = 'connecting';
      model.nextRetryAt = null;
    });
    void this.runAttempt(attempt);
  }

  private async requestTicket(): Promise<CollabTicketResponse> {
    this.ticketAbort?.abort();
    const abort = new AbortController();
    this.ticketAbort = abort;
    const base = {
      clientId: this.doc.clientID,
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
    };
    const generation = this.model.generation;
    try {
      return await this.api.collab.ticket(
        this.documentId,
        generation === null ? base : { ...base, generation },
        abort.signal,
      );
    } catch (error) {
      // A server that rejects a stale generation instead of reporting the new
      // one: ask again without it and let `reconcile` handle the difference.
      if (
        error instanceof ApiError &&
        error.code === 'generation_mismatch' &&
        generation !== null
      ) {
        return this.api.collab.ticket(this.documentId, base, abort.signal);
      }
      throw error;
    }
  }

  private async runAttempt(attempt: number): Promise<void> {
    let ticket: CollabTicketResponse;
    try {
      ticket = await this.requestTicket();
    } catch (error) {
      if (attempt !== this.attemptSeq || this.destroyed) return;
      this.attempting = false;
      this.handleFailure(mapTicketError(error));
      return;
    }
    if (attempt !== this.attemptSeq || this.destroyed) return;

    if (this.reconcile(ticket)) {
      // The Y.Doc was replaced, so its client id changed and the ticket (bound
      // to the old id) cannot be used. Ask for a new one right away.
      this.attempting = false;
      this.connect();
      return;
    }
    this.openLink(ticket);
    this.attempting = false;
  }

  /**
   * Applies what the server said about generation, role and identity before
   * any document data is exchanged. Returns true when the Y.Doc was replaced.
   */
  private reconcile(ticket: CollabTicketResponse): boolean {
    const previousGeneration = this.model.generation;
    const previousRole = this.model.role;
    const pending = this.model.n > this.model.acked;
    const canEditNow = roleCanEdit(ticket.role);
    const identity = (model: StatusModel): void => {
      model.role = ticket.role;
      model.self = ticket.participant;
      model.accessExpiresAt = ticket.accessExpiresAt;
    };

    if (previousGeneration !== null && previousGeneration !== ticket.generation) {
      this.switchGeneration(ticket.generation);
      this.update(identity);
      this.setLocalUser();
      return true;
    }

    if (!canEditNow && pending) {
      // Edit access was removed while unsent work existed: keep it as a draft
      // and continue from a clean copy, so it can never be published later.
      const draftId = this.captureDraft('access_removed');
      this.stopPersistence(true);
      this.replaceDocument();
      this.update((model) => {
        identity(model);
        model.generation = ticket.generation;
      });
      this.setLocalUser();
      this.addNotice({ kind: 'draft_saved', message: this.draftNoticeText(), draftId });
      this.addNotice({ kind: 'role_changed', message: NOTICE_TEXT.roleViewer, role: ticket.role });
      return true;
    }

    this.update((model) => {
      identity(model);
      model.generation = ticket.generation;
    });
    this.setLocalUser();
    if (canEditNow) {
      this.startPersistence();
      this.persistence?.setPointer({ role: ticket.role });
    } else {
      // Viewers have nothing to recover: do not keep a copy on the device.
      this.stopPersistence(true);
    }
    if (previousRole !== null && roleCanEdit(previousRole) !== canEditNow) {
      this.addNotice({
        kind: 'role_changed',
        message: canEditNow ? NOTICE_TEXT.roleEditor : NOTICE_TEXT.roleViewer,
        role: ticket.role,
      });
    }
    return false;
  }

  /**
   * Moves to a new document generation: unacknowledged work of the old one is
   * kept as a recovery draft, the old Y.Doc is abandoned (never merged) and a
   * fresh one is created for the new room.
   */
  private switchGeneration(generation: number): void {
    if (this.model.generation === generation) return;
    const pending = this.model.n > this.model.acked;
    const visible = this.model.ready || this.model.hasLocalReplica;
    const draftId = pending ? this.captureDraft('generation_restored') : undefined;
    this.stopPersistence(true);
    this.replaceDocument();
    this.update((model) => {
      model.generation = generation;
    });
    if (pending || visible) {
      this.addNotice({
        kind: 'restored',
        message: draftId ? NOTICE_TEXT.restoredWithDraft : NOTICE_TEXT.restored,
        draftId,
      });
    }
  }

  private openLink(ticket: CollabTicketResponse): void {
    const socket = new HocuspocusProviderWebsocket({
      url: this.api.collabUrl(),
      WebSocketPolyfill: this.webSocketPolyfill,
      // One attempt per socket: retries, backoff and jitter are this module's.
      maxAttempts: 1,
      delay: 60_000,
      messageReconnectTimeout: 30_000,
    });
    const link: Link = {
      id: ++this.linkSeq,
      documentName: ticket.documentName,
      socket,
      provider: undefined as unknown as HocuspocusProvider,
      ticket: ticket.ticket,
      authenticated: false,
      helloSent: false,
      refused: false,
      trustFrom: Number.POSITIVE_INFINITY,
      resyncs: 0,
      resyncTimer: null,
      dead: false,
    };
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: ticket.documentName,
      document: this.doc,
      // Presence is carried by this module (see presence.ts).
      awareness: null,
      token: () => this.provideTicket(link),
    });
    (link as { provider: HocuspocusProvider }).provider = provider;
    this.link = link;

    provider.on('authenticated', () => {
      if (link.dead) return;
      link.authenticated = true;
      this.presence.flush();
    });
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      this.failLink(link, mapAuthFailure(reason));
    });
    provider.on('synced', () => this.onSynced(link));
    provider.on('stateless', ({ payload }: { payload: string }) => this.onStateless(link, payload));
    provider.on('unsyncedChanges', ({ number }: { number: number }) => {
      if (link.dead) return;
      this.update((model) => {
        model.unsynced = number > 0;
      });
    });
    provider.on(
      'message',
      ({
        message,
      }: {
        message: {
          decoder: decoding.Decoder;
          readVarString(): string;
          readVarUint(): number;
          readVarUint8Array(): Uint8Array;
        };
      }) => {
        if (link.dead) return;
        try {
          message.readVarString();
          const type = message.readVarUint();
          if (type === MESSAGE_AWARENESS) {
            applyAwarenessUpdate(this.aw, message.readVarUint8Array(), REMOTE_PRESENCE);
          } else if (type === MESSAGE_SYNC_STATUS && decoding.readVarInt(message.decoder) !== 1) {
            this.onUpdateRefused(link);
          }
        } catch {
          // A malformed presence frame is not worth a reconnect.
        }
      },
    );
    // Fires for a closed WebSocket and for a Hocuspocus CLOSE message.
    provider.on('close', ({ event }: { event?: { code?: number; reason?: string } }) => {
      this.failLink(link, mapCloseEvent(event));
    });
    socket.on('maxAttemptsFailed', () => this.failLink(link, { kind: 'retry' }));

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.failLink(link, { kind: 'retry' });
    }, this.timing.connectTimeoutMs);

    provider.attach();
  }

  private async provideTicket(link: Link): Promise<string> {
    if (link.ticket !== null) {
      const ticket = link.ticket;
      link.ticket = null;
      return ticket;
    }
    // The server asked this connection to authenticate again.
    const fresh = await this.requestTicket();
    return fresh.ticket;
  }

  private isLive(link: Link): boolean {
    return (
      !link.dead &&
      this.link === link &&
      this.model.link === 'live' &&
      link.socket.webSocket?.readyState === WS_OPEN
    );
  }

  private onSynced(link: Link): void {
    if (link.dead || this.link !== link) return;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.generationRetries = 0;
    this.update((model) => {
      model.link = 'live';
      model.everLive = true;
      model.ready = true;
      model.reconnectAttempt = 0;
      model.nextRetryAt = null;
    });
    this.requestTitle();
    this.sendHello(link);
  }

  /**
   * (Re)connect proof: the snapshot carries the state vector and the delete
   * set, so the server can confirm it holds every local struct and deletion.
   * Sent after the sync handshake, i.e. after this client's SyncStep2 reply.
   */
  private sendHello(link: Link): void {
    if (!this.isLive(link)) return;
    const role = this.model.role;
    if ((role === null || !roleCanEdit(role)) && this.model.n <= this.model.acked) return;
    if (link.refused) {
      // Advance `n` so that no marker sent before the refusal can be mistaken
      // for the answer to this proof.
      this.update((model) => {
        model.n += 1;
      });
      link.trustFrom = this.model.n;
    }
    const message: ClientHello = {
      t: 'hello',
      n: this.model.n,
      snapshot: toBase64(Y.encodeSnapshot(Y.snapshot(this.doc))),
    };
    link.helloSent = true;
    link.provider.sendStateless(JSON.stringify(message));
    this.armWatchdog();
  }

  private scheduleMark(): void {
    if (this.markTimer !== null) return;
    this.markTimer = setTimeout(() => {
      this.markTimer = null;
      this.sendMark();
    }, this.timing.markCoalesceMs);
  }

  private sendMark(): void {
    const link = this.link;
    // Before the `hello` of a connection, the hello itself carries `n`; after
    // a refused update only a new `hello` can prove anything.
    if (!link || !link.helloSent || link.refused || !this.isLive(link)) return;
    if (this.model.n <= this.model.acked) return;
    const message: ClientMark = { t: 'mark', n: this.model.n };
    link.provider.sendStateless(JSON.stringify(message));
    this.armWatchdog();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (this.model.n > this.model.acked) this.sendMark();
    }, this.timing.ackWatchdogMs);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * The server answered an update with "not applied": this connection is
   * read-only on the server or the document is not accepting edits. The data
   * stays local and pending; a marker must not be able to acknowledge it.
   */
  private onUpdateRefused(link: Link): void {
    if (link.dead || this.link !== link) return;
    link.refused = true;
    link.trustFrom = Number.POSITIVE_INFINITY;
    this.update((model) => {
      model.refused = true;
    });
    const role = this.model.role;
    // While the server announced that it is not accepting edits, wait for its
    // `persistence ok`. Otherwise try the proof again (bounded), which ends in
    // a reconnect and a fresh ticket that reports the current role.
    if (!this.model.persistenceDegraded && role !== null && roleCanEdit(role)) {
      this.resync(link, false);
    }
  }

  /** `forceSync` followed by a new `hello`, bounded per connection. */
  private resync(link: Link, immediate: boolean): void {
    if (!this.isLive(link) || link.resyncTimer !== null) return;
    if (link.resyncs >= this.timing.maxResyncs) {
      this.failLink(link, { kind: 'retry' });
      return;
    }
    link.resyncs += 1;
    const delay =
      immediate && link.resyncs === 1 ? 0 : backoffDelay(link.resyncs, this.timing.resyncBackoff);
    link.resyncTimer = setTimeout(() => {
      link.resyncTimer = null;
      if (!this.isLive(link)) return;
      link.helloSent = false;
      // `synced` only fires on a false → true transition; reset it so the
      // SyncStep2 answering `forceSync` triggers `onSynced` and a new hello.
      link.provider.synced = false;
      link.provider.forceSync();
    }, delay);
  }

  private onStateless(link: Link, payload: string): void {
    if (link.dead || this.link !== link) return;
    let message: ServerStateless;
    try {
      const parsed = ServerStateless.safeParse(JSON.parse(payload));
      if (!parsed.success) return;
      message = parsed.data;
    } catch {
      return;
    }
    switch (message.t) {
      case 'saved':
        this.onSaved(message.n, link);
        break;
      case 'resync':
        this.resync(link, true);
        break;
      case 'save-error': {
        const { code, retrying } = message;
        this.update((model) => {
          model.saveError = { code, retrying };
        });
        // The server does not hold these updates; this client still does.
        // (While it announced that it accepts no edits, wait for its "ok".)
        if (!retrying && code !== 'generation_changed' && !this.model.persistenceDegraded) {
          this.resync(link, false);
        }
        break;
      }
      case 'persistence':
        this.onPersistence(link, message.state === 'degraded');
        break;
      case 'access': {
        const terminal = mapAccessChange(message.change);
        if (terminal) this.enterTerminal(terminal);
        else if (message.role) this.applyRoleChange(message.role);
        break;
      }
      case 'generation':
        this.switchGeneration(message.generation);
        this.connect();
        break;
      case 'shutdown':
        // The close that follows goes through the normal backoff.
        break;
    }
  }

  private onSaved(n: number, link: Link): void {
    if (link.refused) {
      if (n < link.trustFrom) return;
      link.refused = false;
    }
    const acked = Math.max(this.model.acked, Math.min(n, this.model.n));
    link.resyncs = 0;
    this.update((model) => {
      model.acked = acked;
      model.refused = false;
      model.lastSavedAt = Date.now();
      model.saveError = null;
    });
    if (acked >= this.model.n) {
      this.clearWatchdog();
      this.persistence?.setPointer({ dirty: false });
    }
    for (const waiter of [...this.waiters]) {
      if (acked >= waiter.target) {
        this.waiters.delete(waiter);
        if (waiter.timer !== null) clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  }

  private onPersistence(link: Link, degraded: boolean): void {
    if (degraded) {
      if (this.model.persistenceDegraded) return;
      this.update((model) => {
        model.persistenceDegraded = true;
      });
      this.removeNotices('persistence_restored');
      this.addNotice({ kind: 'persistence_degraded', message: NOTICE_TEXT.degraded });
      return;
    }
    if (!this.model.persistenceDegraded) return;
    this.update((model) => {
      model.persistenceDegraded = false;
      model.saveError = null;
    });
    this.removeNotices('persistence_degraded');
    this.addNotice({ kind: 'persistence_restored', message: NOTICE_TEXT.recovered });
    // Updates refused while degraded are still local: sync and prove again.
    link.resyncs = 0;
    this.resync(link, true);
  }

  private applyRoleChange(role: EffectiveRole): void {
    const previous = this.model.role;
    if (previous === role) return;
    const couldEdit = previous !== null && roleCanEdit(previous);
    const canEditNow = roleCanEdit(role);
    const pending = this.model.n > this.model.acked;
    this.update((model) => {
      model.role = role;
      if (model.self) model.self = { ...model.self, role };
    });
    this.setLocalUser();
    if (couldEdit !== canEditNow) {
      this.addNotice({
        kind: 'role_changed',
        message: canEditNow ? NOTICE_TEXT.roleEditor : NOTICE_TEXT.roleViewer,
        role,
      });
    }
    if (couldEdit && !canEditNow) {
      if (pending) {
        const draftId = this.captureDraft('access_removed');
        this.stopPersistence(true);
        const generation = this.model.generation;
        this.replaceDocument();
        this.update((model) => {
          model.generation = generation;
        });
        this.addNotice({ kind: 'draft_saved', message: this.draftNoticeText(), draftId });
        this.connect();
      } else {
        this.stopPersistence(true);
      }
    } else if (!couldEdit && canEditNow) {
      // The server-side connection was opened read-only; a new ticket opens a
      // read-write one and refreshes the attested identity.
      this.dropLink();
      this.update((model) => {
        model.link = 'idle';
      });
      this.connect();
    } else {
      this.persistence?.setPointer({ role });
    }
  }

  private enterTerminal(state: TerminalState): void {
    if (this.model.terminal || this.destroyed) return;
    this.attemptSeq += 1;
    this.attempting = false;
    this.ticketAbort?.abort();
    this.clearTimers();
    this.dropLink();
    const pending = this.model.n > this.model.acked;
    const draftId = pending ? this.captureDraft('access_removed') : undefined;
    this.update((model) => {
      model.terminal = state;
      model.link = 'idle';
      model.nextRetryAt = null;
      model.unsynced = false;
    });
    if (draftId) this.addNotice({ kind: 'draft_saved', message: this.draftNoticeText(), draftId });
    this.rejectWaiters(new Error(`Changes cannot be saved (${state}).`));
    // Access is gone for good: do not keep a replica on the device.
    if (state === 'access_revoked' || state === 'document_unavailable') this.stopPersistence(true);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private failLink(link: Link, action: FailureAction): void {
    if (link.dead || this.link !== link || this.destroyed) return;
    this.dropLink();
    this.handleFailure(action);
  }

  private handleFailure(action: FailureAction): void {
    if (this.destroyed || this.model.terminal) return;
    switch (action.kind) {
      case 'terminal':
        this.enterTerminal(action.state);
        return;
      case 'generation':
        // The next ticket reports the new generation. Guard against a server
        // that keeps answering "mismatch" by falling back to backoff.
        this.generationRetries += 1;
        if (this.generationRetries <= 2) {
          this.update((model) => {
            model.link = 'idle';
          });
          this.connect();
          return;
        }
        this.scheduleRetry();
        return;
      case 'retry':
        this.scheduleRetry(action.retryAfterMs);
    }
  }

  private scheduleRetry(minimumDelayMs = 0): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    const attempt = this.model.reconnectAttempt + 1;
    const delay = Math.max(minimumDelayMs, backoffDelay(attempt, this.timing.backoff));
    this.update((model) => {
      model.link = 'waiting';
      model.reconnectAttempt = attempt;
      model.nextRetryAt = Date.now() + delay;
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Tears down the current provider and socket without scheduling anything. */
  private dropLink(): void {
    const link = this.link;
    if (!link) return;
    this.link = null;
    link.dead = true;
    if (link.resyncTimer !== null) clearTimeout(link.resyncTimer);
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.clearWatchdog();
    this.presence.cancel();
    try {
      link.provider.destroy();
    } catch {
      // Already torn down.
    }
    try {
      link.socket.destroy();
    } catch {
      // Already torn down.
    }
    const others = [...this.aw.getStates().keys()].filter((id) => id !== this.aw.clientID);
    if (others.length > 0) removeAwarenessStates(this.aw, others, REMOTE_PRESENCE);
    this.update((model) => {
      if (model.link === 'live' || model.link === 'connecting') model.link = 'idle';
      model.unsynced = false;
      model.refused = false;
    });
  }

  private sendPresence(): void {
    const link = this.link;
    if (!link || link.dead || !link.authenticated) return;
    if (link.socket.webSocket?.readyState !== WS_OPEN) return;
    const clientId = this.aw.clientID;
    const local = this.aw.getLocalState();
    let states: Map<number, Record<string, unknown>> | undefined;
    const role = this.model.role;
    if (local && local.cursor != null && (role === null || !roleCanEdit(role))) {
      // Viewers publish presence without a cursor.
      states = new Map(this.aw.getStates());
      states.set(clientId, { ...local, cursor: null });
    }
    link.socket.send(encodeAwarenessMessage(link.documentName, this.aw, [clientId], states));
  }

  private readonly onOnline = (): void => {
    this.update((model) => {
      model.online = true;
    });
    this.retryNow();
  };

  private readonly onOffline = (): void => {
    this.update((model) => {
      model.online = false;
    });
    // The browser reports that no network is available: stop claiming "Live".
    // Retries continue with backoff in case the signal is wrong.
    if (this.link) this.failLink(this.link, { kind: 'retry' });
  };
}

export function createCollabSession(options: CollabSessionOptions): CollabSession {
  return new Session(options);
}

/**
 * True if leaving the page now could lose work: local changes exist that the
 * server has not durably acknowledged. Hosts use it for a `beforeunload` guard.
 */
export function hasUnsavedChanges(session: CollabSession): boolean {
  const status = session.getStatus();
  return status.pendingChanges > 0 && status.save !== 'read_only';
}

/**
 * Installs a `beforeunload` prompt that is only active while `hasUnsavedChanges`
 * is true. Returns a function that removes it.
 */
export function installBeforeUnloadGuard(session: CollabSession): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges(session)) return;
    event.preventDefault();
    // Required by some browsers to show the prompt.
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
