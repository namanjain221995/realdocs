/**
 * Type of `window.rdDesktop`, the only object the preload script exposes to
 * the renderer. Every method maps to one validated IPC channel; there is no
 * generic invoke, no file access, no shell and no URL loading.
 */
import type { ResizeEdge, Rect, SizePreset } from './geometry';
import type {
  ConnectionOptionsInput,
  IpcResult,
  SessionReportInput,
  WindowActionName,
  WorkspaceInput,
} from './ipc-schemas';
import type { PreferencePatch, ProbeResult } from './preferences';
import type { ExportFormat } from './privacy/ipc';
import type { ProtectionRequestState, VerificationRecord } from './privacy/status';
import type { DetectedEnvironment } from './privacy/test-center';
import type { ShortcutAction } from './shortcuts';
import type { AppEvent, AppState, Diagnostics, SettingsTab } from './state';

export type Unsubscribe = () => void;
export type ActionResult = Promise<IpcResult<null>>;

/** What the settings window gets from the Privacy Test Center. No file paths. */
export interface PrivacyView {
  environment: DetectedEnvironment;
  requestState: ProtectionRequestState;
  records: VerificationRecord[];
  /** Record files that failed validation and were moved aside (name and reason only). */
  quarantined: { file: string; reason: string }[];
}

export interface RdDesktopApi {
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): Unsubscribe;
  onEvent(listener: (event: AppEvent) => void): Unsubscribe;

  preferences: {
    update(patch: PreferencePatch): ActionResult;
  };

  window: {
    action(action: WindowActionName, options?: { tab?: SettingsTab }): ActionResult;
    setBounds(bounds: Partial<Rect>): ActionResult;
    preset(preset: SizePreset): ActionResult;
    nudge(change: {
      deltaWidth?: number;
      deltaHeight?: number;
      deltaX?: number;
      deltaY?: number;
    }): ActionResult;
    resizeStart(edge: ResizeEdge): ActionResult;
    /** One-way and unacknowledged: called for every pointer move while a grip is held. */
    resizeMove(dx: number, dy: number): void;
    resizeEnd(): ActionResult;
    setClickThrough(enabled: boolean): ActionResult;
    setClickThroughHover(hovering: boolean): ActionResult;
    setWorkspace(options: WorkspaceInput): ActionResult;
  };

  connection: {
    setServer(origin: string): ActionResult;
    check(): ActionResult;
    setOptions(options: ConnectionOptionsInput): ActionResult;
    openShareLink(link: string): ActionResult;
    disconnect(): ActionResult;
    revalidate(): ActionResult;
    dismissNotice(id: string): ActionResult;
    reportSession(report: SessionReportInput): ActionResult;
  };

  capture: {
    setEnabled(enabled: boolean): ActionResult;
  };

  /** The Privacy Test Center. Settings window only; the panel is refused. */
  privacy: {
    snapshot(): Promise<IpcResult<PrivacyView>>;
    save(record: VerificationRecord): Promise<IpcResult<PrivacyView>>;
    remove(id: string): Promise<IpcResult<PrivacyView>>;
    /** The main process asks where to save and writes the file; the page learns only whether it did. */
    exportRecords(format: ExportFormat): Promise<IpcResult<{ saved: boolean }>>;
  };

  shortcuts: {
    set(action: ShortcutAction, accelerator: string): ActionResult;
    reset(action?: ShortcutAction): ActionResult;
    setRecording(active: boolean): ActionResult;
  };

  openExternal(url: string): ActionResult;

  diagnostics: {
    get(): Promise<IpcResult<Diagnostics>>;
    openProbe(): ActionResult;
    closeProbe(): ActionResult;
    recordProbe(result: ProbeResult, notes: string): ActionResult;
  };
}

/** Top-level keys of `window.rdDesktop`, asserted by the smoke test. */
export const BRIDGE_KEYS = [
  'capture',
  'connection',
  'diagnostics',
  'getState',
  'onEvent',
  'onState',
  'openExternal',
  'preferences',
  'privacy',
  'shortcuts',
  'window',
] as const;

declare global {
  interface Window {
    /** Present only inside the desktop app. */
    rdDesktop?: RdDesktopApi;
  }
}
