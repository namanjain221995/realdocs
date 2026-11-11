/**
 * The complete list of IPC actions: channel, input schema, which window kinds
 * may call it, and the method of `MainApi` it maps to. Electron-free, so the
 * unit tests drive it with a fake `MainApi`.
 *
 * The panel renders document content written by other people, so it gets the
 * smallest set, and for each action it may request the question is: could
 * content in the panel use this to get something the reader did not ask for?
 * (Audit, channel by channel, in docs/notes/desktop.md.)
 *
 * - It cannot change the server, the transport policy, shortcuts, private
 *   mode, the taskbar/Dock setting or verification records, and it cannot
 *   confirm anything: a change of server is confirmed in a dialog of the main
 *   process, which no window can answer. There is no confirmation channel.
 * - It may ask to open a share link only while no document is open (that is
 *   when its paste field exists); it can never replace an open document.
 * - Closing the document from the panel ends the session but keeps the unsent
 *   work of a signed-in editor on this computer; only Settings can forget it.
 * - Links it hands to the operating system are validated and rate-limited.
 * - Its copy of the state leaves out what it does not display (`panelView`).
 * - Every request that acts needs a real click or key press (checked in the
 *   preload) and must fit what the reader can see of the panel right now
 *   (`decidePanelRequest`, checked here): a hidden panel cannot reveal
 *   itself, a panel in click-through mode can only leave it.
 * - With private mode on, a position it asks for stays on the display it is on.
 * - What remains is cosmetic and bounded: its own size, opacity, text size,
 *   pin, collapse, hide and click-through (each with a way back).
 */
import { CH } from '../shared/channels';
import type { ResizeEdge, Rect, SizePreset } from '../shared/geometry';
import type { PrivacyView } from '../shared/bridge';
import {
  CaptureEnabledInput,
  ClickThroughHoverInput,
  ClickThroughInput,
  ConnectionOptionsInput,
  DismissNoticeInput,
  ExternalOpenInput,
  FrameAckInput,
  NoInput,
  NudgeInput,
  OpenShareLinkInput,
  PolicyViolationInput,
  PrefsUpdateInput,
  PresetInput,
  ProbeRecordInput,
  ResizeMoveInput,
  ResizeStartInput,
  SessionReportInput,
  SetBoundsInput,
  SetServerInput,
  ShortcutRecordingInput,
  ShortcutResetInput,
  ShortcutSetInput,
  WindowActionInput,
  WorkspaceInput,
  type WindowActionName,
} from '../shared/ipc-schemas';
import {
  decidePanelRequest,
  type PanelCondition,
  type PanelRequest,
} from '../shared/panel-requests';
import type { PreferencePatch, ProbeResult } from '../shared/preferences';
import {
  ExportPrivacyRecordsInput,
  RemovePrivacyRecordInput,
  SavePrivacyRecordInput,
  type ExportFormat,
} from '../shared/privacy/ipc';
import type { VerificationRecord } from '../shared/privacy/status';
import type { ShortcutAction } from '../shared/shortcuts';
import { panelView, type AppState, type Diagnostics, type SettingsTab } from '../shared/state';
import type { z } from 'zod';
import {
  IpcError,
  defineHandler,
  type HandlerContext,
  type HandlerSpec,
  type WindowKind,
} from './ipc-router';

/** Everything a renderer can ask the main process to do. Implemented by `AppController`. */
export interface MainApi {
  getState(): AppState;
  /** What the reader can see of the panel right now (for `decidePanelRequest`). */
  panelCondition(): PanelCondition;
  updatePreferences(patch: PreferencePatch): void;
  windowAction(
    action: WindowActionName,
    options: { tab?: SettingsTab; source: 'panel' | 'settings' },
  ): void | Promise<void>;
  /** `source: 'panel'` positions are kept on the panel's display while private mode is on. */
  setPanelBounds(bounds: Partial<Rect>, source: 'panel' | 'settings'): void;
  applyPreset(preset: SizePreset): void;
  nudgePanel(change: {
    deltaWidth: number;
    deltaHeight: number;
    deltaX: number;
    deltaY: number;
  }): void;
  beginResize(edge: ResizeEdge): void;
  resizeMove(dx: number, dy: number): void;
  endResize(): void;
  setClickThrough(enabled: boolean): void;
  setClickThroughHover(hovering: boolean): void;
  setWorkspaceOptions(options: z.output<typeof WorkspaceInput>): void;
  setServer(origin: string): Promise<void>;
  checkServer(): Promise<void>;
  setConnectionOptions(options: z.output<typeof ConnectionOptionsInput>): Promise<void>;
  openShareLink(link: string, source: 'panel' | 'settings'): Promise<void>;
  disconnect(options: { forget: boolean }): Promise<void>;
  revalidateSession(): Promise<void>;
  dismissNotice(id: string): void;
  reportSession(report: z.output<typeof SessionReportInput>): void;
  setCaptureEnabled(enabled: boolean): void;
  privacySnapshot(): Promise<PrivacyView>;
  privacySave(record: VerificationRecord): Promise<PrivacyView>;
  privacyRemove(id: string): Promise<PrivacyView>;
  privacyExport(format: ExportFormat): Promise<{ saved: boolean }>;
  /** A window's preload answered a "has this been drawn?" question. */
  frameAck(window: WindowKind, nonce: string): void;
  setShortcut(action: ShortcutAction, accelerator: string): void;
  resetShortcuts(action: ShortcutAction | undefined): void;
  setShortcutRecording(active: boolean): void;
  openExternal(url: string, source: 'panel' | 'settings'): Promise<void>;
  getDiagnostics(): Promise<Diagnostics>;
  openProbe(): void;
  closeProbe(): void;
  recordProbe(result: ProbeResult, notes: string): void;
  reportPolicyViolation(window: WindowKind, report: z.output<typeof PolicyViolationInput>): void;
}

