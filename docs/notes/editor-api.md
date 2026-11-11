# `@realtimedocs/editor` public API (contract between the editor, web and desktop teams)

The editor agent implements exactly these exports from `packages/editor/src/index.ts`.
The web and desktop renderers consume only these. Additional exports are allowed; renames are not.
Everything here is browser code (React 19). DOM-free pieces live in `@realtimedocs/editor/schema`
and `@realtimedocs/editor/export`. Styles: `import '@realtimedocs/editor/styles.css'` (after
`@realtimedocs/ui/styles.css`; uses only `--rd-*` tokens).

## Collaboration session (framework-agnostic)

```ts
import type {
  ApiClient,
  ConnectionState,
  EffectiveRole,
  Participant,
  SaveErrorCode,
  SaveState,
} from '@realtimedocs/contracts';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

export interface CollabSessionOptions {
  api: ApiClient;
  documentId: string;
  /** Account id for local pending-change recovery; null for share-link guests (nothing is persisted). */
  accountId: string | null;
  /** Defaults to `accountId !== null`. Guests can never enable it. */
  localPersistence?: boolean;
  /** Test hooks. */
  WebSocketPolyfill?: unknown;
  indexedDB?: IDBFactory;
}

export interface SessionNotice {
  id: string;
  kind:
    'restored' | 'role_changed' | 'draft_saved' | 'persistence_degraded' | 'persistence_restored';
  /** Human-readable, already localized English text. */
  message: string;
  draftId?: string;
  role?: EffectiveRole;
}

export interface SessionStatus {
  connection: ConnectionState; // connecting | live | reconnecting | offline | access_expired | access_revoked | update_required | document_unavailable
  save: SaveState; // saved | saving | pending | error | read_only
  role: EffectiveRole | null; // as resolved by the server
  canEdit: boolean;
  generation: number | null;
  /** Local transactions not yet durably acknowledged by the server. */
  pendingChanges: number;
  /** True while updates are sent but the server has not applied them yet. */
  unsynced: boolean;
  lastSavedAt: number | null; // epoch ms of the last durable acknowledgement
  saveError: { code: SaveErrorCode; retrying: boolean } | null;
  persistenceDegraded: boolean;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  accessExpiresAt: string | null;
  participants: Participant[]; // server-attested, de-duplicated, excludes nobody
  self: Participant | null;
  notices: SessionNotice[];
  /** True once the first server sync of the current generation has been applied. */
  ready: boolean;
}

export interface CollabSession {
  readonly documentId: string;
  /** Current Y.Doc. Replaced when the generation changes (subscribe to `doc`). */
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

export function createCollabSession(options: CollabSessionOptions): CollabSession;
export function useSessionStatus(session: CollabSession): SessionStatus;
```

Rules the session must implement (see `packages/contracts/src/collab.ts`):
ticket per connection attempt, marker + hello acknowledgement protocol, `Saved` only after `saved`
covers the latest local change, capped exponential backoff with jitter and `retryNow`, terminal states
(`access_revoked`, `access_expired`, `update_required`, `document_unavailable`) stop reconnecting,
role changes switch editability live, generation changes create a fresh Y.Doc and move unsaved work
to a recovery draft, local persistence only when allowed.

## Local recovery store

```ts
export interface RecoveryDraft {
  id: string;
  accountId: string;
  documentId: string;
  documentTitle: string;
  generation: number;
  reason: 'generation_restored' | 'access_removed' | 'manual';
  createdAt: number;
}
export function listRecoveryDrafts(accountId: string): Promise<RecoveryDraft[]>;
export function loadRecoveryDraftJSON(id: string): Promise<DocJSON | null>; // ProseMirror JSON of the draft
export function deleteRecoveryDraft(id: string): Promise<void>;
/** Removes pending-change stores and drafts of one account (call on logout). */
export function clearLocalDataForAccount(accountId: string): Promise<void>;
/** True if the account has unsaved local changes or drafts on this device. */
export function hasLocalDataForAccount(accountId: string): Promise<boolean>;
```

## React components

```tsx
export interface DisplayPreferences {
  fontScale: number; // 0.8 – 1.8, multiplies document font size
  readingWidth: 'narrow' | 'normal' | 'wide' | 'full';
  /** Document colours; `inherit` follows the app theme. */
  tone: 'inherit' | 'dark' | 'light';
}

export interface DocumentEditorProps {
  session: CollabSession;
  api: ApiClient;
  /** `editor`: full toolbar when the role allows editing. `viewer`: reading surface with find.
   *  `panel`: compact desktop panel (no toolbar chrome unless editing, small find bar). */
  variant: 'editor' | 'viewer' | 'panel';
  display?: Partial<DisplayPreferences>;
  /** Follow Latest: optional auto-scroll to remote changes (off by default). */
  followLatest?: boolean;
  onFollowLatestChange?: (value: boolean) => void;
  /** Element that scrolls the document; defaults to the component's own scroll container. */
  scrollContainer?: HTMLElement | null;
  /** Called for link clicks; return true if handled (desktop opens via the main process). */
  onOpenLink?: (href: string) => boolean;
  className?: string;
  'data-testid'?: string;
}
export function DocumentEditor(props: DocumentEditorProps): JSX.Element;

/** "Live · Saved" style indicator with separate connection and save parts, tooltips and retry. */
export function SessionStatusIndicator(props: {
  session: CollabSession;
  compact?: boolean;
}): JSX.Element;
/** Avatars of server-attested participants. */
export function ParticipantStack(props: { session: CollabSession; max?: number }): JSX.Element;
/** Banners for notices (restore, role change, drafts, degraded persistence) and terminal states. */
export function SessionBanners(props: {
  session: CollabSession;
  onOpenDraft?: (draftId: string) => void;
}): JSX.Element;

/** Read-only static rendering of ProseMirror JSON with the same node views (print view, drafts). */
export function StaticDocument(props: {
  content: DocJSON;
  api: ApiClient;
  documentId: string;
  display?: Partial<DisplayPreferences>;
  className?: string;
}): JSX.Element;
```

Required test ids (stable selectors for end-to-end tests):
`rd-editor` (root), `rd-editor-content` (the contenteditable / reading surface), `rd-toolbar`,
`rd-status-connection`, `rd-status-save` (each with `data-state="<ConnectionState|SaveState>"`),
`rd-find-input`, `rd-follow-latest`, `rd-jump-latest`, `rd-upload-placeholder`
(with `data-upload-state="uploading|failed|pending-remote"`), `rd-paste-report`.

## Behaviour that hosts rely on

- The component never steals focus on remote updates and keeps the reader's scroll position.
- Images are displayed through `api.assetUrl(documentId, assetId)`; nothing else is fetched.
- External links open through `onOpenLink` when provided, else `window.open(href, '_blank', 'noopener,noreferrer')`
  after `sanitizeLinkHref`.
- All expensive work (syntax highlighting, Mermaid, paste normalization) stays off the typing path.
