/**
 * The state snapshot the main process publishes to app windows.
 *
 * It is the only data that crosses from the main process to a renderer. By
 * construction it contains no session token, share secret or handoff code:
 * `DocumentSessionInfo` describes the open document, never the credential.
 */
import type { ConnectionState, EffectiveRole, SaveState } from '@realtimedocs/contracts';
import type { CaptureStatus, WindowProtectionResult } from './capture';
import type { DisplayInfo, RecoveryReason, Rect } from './geometry';
import type {
  AppearancePreferences,
  BehaviourPreferences,
  PinLevel,
  ProbeRecord,
} from './preferences';
import type { PresenceState } from './presence';
import type { ServerTransport } from './server-origin';
import type { DesktopPlatform, ShortcutAction } from './shortcuts';

export const SETTINGS_TABS = [
  'connection',
  'appearance',
  'behaviour',
  'privacy',
  'privacy-test-center',
  'diagnostics',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

export interface AppInfo {
  name: 'RealtimeDocs';
  version: string;
  platform: DesktopPlatform;
  arch: string;
  /** `process.getSystemVersion()`. */
  systemVersion: string;
  electronVersion: string;
  chromeVersion: string;
  packaged: boolean;
}

/**
 * How the document is shown. `presenter`: Private Presenter Mode, the
 * transparent frameless panel with every presenter behaviour. `normal`: an
 * ordinary framed window, in the taskbar and the Dock, never on top, never
 * click-through. The same page and the same restrictions in both.
 */
export const DOCUMENT_MODES = ['presenter', 'normal'] as const;
export type DocumentMode = (typeof DOCUMENT_MODES)[number];

export interface PanelState {
  mode: DocumentMode;
  visible: boolean;
  focused: boolean;
  collapsed: boolean;
  pinned: boolean;
  pinLevel: PinLevel;
  clickThrough: boolean;
  /** False when no recovery path (shortcut or tray) is registered; click-through is refused then. */
  canEnterClickThrough: boolean;
  /** Why click-through is refused, for display. */
  clickThroughBlockedReason: string | null;
  /** Ways back from click-through that are available right now. */
  recoveryPaths: { shortcut: boolean; tray: boolean; hoverBadge: boolean };
  /** False when hiding would leave no way to bring the panel back. */
  canHide: boolean;
  bounds: Rect;
  displayId: number | null;
  visibleOnAllWorkspaces: boolean;
  visibleOnFullScreen: boolean;
  /** Set when saved bounds had to be corrected (monitor removed, off-screen, DPI change). */
  lastRecovery: { reason: RecoveryReason; at: string } | null;
  /**
   * Private mode was on and the display the panel was on went away, so the
   * panel was hidden (or, where it cannot be hidden, collapsed) instead of
   * being moved to another display. Only a user action clears it.
   */
  parked: 'display_removed' | null;
}

export type ServerStatus =
  | 'unset'
  | 'unchecked'
  | 'checking'
  | 'ok'
  | 'unreachable'
  | 'not_realtimedocs'
  | 'update_required';

export interface ServerInfo {
  origin: string | null;
  transport: ServerTransport | null;
  status: ServerStatus;
  /** Human-readable explanation of the status, safe to display. */
  message: string | null;
  serverVersion: string | null;
  /** The address the server reports as its public origin (`GET /api/meta`). */
  publicOrigin: string | null;
  checkedAt: string | null;
}

/** The document the desktop session is scoped to. Never includes the token. */
export interface DocumentSessionInfo {
  documentId: string;
  title: string;
  role: EffectiveRole;
  expiresAt: string | null;
  /** Null for share-link guests. */
  accountId: string | null;
  via: 'handoff' | 'share_link';
  /** True when the session was restored from the encrypted reference at startup. */
  restored: boolean;
  /**
   * Changes whenever the main process starts using another credential (a new
   * link, a new handoff, a restore), also for the same document. The panel
   * starts a fresh editor session when it changes. Not a secret.
   */
  sequence: number;
}

/** Live status reported by the panel's editor session. */
export interface SessionReport {
  /** `DocumentSessionInfo.sequence` of the session this report is about. */
  sequence: number;
  connection: ConnectionState;
  save: SaveState;
  role: EffectiveRole | null;
  title: string | null;
  at: string;
}

export interface Notice {
  id: string;
  tone: NoticeTone;
  /** Machine-readable reason, e.g. `share_expired`, `server_mismatch`. */
  code: string;
  message: string;
  at: string;
}

export interface ConnectionSnapshot {
  server: ServerInfo;
  session: DocumentSessionInfo | null;
  report: SessionReport | null;
  /**
   * `confirming`: the main process is showing its own dialog and waits for the
   * user's answer to "use another server?". No window can give that answer.
   */
  busy: 'checking' | 'opening' | 'disconnecting' | 'confirming' | null;
  notice: Notice | null;
  /** The development override preference. */
  allowInsecureLan: boolean;
  acceptedLinkOrigin: string | null;
}

export interface CredentialStorageInfo {
  mode: 'os_encrypted' | 'memory_only';
  /** Linux: the selected secret-store backend. Null elsewhere. */
  backend: string | null;
  detail: string;
}

export type ShortcutRegistrationError = 'in_use' | 'invalid' | 'duplicate' | 'suspended';

export interface ShortcutStatus {
  action: ShortcutAction;
  accelerator: string;
  keyCaps: string[];
  registered: boolean;
  error: ShortcutRegistrationError | null;
  isDefault: boolean;
}

export interface ShortcutsState {
  items: ShortcutStatus[];
  /** True while the settings window records a new combination (handling suspended). */
  recording: boolean;
}

export interface TrayInfo {
  available: boolean;
  error: string | null;
}

/** The optional Windows diagnostics module, as Settings → Diagnostics shows it. */
export interface NativeDiagnosticsInfo {
  present: boolean;
  /** First 12 hex digits of the module's SHA-256, when present. */
  sha256Prefix: string | null;
  /** Why it is not present (`wrong_platform`, `file_missing`, `hash_mismatch`, …). */
  reason: string | null;
  /** "Diagnostics module not present — status from Electron only", or null. */
  label: string | null;
  /** Raw affinity of the panel window as last read, e.g. `exclude_from_capture`. */
  affinity: string | null;
  /** `DwmIsCompositionEnabled`, when the module could read it. */
  compositionEnabled: boolean | null;
}

export interface CaptureSnapshot {
  /** The user's preference. */
  requested: boolean;
  /** Whether this platform has an OS request at all. */
  apiAvailable: boolean;
  status: CaptureStatus;
  results: WindowProtectionResult[];
  /** Null in the panel's copy of the state. */
  native: NativeDiagnosticsInfo | null;
}

export interface AppState {
  /** Increases with every published change. */
  revision: number;
  app: AppInfo;
  appearance: AppearancePreferences;
  behaviour: BehaviourPreferences;
  panel: PanelState;
  connection: ConnectionSnapshot;
  credentials: CredentialStorageInfo;
  shortcuts: ShortcutsState;
  tray: TrayInfo;
  capture: CaptureSnapshot;
  /** Taskbar / Dock omission ("Show in taskbar / Dock"). Not about screen capture. */
  presence: PresenceState;
  /** The Safe Share Guide card in the panel. */
  guide: { open: boolean; seen: boolean };
  displays: DisplayInfo[];
  settings: { open: boolean; tab: SettingsTab };
  probe: { open: boolean; record: ProbeRecord | null };
  /** True when the preference file was damaged or outdated and had to be repaired on load. */
  preferencesRepaired: boolean;
}

/** One-off events (not state). */
export type AppEvent =
  | { type: 'system-resume' }
  | { type: 'settings-tab'; tab: SettingsTab }
  | { type: 'panel-command'; command: 'focus-find' | 'jump-latest' | 'reconnect' }
  /** "Forget session" in Settings: what that account kept on this computer goes too. */
  | { type: 'session-forgotten'; accountId: string | null }
  /** The outcome of something the main process did for the panel (an attachment download). */
  | { type: 'message'; tone: NoticeTone; title: string; description: string | null };

export interface DiagnosticsWindow {
  kind: 'panel' | 'settings' | 'probe';
  bounds: Rect;
  visible: boolean;
  alwaysOnTop: boolean;
  resizable: boolean;
  contentProtected: boolean | null;
}

/** A refused Content-Security-Policy action in one of the app's own pages. */
export interface PolicyViolationRecord {
  window: 'panel' | 'settings' | 'probe';
  directive: string;
  blocked: string;
  source: string;
  line: number;
  at: string;
}

/** Technical details shown in Settings → Diagnostics. Contains no secrets or document content. */
export interface Diagnostics {
  generatedAt: string;
  app: AppInfo;
  versions: { node: string; v8: string };
  osRelease: string;
  locale: string;
  windows: DiagnosticsWindow[];
  displays: DisplayInfo[];
  shortcuts: ShortcutStatus[];
  tray: TrayInfo;
  credentials: CredentialStorageInfo;
  capture: CaptureSnapshot;
  serverOrigin: string | null;
  gpu: Record<string, string>;
  userDataPath: string;
  nativeResizeProbe: ProbeRecord | null;
  /** Most recent refused policy actions in this run (normally none). */
  policyViolations: PolicyViolationRecord[];
}

/**
 * What the panel window is given. The panel is the one renderer that shows
 * content written by other people, so it gets nothing it does not display:
 * no probe notes the user typed in Settings, no description of the monitors,
 * no diagnostics. (Privacy Test Center records never travel in the state at
 * all; the panel sees only the verification line and its counts.)
 */
export function panelView(state: AppState): AppState {
  return {
    ...state,
    capture: { ...state.capture, native: null },
    displays: [],
    probe: { open: state.probe.open, record: null },
  };
}