const ALL: readonly WindowKind[] = ['panel', 'settings', 'probe'];
const PANEL_AND_SETTINGS: readonly WindowKind[] = ['panel', 'settings'];
const PANEL: readonly WindowKind[] = ['panel'];
const SETTINGS: readonly WindowKind[] = ['settings'];
const SETTINGS_AND_PROBE: readonly WindowKind[] = ['settings', 'probe'];

/**
 * Refuses a request from the panel that the reader could not have made in the
 * panel's current state. Requests from the settings window pass unchanged.
 */
function guardPanel(api: MainApi, context: HandlerContext, request: PanelRequest): void {
  if (context.windowKind !== 'panel') return;
  const decision = decidePanelRequest(request, api.panelCondition());
  if (!decision.ok) throw new IpcError(decision.code, decision.message);
}

/** Channels handled with `ipcMain.handle` (request/response). */
export function buildInvokeHandlers(api: MainApi): HandlerSpec[] {
  return [
    defineHandler({
      channel: CH.stateGet,
      schema: NoInput,
      allowed: ALL,
      handle: (_input, context) =>
        context.windowKind === 'panel' ? panelView(api.getState()) : api.getState(),
    }),
    defineHandler({
      channel: CH.prefsUpdate,
      schema: PrefsUpdateInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input) => {
        // exactOptionalPropertyTypes-safe copy: drop keys whose value is undefined.
        const patch: PreferencePatch = {};
        if (input.appearance) patch.appearance = definedOnly(input.appearance);
        if (input.behaviour) patch.behaviour = definedOnly(input.behaviour);
        api.updatePreferences(patch);
      },
    }),

    defineHandler({
      channel: CH.windowAction,
      schema: WindowActionInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'window-action', action: input.action });
        return api.windowAction(input.action, {
          ...(input.tab ? { tab: input.tab } : {}),
          source: context.windowKind === 'panel' ? 'panel' : 'settings',
        });
      },
    }),
    defineHandler({
      channel: CH.windowSetBounds,
      schema: SetBoundsInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'set-bounds' });
        api.setPanelBounds(
          definedOnly(input),
          context.windowKind === 'panel' ? 'panel' : 'settings',
        );
      },
    }),
    defineHandler({
      channel: CH.windowPreset,
      schema: PresetInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'preset' });
        api.applyPreset(input.preset);
      },
    }),
    defineHandler({
      channel: CH.windowNudge,
      schema: NudgeInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'nudge' });
        api.nudgePanel(input);
      },
    }),
    defineHandler({
      channel: CH.windowResizeStart,
      schema: ResizeStartInput,
      allowed: PANEL,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'resize-start' });
        api.beginResize(input.edge);
      },
    }),
    defineHandler({
      channel: CH.windowResizeEnd,
      schema: NoInput,
      allowed: PANEL,
      handle: () => api.endResize(),
    }),
    defineHandler({
      channel: CH.windowClickThrough,
      schema: ClickThroughInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'click-through', enabled: input.enabled });
        api.setClickThrough(input.enabled);
      },
    }),
    defineHandler({
      channel: CH.windowClickThroughHover,
      schema: ClickThroughHoverInput,
      allowed: PANEL,
      handle: (input) => api.setClickThroughHover(input.hovering),
    }),
    defineHandler({
      channel: CH.windowWorkspace,
      schema: WorkspaceInput,
      allowed: SETTINGS,
      handle: (input) => api.setWorkspaceOptions(input),
    }),

    defineHandler({
      channel: CH.connectionSetServer,
      schema: SetServerInput,
      allowed: SETTINGS,
      handle: (input) => api.setServer(input.origin),
    }),
    defineHandler({
      channel: CH.connectionCheck,
      schema: NoInput,
      allowed: SETTINGS,
      handle: () => api.checkServer(),
    }),
    defineHandler({
      channel: CH.connectionSetOptions,
      schema: ConnectionOptionsInput,
      allowed: SETTINGS,
      handle: (input) => api.setConnectionOptions(input),
    }),
    defineHandler({
      channel: CH.connectionOpenShareLink,
      schema: OpenShareLinkInput,
      allowed: PANEL_AND_SETTINGS,
      // The main process decides what the request may do, by where it came from.
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'open-share-link' });
        return api.openShareLink(
          input.link,
          context.windowKind === 'settings' ? 'settings' : 'panel',
        );
      },
    }),
    defineHandler({
      channel: CH.connectionDisconnect,
      schema: NoInput,
      allowed: PANEL_AND_SETTINGS,
      // Only the settings window can also remove what the account kept on this computer.
      handle: (_input, context) => {
        guardPanel(api, context, { kind: 'disconnect' });
        return api.disconnect({ forget: context.windowKind === 'settings' });
      },
    }),
    defineHandler({
      channel: CH.connectionRevalidate,
      schema: NoInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (_input, context) => {
        guardPanel(api, context, { kind: 'revalidate' });
        return api.revalidateSession();
      },
    }),
    defineHandler({
      channel: CH.connectionDismissNotice,
      schema: DismissNoticeInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'dismiss-notice' });
        api.dismissNotice(input.id);
      },
    }),
    defineHandler({
      channel: CH.sessionReport,
      schema: SessionReportInput,
      allowed: PANEL,
      handle: (input) => api.reportSession(input),
    }),

    defineHandler({
      channel: CH.captureSetEnabled,
      schema: CaptureEnabledInput,
      allowed: SETTINGS,
      handle: (input) => api.setCaptureEnabled(input.enabled),
    }),

    // The Privacy Test Center: records the user wrote. The panel renders other
    // people's content and can neither read nor write them.
    defineHandler({
      channel: CH.privacySnapshot,
      schema: NoInput,
      allowed: SETTINGS,
      handle: () => api.privacySnapshot(),
    }),
    defineHandler({
      channel: CH.privacySave,
      schema: SavePrivacyRecordInput,
      allowed: SETTINGS,
      // The detected fields (OS, Electron and app version) are stamped by the main process.
      handle: (input) => api.privacySave(input.record),
    }),
    defineHandler({
      channel: CH.privacyRemove,
      schema: RemovePrivacyRecordInput,
      allowed: SETTINGS,
      handle: (input) => api.privacyRemove(input.id),
    }),
    defineHandler({
      channel: CH.privacyExport,
      schema: ExportPrivacyRecordsInput,
      allowed: SETTINGS,
      handle: (input) => api.privacyExport(input.format),
    }),

    defineHandler({
      channel: CH.shortcutsSet,
      schema: ShortcutSetInput,
      allowed: SETTINGS,
      handle: (input) => api.setShortcut(input.action, input.accelerator),
    }),
    defineHandler({
      channel: CH.shortcutsReset,
      schema: ShortcutResetInput,
      allowed: SETTINGS,
      handle: (input) => api.resetShortcuts(input.action),
    }),
    defineHandler({
      channel: CH.shortcutsRecording,
      schema: ShortcutRecordingInput,
      allowed: SETTINGS,
      handle: (input) => api.setShortcutRecording(input.active),
    }),

    defineHandler({
      channel: CH.externalOpen,
      schema: ExternalOpenInput,
      allowed: PANEL_AND_SETTINGS,
      handle: (input, context) => {
        guardPanel(api, context, { kind: 'external-open' });
        return api.openExternal(
          input.url,
          context.windowKind === 'settings' ? 'settings' : 'panel',
        );
      },
    }),
    defineHandler({
      channel: CH.diagnosticsGet,
      schema: NoInput,
      allowed: SETTINGS,
      handle: () => api.getDiagnostics(),
    }),
    defineHandler({
      channel: CH.probeOpen,
      schema: NoInput,
      allowed: SETTINGS,
      handle: () => api.openProbe(),
    }),
    defineHandler({
      channel: CH.probeClose,
      schema: NoInput,
      allowed: SETTINGS_AND_PROBE,
      handle: () => api.closeProbe(),
    }),
    defineHandler({
      channel: CH.probeRecord,
      schema: ProbeRecordInput,
      allowed: SETTINGS_AND_PROBE,
      handle: (input) => api.recordProbe(input.result, input.notes),
    }),
  ];
}

/** Channels handled with `ipcMain.on` (one-way, high frequency). Same validation, no reply. */
export function buildSendHandlers(api: MainApi): HandlerSpec[] {
  return [
    defineHandler({
      channel: CH.windowResizeMove,
      schema: ResizeMoveInput,
      allowed: PANEL,
      handle: (input) => api.resizeMove(input.dx, input.dy),
    }),
    defineHandler({
      channel: CH.policyViolation,
      schema: PolicyViolationInput,
      allowed: ALL,
      handle: (input, context) => api.reportPolicyViolation(context.windowKind, input),
    }),
    defineHandler({
      channel: CH.frameAck,
      schema: FrameAckInput,
      allowed: ALL,
      // Only an answer to a question the main process asked that window counts.
      handle: (input, context) => api.frameAck(context.windowKind, input.nonce),
    }),
  ];
}

function definedOnly<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as { [K in keyof T]?: Exclude<T[K], undefined> };
}
