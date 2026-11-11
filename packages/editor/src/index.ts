/**
 * Public API of `@realtimedocs/editor` (browser code, React 19).
 *
 * The contract with the web and desktop teams is `docs/notes/editor-api.md`;
 * everything named there is exported here under the same name. DOM-free
 * pieces live in `@realtimedocs/editor/schema` and `@realtimedocs/editor/export`.
 * Styles: `import '@realtimedocs/editor/styles.css'` after the UI kit's.
 */

// Must stay the first import: see contract-additions.ts.
import './contract-additions';

// ── Collaboration session (framework-agnostic) ──────────────────────────────
export {
  DEFAULT_SESSION_TIMING,
  createCollabSession,
  hasUnsavedChanges,
  installBeforeUnloadGuard,
} from './collab/session';
export type { CollabSession, CollabSessionOptions, SessionTiming } from './collab/session';
export { isTerminalState } from './collab/status';
export type { SessionNotice, SessionStatus, TerminalState } from './collab/status';
export { RECONNECT_BACKOFF, backoffDelay } from './collab/backoff';
export type { BackoffOptions } from './collab/backoff';

// ── Local recovery store ────────────────────────────────────────────────────
export {
  clearLocalDataForAccount,
  configureLocalStore,
  deleteRecoveryDraft,
  hasLocalDataForAccount,
  listRecoveryDrafts,
  loadRecoveryDraftJSON,
} from './collab/localStore';
export type { RecoveryDraft } from './collab/localStore';

// ── React components and hooks ──────────────────────────────────────────────
export { DocumentEditor, openExternalLink } from './react/DocumentEditor';
export type { DocumentEditorProps } from './react/DocumentEditor';
export { StaticDocument, validateDocJSON } from './react/StaticDocument';
export type { StaticDocumentProps } from './react/StaticDocument';
export { ParticipantStack, SessionBanners, SessionStatusIndicator } from './react/SessionStatus';
export { useSessionSelector, useSessionStatus } from './react/sessionHooks';
export { DEFAULT_DISPLAY } from './react/display';
export type { DisplayPreferences } from './react/display';
export { formatShortcut, isMacPlatform } from './react/platform';

// ── Clipboard and uploads (limits and report types for hosts and tests) ─────
export {
  MAX_PASTE_HTML_LENGTH,
  MAX_PASTE_IMAGES,
  MAX_PASTE_TEXT_LENGTH,
  processPastedHtml,
} from './clipboard/process';
export type { PasteNote, PasteNoteKind, PasteReport, PasteSource } from './clipboard/report';
export { UPLOAD_CONCURRENCY } from './uploads/manager';
export { describeUploadError, formatBytes } from './uploads/limits';

// ── Schema conveniences (the authoritative module is `./schema`) ────────────
export { sanitizeLinkHref } from './schema';
export type { DocJSON } from './schema';
