/**
 * Application controller: wires preferences, credentials, the connection
 * state machine, windows, tray/menu, global shortcuts, display tracking, the
 * Privacy Test Center and the optional Windows diagnostics module, implements
 * every renderer-callable action (`MainApi`) and publishes the state snapshot.
 */
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  powerMonitor,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type SaveDialogOptions,
  type Session,
} from 'electron';
import type { PrivacyView } from '../shared/bridge';
import {
  NO_VERIFICATION,
  computeCaptureStatus,
  platformHasProtectionApi,
  summarizeVerification,
} from '../shared/capture';
import { CH } from '../shared/channels';
import type { ResizeEdge, Rect, SizePreset } from '../shared/geometry';
import type { WindowActionName } from '../shared/ipc-schemas';
import type { PanelCondition } from '../shared/panel-requests';
import {
  applyPreferencePatch,
  cleanText,
  type PreferencePatch,
  type ProbeResult,
  type WindowPreferences,
} from '../shared/preferences';
import { computePresence, hasPresenceRecovery, type PresenceState } from '../shared/presence';
import type { ExportFormat } from '../shared/privacy/ipc';
import type { VerificationRecord } from '../shared/privacy/status';
import type { DetectedEnvironment } from '../shared/privacy/test-center';
import { PARKED_NOTICE } from '../shared/share-guide';
import {
  ACCELERATOR_ERROR_MESSAGES,
  SHORTCUT_LABELS,
  defaultShortcuts,
  formatAccelerator,
  type ShortcutAction,
} from '../shared/shortcuts';
import {
  panelView,
  type AppEvent,
  type AppInfo,
  type AppState,
  type CaptureSnapshot,
  type Diagnostics,
  type DiagnosticsWindow,
  type DocumentMode,
  type NativeDiagnosticsInfo,
  type PanelState,
  type PolicyViolationRecord,
  type SettingsTab,
  type TrayInfo,
} from '../shared/state';
import { originHost } from '../shared/server-origin';
import { panelWindowTitle } from '../shared/surfaces';
import { installAppProtocol } from './app-protocol';
import {
  ConnectionController,
  type RequestSource,
  type ServerChangeRequest,
} from './connection-controller';
import { ConnectionService } from './connection-service';
import { CredentialStore, type EncryptionAdapter } from './credential-store';
import { buildInvokeHandlers, buildSendHandlers, type MainApi } from './ipc-handlers';
import { IpcError, createIpcRouter, type SenderInfo, type WindowKind } from './ipc-router';
import type { Logger } from './logger';
import { buildTrayMenuModel, trayTooltip, type MenuActionId } from './menu-model';
import { loadDisplayAffinity, productionDeps, type LoadOutcome } from './native/display-affinity';
import type { PlatformAdapter, PresenceApplication } from './platform';
import { buildMenu } from './platform/menu-builder';
import { PreferencesStore } from './preferences-store';
import { detectEnvironment, electronEnvironmentSource } from './privacy/environment';
import { PrivacyRecordStore } from './privacy/record-store';
import { PrivacyService } from './privacy/service';
import {
  MAX_ATTACHMENT_DOWNLOAD_BYTES,
  fileNameFromContentDisposition,
  matchAssetDownload,
  neutralFileName,
  readBodyLimited,
  safeFileName,
} from './asset-download';
import { RateLimiter } from './rate-limit';
import { createSafeStorageAdapter } from './safe-storage-adapter';
import { decideExternalOpen } from './navigation-policy';
import { hardenSession, lockDownUnusedSession, openExternalSafely } from './session-security';
import { ShortcutManager, type ShortcutRegistrar } from './shortcut-manager';
import { WindowManager, type RendererConsoleEntry } from './window-manager';

export interface ControllerPaths {
  userData: string;
  rendererRoot: string;
  preload: string;
  assets: string;
  /** Development builds: where `scripts/build-native.mjs` writes the Windows module. */
  devNativeDir: string;
}

/** Fault injection for the automated smoke test. Only ever set by the test hook. */
export interface TestSwitches {
  disableTray: boolean;
  failShortcuts: boolean;
}

export interface ControllerOptions {
  platform: PlatformAdapter;
  logger: Logger;
  paths: ControllerPaths;
  testSwitches?: TestSwitches;
  /** How the session is encrypted at rest. Defaults to the operating system's store. */
  encryption?: EncryptionAdapter;
}

const PUBLISH_DELAY_MS = 16;
const RENDERER_CONSOLE_LIMIT = 200;
const POLICY_VIOLATION_LIMIT = 100;
const RECORDING_TIMEOUT_MS = 15_000;
const DISPLAY_SETTLE_MS = 250;
/** Links the panel hands to the operating system: a person never clicks faster than this. */
const PANEL_LINK_LIMIT = { minIntervalMs: 700, max: 12, windowMs: 60_000 };

export class AppController implements MainApi {
  private readonly platform: PlatformAdapter;
  private readonly logger: Logger;
  private readonly paths: ControllerPaths;
  private readonly testSwitches: TestSwitches;
  private readonly preferences: PreferencesStore;
  private readonly credentials: CredentialStore;
  private readonly connection: ConnectionController;
  private appSession!: Session;
  private windows!: WindowManager;
  private shortcuts!: ShortcutManager;
  private tray: Tray | null = null;
  private trayInfo: TrayInfo = { available: false, error: 'not created yet' };
  private revision = 0;
  private publishTimer: NodeJS.Timeout | null = null;
  private menuSignature = '';
  private appMenuSignature = '';
  private presenceSignature = '';
  private presenceWasOmitted = false;
  private recordingTimer: NodeJS.Timeout | null = null;
  private displayTimer: NodeJS.Timeout | null = null;
  private quitting = false;
  private shutDown = false;
  private started = false;
  private readonly rendererConsole: RendererConsoleEntry[] = [];
  /** True while an attachment is being fetched or its save dialog is open: one at a time. */
  private downloading = false;
  private readonly panelLinks = new RateLimiter(PANEL_LINK_LIMIT);
  private readonly policyViolations: PolicyViolationRecord[] = [];
  /** The Safe Share Guide card is open in the panel. */
  private guideOpen = false;
  private privacy: PrivacyService | null = null;
  /** Privacy Test Center records, cached for the verification line (counts only leave this process). */
  private privacyRecords: VerificationRecord[] = [];
  private native: LoadOutcome | null = null;
  private parkedNotice: Notification | null = null;

  constructor(options: ControllerOptions) {
    this.platform = options.platform;
    this.logger = options.logger;
    this.paths = options.paths;
    this.testSwitches = options.testSwitches ?? { disableTray: false, failShortcuts: false };
    this.preferences = new PreferencesStore({
      filePath: path.join(this.paths.userData, 'preferences.json'),
      platform: this.platform.id,
      logger: this.logger,
    });
    this.credentials = new CredentialStore({
      filePath: path.join(this.paths.userData, 'session.bin'),
      encryption: options.encryption ?? createSafeStorageAdapter(process.platform),
      logger: this.logger,
    });
    this.connection = new ConnectionController({
      // The network session is created in `start()`; the service is bound lazily.
      service: new ConnectionService({
        fetch: (url, init) => this.mainFetch(url, init),
      }),
      credentials: this.credentials,
      preferences: this.preferences,
      confirmServerChange: (request, source, withdrawn) =>
        this.confirmServerChange(request, source, withdrawn),
      onChange: () => this.publish(),
      onSessionClosed: ({ accountId, clearLocalData }) => {
        // Images of the document must not stay in the HTTP cache on disk.
        void this.appSession?.clearCache().catch(() => undefined);
        if (clearLocalData) this.sendEvent({ type: 'session-forgotten', accountId }, 'panel');
      },
      // Another server: nothing the previous one left in this profile is kept
      // (unsent changes, drafts, cached images).
      onServerChanging: async () => {
        if (!this.appSession) return;
        await this.appSession.clearStorageData({ storages: ['indexdb', 'cachestorage'] });
        await this.appSession.clearCache();
      },
      // At once: the page with the previous server's policy must not see the new state.
      onServerChanged: () => this.windows?.reloadPanel(),
      // A document arrived or a notice matters. Never brings back a parked
      // panel and never moves one onto another display; never takes focus.
      onReveal: () => {
        if (!this.windows || this.windows.getParked()) return;
        this.windows.setClickThrough(false);
        void this.windows.showPanel({ focus: false });
      },
      logger: this.logger,
    });
  }

  private netSession: Session | null = null;

  private mainFetch(url: string, init: RequestInit): Promise<Response> {
    if (!this.netSession) return Promise.reject(new TypeError('Network is not ready yet.'));
    return this.netSession.fetch(url, init);
  }

  // ── Startup and shutdown ─────────────────────────────────────────────────

  /** Called once after `app` is ready. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const loadStatus = await this.preferences.load();
    this.logger.info('preferences.loaded', { status: loadStatus });

    // Renderer session: persistent so the editor's local recovery store survives restarts.
    this.appSession = session.fromPartition('persist:realtimedocs');
    // Main-process API calls use their own in-memory session: no cookies, no cache on disk.
    this.netSession = session.fromPartition('realtimedocs-main-net');
    installAppProtocol(this.appSession, {
      rendererRoot: this.paths.rendererRoot,
      getServerOrigin: () => this.connection.serverOrigin,
      logger: this.logger,
    });
    hardenSession(this.appSession, {
      getAuthContext: () => this.connection.authContext(),
      logger: this.logger,
    });
    lockDownUnusedSession(session.defaultSession);
    lockDownUnusedSession(this.netSession);

    this.loadNativeModule();
    this.startPrivacyService();

    this.windows = new WindowManager({
      platform: this.platform,
      session: this.appSession,
      preloadPath: this.paths.preload,
      assetsDirectory: this.paths.assets,
      packaged: app.isPackaged,
      logger: this.logger,
      getPreferences: () => this.preferences.get(),
      updateWindowPreferences: (change) => this.updateWindowPreferences(change),
      updateDocumentWindowPreferences: (change) =>
        this.preferences.update((current) => ({
          ...current,
          documentWindow: change(current.documentWindow),
        })),
      isCaptureRequested: () => this.preferences.get().capture.enabled,
      getPresence: () => this.presenceApplication(),
      canHide: () => this.canHide(),
      onParked: () => this.announceParked(),
      nativeAffinity: this.native?.module ?? null,
      onChange: () => this.publish(),
      isQuitting: () => this.quitting,
      onRendererConsole: (entry) => this.recordRendererConsole(entry),
      onPanelLink: (url) => this.startAssetDownload(url),
      onOpenWindow: (kind, url) => {
        // `window.open` never passes through the preload's activation check, so
        // for the panel the main process checks for a real click or key press itself.
        if (kind === 'panel' && !this.windows.panelHadRecentInput()) {
          this.logger.warn('external.refused_no_input', {});
          return;
        }
        void this.openExternal(url, kind === 'panel' ? 'panel' : 'settings').catch(() => undefined);
      },
    });

    this.registerIpc();
    this.platform.onReady(app);
    this.platform.registerProtocolClient(app);

    this.shortcuts = new ShortcutManager(this.shortcutRegistrar(), this.platform.id, {
      toggleVisibility: () => this.toggleVisibility(),
      returnToInteractive: () => void this.windows.recoverPanel(),
    });
    this.shortcuts.apply(this.preferences.get().shortcuts);
    this.createTray();
    // Before any window is shown: where the app is listed (taskbar, Dock).
    this.applyPresence();

    await this.credentials.init();
    this.trackDisplays();

    // The Safe Share Guide opens by itself until the user has closed it once.
    this.guideOpen = !this.preferences.get().guidance.shareGuideSeen;
    await this.windows.createPanel();
    // Started by the user; still, a panel parked at start stays hidden.
    await this.windows.showPanel({ focus: true });
    this.publish();

    // Server check and session restore happen after the panel is on screen.
    void this.connection.start().catch(() => {
      this.logger.error('connection.start_failed', {});
    });
  }

  /**
   * Called on `before-quit`, while the windows still exist: window close
   * handlers stop hiding instead of closing, and the panel's current bounds
   * are captured before the window is destroyed.
   */
  beginQuit(): void {
    this.quitting = true;
    this.windows?.persistBoundsNow();
  }

  isShutDown(): boolean {
    return this.shutDown;
  }

  async shutdown(): Promise<void> {
    if (this.shutDown) return;
    this.quitting = true;
    try {
      this.shortcuts?.unregisterAll();
      globalShortcut.unregisterAll();
      this.tray?.destroy();
      this.tray = null;
      this.parkedNotice?.close();
      await Promise.race([
        this.preferences.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    } finally {
      this.shutDown = true;
    }
  }

  quit(): void {
    this.quitting = true;
    app.quit();
  }

  // ── Privacy Test Center and the Windows diagnostics module ───────────────

  private startPrivacyService(): void {
    const store = new PrivacyRecordStore(path.join(this.paths.userData, 'privacy'), {
      logger: this.logger,
    });
    this.privacy = new PrivacyService(store, () => this.detectedEnvironment());
    void this.refreshPrivacyRecords();
  }

  private detectedEnvironment(): DetectedEnvironment {
    return detectEnvironment(electronEnvironmentSource({ app, screen }, process));
  }

  private async refreshPrivacyRecords(): Promise<PrivacyView> {
    if (!this.privacy) throw new IpcError('unavailable', 'The Privacy Test Center is not ready.');
    const snapshot = await this.privacy.snapshot();
    this.privacyRecords = snapshot.records;
    this.publish();
    return {
      environment: snapshot.environment,
      requestState: this.captureSnapshot().status.request,
      records: snapshot.records,
      // File names and reasons only: no paths go to a page.
      quarantined: snapshot.quarantined.map(({ file, reason }) => ({ file, reason })),
    };
  }

  /** Windows only, optional: hash-checked before it is loaded; never reachable from a page. */
  private loadNativeModule(): void {
    if (this.platform.id !== 'win32') {
      this.native = loadDisplayAffinity({
        platform: process.platform,
        arch: process.arch,
        moduleRoot: '',
        readExpectedHash: () => null,
        readFile: () => Buffer.alloc(0),
        loadBinding: () => ({}),
      });
      return;
    }
    this.native = loadDisplayAffinity(
      productionDeps(
        {
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
          devNativeDir: this.paths.devNativeDir,
        },
        { readFile: (file) => readFileSync(file), readText: (file) => readFileSync(file, 'utf8') },
      ),
    );
    if (this.native.module) {
      this.logger.info('native.loaded', { sha256: this.native.sha256.slice(0, 12) });
    } else {
      this.logger.info('native.absent', { reason: this.native.reason });
    }
  }

  private nativeInfo(): NativeDiagnosticsInfo {
    const outcome = this.native;
    if (outcome?.module) {
      const composition = outcome.module.isCompositionEnabled();
      return {
        present: true,
        sha256Prefix: outcome.sha256.slice(0, 12),
        reason: null,
        label: null,
        affinity: this.windows.panelAffinity(),
        compositionEnabled: composition.ok ? composition.enabled : null,
      };
    }
    return {
      present: false,
      sha256Prefix: null,
      reason: outcome?.reason ?? 'not_loaded',
      label: outcome && !outcome.module ? outcome.label : null,
      affinity: null,
      compositionEnabled: null,
    };
  }

  // ── External triggers (OS events) ────────────────────────────────────────

  /** A `realtimedocs://` link from argv (Windows/Linux) or `open-url` (macOS). */
  handleDeepLink(url: string): void {
    void this.connection.handleDeepLink(url);
  }

  /**
   * The app was started again, its Dock icon or tray icon was clicked: the
   * user wants the panel back, visible and interactive.
   */
  handleReactivation(options: { focus: boolean }): void {
    if (!this.started || !this.windows) return;
    this.windows.setClickThrough(false);
    void this.windows.showPanel({ focus: options.focus, userAction: true });
  }

  // ── State ────────────────────────────────────────────────────────────────

  private appInfo(): AppInfo {
    return {
      name: 'RealtimeDocs',
      version: app.getVersion(),
      platform: this.platform.id,
      arch: process.arch,
      systemVersion: process.getSystemVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      packaged: app.isPackaged,
    };
  }

  /** A registered global shortcut that brings the panel back (either of the two). */
  private shortcutRecovery(): boolean {
    return (
      this.shortcuts.isRegistered('returnToInteractive') ||
      this.shortcuts.isRegistered('toggleVisibility')
    );
  }

  private recoveryPaths(): PanelState['recoveryPaths'] {
    return {
      shortcut: this.shortcutRecovery(),
      tray: this.trayInfo.available,
      hoverBadge: this.platform.supportsMouseForwarding,
    };
  }

  /** Click-through needs a way back that does not depend on clicking the panel. */
  private clickThroughBlockedReason(): string | null {
    if (this.windows.getMode() !== 'presenter') {
      return 'Click-through is part of Private Presenter Mode; this document is open in a normal window.';
    }
    const paths = this.recoveryPaths();
    if (paths.shortcut || paths.tray) return null;
    return 'Click-through is unavailable: neither a global shortcut nor the tray icon could be registered, so there would be no reliable way back.';
  }

  /** Taskbar / Dock omission as decided from the preference and the ways back. */
  private presence(): PresenceState {
    return computePresence({
      platform: this.platform.id,
      showInTaskbar: this.preferences.get().window.showInTaskbar,
      trayAvailable: this.trayInfo.available,
      shortcutAvailable: this.shortcutRecovery(),
    });
  }

  /** What is applied: omission only for the presenter panel; the normal window is always listed. */
  private presenceApplication(): PresenceApplication {
    const presence = this.presence();
    const presenter =
      (this.windows?.getMode() ?? this.preferences.get().window.mode) === 'presenter';
    return {
      omitted: presenter && presence.omitted,
      activationPolicy:
        presence.activationPolicy === null
          ? null
          : presenter
            ? presence.activationPolicy
            : 'regular',
    };
  }

  /**
   * Applies taskbar / Dock omission when its inputs changed, and says so when
   * it had to be given up because the last way back disappeared.
   */
  private applyPresence(): void {
    const application = this.presenceApplication();
    const signature = JSON.stringify(application);
    if (signature === this.presenceSignature) return;
    const wasOmitted = this.presenceWasOmitted;
    this.presenceSignature = signature;
    this.presenceWasOmitted = application.omitted;
    this.windows?.applyPresence(application);
    const presence = this.presence();
    if (wasOmitted && !application.omitted && presence.blocked === 'no_recovery_path') {
      this.logger.warn('presence.restored_no_recovery', {});
      const message = {
        type: 'message' as const,
        tone: 'warning' as const,
        title: presence.label,
        description: presence.detail,
      };
      this.sendEvent(message, 'panel');
      this.sendEvent(message, 'settings');
    }
  }

  private canHide(): boolean {
    const dockVisible = this.platform.hasDock && !this.presenceApplication().omitted;
    return this.trayInfo.available || this.shortcutRecovery() || dockVisible;
  }

  private captureSnapshot(): CaptureSnapshot {
    const prefs = this.preferences.get().capture;
    const info = this.appInfo();
    const results = this.windows.protectionResults();
    let verification = NO_VERIFICATION;
    if (this.privacyRecords.length > 0) {
      try {
        verification = summarizeVerification(
          this.privacyRecords,
          this.detectedEnvironment(),
          new Date(),
        );
      } catch {
        verification = NO_VERIFICATION;
      }
    }
    return {
      requested: prefs.enabled,
      apiAvailable: platformHasProtectionApi(this.platform.id),
      results,
      status: computeCaptureStatus({
        mode: 'desktop',
        platform: this.platform.id,
        systemVersion: info.systemVersion,
        requested: prefs.enabled,
        results,
        displayCount: screen.getAllDisplays().length,
        verification,
      }),
      native: this.nativeInfo(),
    };
  }

  private panelState(): PanelState {
    const prefs = this.preferences.get().window;
    const panel = this.windows.getPanel();
    const blocked = this.clickThroughBlockedReason();
    const mode = this.windows.getMode();
    return {
      mode,
      visible: panel?.isVisible() ?? false,
      focused: panel?.isFocused() ?? false,
      collapsed: mode === 'presenter' && prefs.collapsed,
      pinned: prefs.pinned,
      pinLevel: prefs.pinLevel,
      clickThrough: this.windows.isClickThrough(),
      canEnterClickThrough: blocked === null,
      clickThroughBlockedReason: blocked,
      recoveryPaths: this.recoveryPaths(),
      canHide: this.canHide(),
      bounds: this.windows.panelBounds(),
      displayId:
        mode === 'presenter' ? prefs.displayId : this.preferences.get().documentWindow.displayId,
      visibleOnAllWorkspaces: prefs.visibleOnAllWorkspaces,
      visibleOnFullScreen: prefs.visibleOnFullScreen,
      lastRecovery: this.windows.getLastRecovery(),
      parked: this.windows.getParked(),
    };
  }

  getState(): AppState {
    const prefs = this.preferences.get();
    return {
      revision: this.revision,
      app: this.appInfo(),
      appearance: prefs.appearance,
      behaviour: prefs.behaviour,
      panel: this.panelState(),
      connection: this.connection.snapshot(),
      credentials: this.credentials.getStorageInfo(),
      shortcuts: { items: this.shortcuts.status(), recording: this.shortcuts.isSuspended() },
      tray: this.trayInfo,
      capture: this.captureSnapshot(),
      presence: this.presence(),
      guide: { open: this.guideOpen, seen: prefs.guidance.shareGuideSeen },
      displays: this.windows.displays(),
      settings: { open: this.windows.getSettings() !== null, tab: this.windows.getSettingsTab() },
      probe: {
        open: this.windows.getProbe() !== null,
        record: prefs.diagnostics.nativeResizeProbe,
      },
      preferencesRepaired:
        this.preferences.status === 'repaired' || this.preferences.status === 'corrupt_reset',
    };
  }

  /** Coalesces bursts (dragging, resizing) into one snapshot per frame. */
  private publish(): void {
    if (!this.started || !this.windows || this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.shutDown) return;
      this.revision += 1;
      const state = this.getState();
      // The panel shows other people's content and gets only what it displays.
      const forPanel = panelView(state);
      const panel = this.windows.getPanel();
      for (const window of this.windows.allWindows()) {
        if (window.webContents.isDestroyed()) continue;
        window.webContents.send(CH.stateChanged, window === panel ? forPanel : state);
      }
      this.enforceRecoveryInvariant(state);
      this.applyPresence();
      // Drawn by the operating system outside the window: never the title in private mode.
      this.windows.setPanelTitle(
        panelWindowTitle({
          documentTitle: state.connection.report?.title ?? state.connection.session?.title,
          privateMode: state.capture.requested,
        }),
      );
      this.refreshMenus(state);
    }, PUBLISH_DELAY_MS);
  }

  private sendEvent(event: AppEvent, target: 'panel' | 'settings'): void {
    const window = target === 'panel' ? this.windows.getPanel() : this.windows.getSettings();
    if (window && !window.webContents.isDestroyed()) window.webContents.send(CH.event, event);
  }

  /** If the last way back disappears while click-through is on, leave click-through at once. */
  private enforceRecoveryInvariant(state: AppState): void {
    if (state.panel.clickThrough && !state.panel.canEnterClickThrough) {
      this.logger.warn('click_through.forced_exit', {});
      this.windows.setClickThrough(false);
    }
  }

  /**
   * The panel's display went away while private mode was on, and the panel
   * was hidden instead of being moved. Say so without naming anything in the
   * document: an operating-system notification (when the system offers them),
   * the tray tooltip and the tray's "Show". Only the user brings it back.
   */
  private announceParked(): void {
    this.publish();
    try {
      if (!Notification.isSupported()) return;
      this.parkedNotice?.close();
      const notice = new Notification({ title: 'RealtimeDocs', body: PARKED_NOTICE, silent: true });
      notice.on('click', () => void this.windows.recoverPanel());
      notice.show();
      this.parkedNotice = notice;
    } catch {
      this.logger.warn('parked.notification_failed', {});
    }
  }

  // ── Tray and menus ───────────────────────────────────────────────────────

  private createTray(): void {
    if (this.testSwitches.disableTray) {
      this.trayInfo = { available: false, error: 'disabled by test switch' };
      return;
    }
    try {
      const tray = new Tray(this.platform.trayImage(this.paths.assets, false));
      tray.setToolTip('RealtimeDocs');
      if (this.platform.trayClickShowsPanel) {
        // Windows: one click on the icon brings the panel back, interactive.
        tray.on('click', () => this.handleReactivation({ focus: false }));
      }
      this.tray = tray;
      this.trayInfo = { available: true, error: null };
    } catch (error) {
      this.tray = null;
      this.trayInfo = {
        available: false,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
      };
      this.logger.error('tray.unavailable', {});
    }
  }

  private runMenuAction(action: MenuActionId): void {
    switch (action) {
      case 'show-panel':
        this.handleReactivation({ focus: false });
        break;
      case 'hide-panel':
        if (this.canHide()) this.windows.hidePanel();
        break;
      case 'toggle-visibility':
        this.toggleVisibility();
        break;
      case 'return-to-interactive':
        void this.windows.recoverPanel();
        break;
      case 'click-through-mode':
        this.enterClickThroughFromMenu();
        break;
      case 'reconnect':
        this.reconnect();
        break;
      case 'open-privacy-test-center':
        this.openSettingsFromMenu('privacy-test-center');
        break;
      case 'open-settings':
        this.openSettingsFromMenu();
        break;
      case 'open-share-guide':
        this.openShareGuide();
        break;
      case 'toggle-pin':
        this.windows.setPinned(!this.preferences.get().window.pinned);
        break;
      case 'toggle-collapse':
        this.windows.setCollapsed(!this.preferences.get().window.collapsed);
        break;
      case 'toggle-capture':
        this.setCaptureEnabled(!this.preferences.get().capture.enabled);
        break;
      case 'reset-position':
        this.windows.resetPosition();
        void this.windows.showPanel({ focus: false, userAction: true });
        break;
      case 'presenter-mode':
      case 'normal-window':
        void this.switchMode(action === 'presenter-mode' ? 'presenter' : 'normal').catch(
          (error: unknown) => {
            if (error instanceof IpcError) {
              this.sendEvent(
                { type: 'message', tone: 'warning', title: error.message, description: null },
                'panel',
              );
            }
          },
        );
        break;
      case 'close-window': {
        const settings = this.windows.getSettings();
        if (settings?.isFocused()) settings.close();
        else this.hidePanelChecked();
        break;
      }
      case 'quit':
        this.quit();
        break;
      default:
        if (action.startsWith('preset:')) {
          this.windows.applyPreset(action.slice('preset:'.length) as SizePreset);
        }
    }
  }

  private openSettingsFromMenu(tab?: SettingsTab): void {
    if (tab) {
      this.windows.setSettingsTab(tab);
      this.sendEvent({ type: 'settings-tab', tab }, 'settings');
    }
    // Without a Dock icon the app is not active by itself; the user asked for this window.
    if (this.platform.id === 'darwin') app.focus({ steal: true });
    void this.windows.openSettings(tab);
  }

  private openShareGuide(): void {
    this.guideOpen = true;
    if (this.windows.getMode() === 'presenter' && this.preferences.get().window.collapsed) {
      this.windows.setCollapsed(false);
    }
    void this.windows.showPanel({ focus: false, userAction: true });
    this.publish();
  }

  private enterClickThroughFromMenu(): void {
    if (this.windows.isClickThrough()) return;
    if (this.clickThroughBlockedReason() !== null) return;
    if (!this.windows.isPanelVisible()) {
      void this.windows
        .showPanel({ focus: false, userAction: true })
        .then(() => this.windows.setClickThrough(true));
      return;
    }
    this.windows.setClickThrough(true);
  }

  /** "Reconnect": ask the server about the session, and have the editor retry at once. */
  private reconnect(): void {
    if (!this.connection.snapshot().session) return;
    void this.connection.revalidateSession();
    this.sendEvent({ type: 'panel-command', command: 'reconnect' }, 'panel');
  }

  private refreshMenus(state: AppState): void {
    if (this.tray && !this.tray.isDestroyed()) {
      const model = buildTrayMenuModel(state);
      const tooltip = trayTooltip(state);
      const signature = JSON.stringify([model, tooltip, state.panel.clickThrough]);
      if (signature !== this.menuSignature) {
        this.menuSignature = signature;
        this.tray.setContextMenu(
          buildMenu(model, {
            run: (action) => this.runMenuAction(action),
            registerAccelerators: false,
          }),
        );
        this.tray.setToolTip(tooltip);
        this.tray.setImage(this.platform.trayImage(this.paths.assets, state.panel.clickThrough));
      }
    }
    // Application menu: macOS only; other platforms have no menu bar.
    const signature = JSON.stringify([
      state.panel.mode,
      state.panel.visible,
      state.panel.clickThrough,
      state.panel.canEnterClickThrough,
      state.panel.canHide,
      state.panel.pinned,
      state.panel.collapsed,
      state.capture.requested,
      state.capture.status.label,
      state.capture.status.verification?.line ?? null,
      state.shortcuts.items.map((item) => [item.accelerator, item.registered]),
    ]);
    if (signature !== this.appMenuSignature) {
      this.appMenuSignature = signature;
      Menu.setApplicationMenu(
        this.platform.buildApplicationMenu(state, (action) => this.runMenuAction(action)),
      );
    }
  }

  // ── Shortcuts ────────────────────────────────────────────────────────────

  private shortcutRegistrar(): ShortcutRegistrar {
    if (this.testSwitches.failShortcuts) {
      return {
        register: () => false,
        unregister: () => undefined,
        isRegistered: () => false,
      };
    }
    return {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
      isRegistered: (accelerator) => globalShortcut.isRegistered(accelerator),
      setSuspended: (suspended) => globalShortcut.setSuspended(suspended),
    };
  }

  /** The show/hide shortcut: a hidden or parked panel comes back; a visible one is hidden. */
  private toggleVisibility(): void {
    if (this.windows.isPanelVisible() && !this.windows.getParked()) {
      if (this.canHide()) this.windows.hidePanel();
    } else {
      this.windows.setClickThrough(false);
      void this.windows.showPanel({ focus: false, userAction: true });
    }
  }

  private hidePanelChecked(): void {
    if (!this.canHide()) {
      throw new IpcError(
        'no_recovery_path',
        'The panel cannot be hidden right now: neither the tray icon nor a global shortcut is available to bring it back.',
      );
    }
    this.windows.hidePanel();
  }

  // ── Displays and power ───────────────────────────────────────────────────

  private trackDisplays(): void {
    const onDisplayChange = (trigger: string) => {
      if (this.displayTimer) clearTimeout(this.displayTimer);
      // Hot-plug produces a burst of events; act once the layout has settled.
      this.displayTimer = setTimeout(() => {
        this.displayTimer = null;
        this.windows.revalidateBounds(trigger);
        this.windows.reapplyPin();
        this.windows.reapplyProtection();
        this.publish();
      }, DISPLAY_SETTLE_MS);
    };
    screen.on('display-added', () => onDisplayChange('display-added'));
    screen.on('display-removed', () => {
      // With private mode on, at once: the panel must not stay where the OS just put it.
      this.windows.handleDisplayRemoved();
      onDisplayChange('display-removed');
    });
    screen.on('display-metrics-changed', () => onDisplayChange('display-metrics-changed'));
    const onWake = () => {
      onDisplayChange('resume');
      this.sendEvent({ type: 'system-resume' }, 'panel');
      void this.connection.revalidateSession();
    };
    powerMonitor.on('resume', onWake);
    powerMonitor.on('unlock-screen', onWake);
  }

  /** Test hook: runs the display-change path with whatever the screen reports now. */
  revalidateDisplays(): void {
    this.windows.revalidateBounds('manual');
    this.publish();
  }

  // ── IPC ──────────────────────────────────────────────────────────────────

  private senderInfo(event: IpcMainInvokeEvent | IpcMainEvent): SenderInfo {
    let frame: SenderInfo['frame'] = null;
    try {
      const senderFrame = event.senderFrame;
      if (senderFrame) {
        frame = {
          url: senderFrame.url,
          isMainFrame: senderFrame.parent === null && senderFrame === event.sender.mainFrame,
        };
      }
    } catch {
      frame = null;
    }
    return { frame, windowKind: this.windows.kindOf(event.sender.id) };
  }

  private registerIpc(): void {
    const onReject = (info: { channel: string; code: string; detail: string }) =>
      this.logger.warn('ipc.rejected', {
        channel: info.channel,
        reason: info.code,
        detail: info.detail,
      });
    const invoke = createIpcRouter(buildInvokeHandlers(this), { onReject });
    for (const channel of invoke.channels) {
      ipcMain.handle(channel, (event, ...args: unknown[]) =>
        invoke.dispatch(channel, this.senderInfo(event), args),
      );
    }
    const send = createIpcRouter(buildSendHandlers(this), { onReject });
    for (const channel of send.channels) {
      ipcMain.on(channel, (event, ...args: unknown[]) => {
        void send.dispatch(channel, this.senderInfo(event), args);
      });
    }
  }

  // ── MainApi: preferences and window ──────────────────────────────────────

  private updateWindowPreferences(change: (current: WindowPreferences) => WindowPreferences): void {
    this.preferences.update((current) => ({ ...current, window: change(current.window) }));
  }

  updatePreferences(patch: PreferencePatch): void {
    this.preferences.update((current) => applyPreferencePatch(current, patch, this.platform.id));
    this.publish();
  }

  /** What the reader can see of the panel right now; decides what the panel may ask for. */
  panelCondition(): PanelCondition {
    const panel = this.windows.getPanel();
    return {
      visible: panel !== null && !panel.isDestroyed() && panel.isVisible(),
      collapsed: this.windows.getMode() === 'presenter' && this.preferences.get().window.collapsed,
      clickThrough: this.windows.isClickThrough(),
    };
  }

  windowAction(
    action: WindowActionName,
    options: { tab?: SettingsTab; source: 'panel' | 'settings' },
  ): void | Promise<void> {
    switch (action) {
      case 'show':
        void this.windows.showPanel({ focus: false, userAction: true });
        break;
      case 'hide':
        this.hidePanelChecked();
        break;
      case 'toggle-visibility':
        if (this.windows.isPanelVisible()) this.hidePanelChecked();
        else void this.windows.showPanel({ focus: false, userAction: true });
        break;
      case 'collapse':
        this.windows.setCollapsed(true);
        break;
      case 'expand':
        this.windows.setCollapsed(false);
        break;
      case 'toggle-collapse':
        this.windows.setCollapsed(!this.preferences.get().window.collapsed);
        break;
      case 'pin':
        this.windows.setPinned(true);
        break;
      case 'unpin':
        this.windows.setPinned(false);
        break;
      case 'toggle-pin':
        this.windows.setPinned(!this.preferences.get().window.pinned);
        break;
      case 'reset-position':
        // From the panel, with private mode on: the default spot of its own display.
        this.windows.resetPosition(
          options.source === 'panel' && this.preferences.get().capture.enabled,
        );
        break;
      case 'open-settings':
        if (options.tab) {
          this.windows.setSettingsTab(options.tab);
          this.sendEvent({ type: 'settings-tab', tab: options.tab }, 'settings');
        }
        void this.windows.openSettings(options.tab);
        break;
      case 'close-settings':
        this.windows.closeSettings();
        break;
      case 'show-share-guide':
        this.openShareGuide();
        break;
      case 'dismiss-share-guide':
        this.guideOpen = false;
        this.preferences.update((current) => ({
          ...current,
          guidance: { ...current.guidance, shareGuideSeen: true },
        }));
        break;
      case 'return-to-interactive':
        void this.windows.recoverPanel();
        break;
      case 'presenter-mode':
      case 'normal-window':
        // A refusal (unsent changes) goes back to the window that asked.
        return this.switchMode(action === 'presenter-mode' ? 'presenter' : 'normal');
    }
    this.publish();
  }

  /**
   * Shows the open document in the other mode. Refused while the editor holds
   * changes the server has not confirmed: the window that has them is replaced.
   */
  async switchMode(mode: DocumentMode): Promise<void> {
    const report = this.connection.snapshot().report;
    if (
      report &&
      (report.save === 'pending' || report.save === 'saving' || report.save === 'error')
    ) {
      throw new IpcError(
        'unsaved_changes',
        'Some changes have not reached the server yet. Switch when the panel says Saved.',
      );
    }
    await this.windows.switchMode(mode);
    this.applyPresence();
    this.publish();
  }

  setPanelBounds(bounds: Partial<Rect>, source: 'panel' | 'settings'): void {
    this.windows.setPanelBounds(
      bounds,
      source === 'panel' && this.preferences.get().capture.enabled,
    );
  }

  applyPreset(preset: SizePreset): void {
    this.windows.applyPreset(preset);
  }

  nudgePanel(change: {
    deltaWidth: number;
    deltaHeight: number;
    deltaX: number;
    deltaY: number;
  }): void {
    this.windows.nudge(change);
  }

  beginResize(edge: ResizeEdge): void {
    this.windows.beginResize(edge);
  }

  resizeMove(dx: number, dy: number): void {
    this.windows.resizeMove(dx, dy);
  }

  endResize(): void {
    this.windows.endResize();
  }

  setClickThrough(enabled: boolean): void {
    if (enabled) {
      const blocked = this.clickThroughBlockedReason();
      if (blocked) throw new IpcError('no_recovery_path', blocked);
      if (!this.windows.isPanelVisible()) {
        throw new IpcError('panel_hidden', 'Show the panel before turning on click-through.');
      }
    }
    this.windows.setClickThrough(enabled);
  }

  setClickThroughHover(hovering: boolean): void {
    this.windows.setClickThroughHover(hovering);
  }

  setWorkspaceOptions(options: {
    visibleOnAllWorkspaces?: boolean | undefined;
    visibleOnFullScreen?: boolean | undefined;
    pinLevel?: WindowPreferences['pinLevel'] | undefined;
    showInTaskbar?: boolean | undefined;
  }): void {
    if (options.showInTaskbar === false && !this.presence().omitted) {
      // Leaving the taskbar / Dock needs a way back that does not depend on them.
      const recovery = hasPresenceRecovery({
        platform: this.platform.id,
        trayAvailable: this.trayInfo.available,
        shortcutAvailable: this.shortcutRecovery(),
      });
      if (!recovery) {
        throw new IpcError(
          'no_recovery_path',
          this.platform.id === 'darwin'
            ? 'RealtimeDocs stays in the Dock: the menu-bar item could not be created, and without the Dock it would be the only way to reach the panel, Settings and Quit.'
            : 'The panel stays in the taskbar: neither the tray icon nor a global shortcut is available to bring it back.',
        );
      }
    }
    this.updateWindowPreferences((current) => ({
      ...current,
      visibleOnAllWorkspaces: options.visibleOnAllWorkspaces ?? current.visibleOnAllWorkspaces,
      visibleOnFullScreen: options.visibleOnFullScreen ?? current.visibleOnFullScreen,
      pinLevel: options.pinLevel ?? current.pinLevel,
      showInTaskbar: options.showInTaskbar ?? current.showInTaskbar,
    }));
    if (options.pinLevel !== undefined) this.windows.reapplyPin();
    if (options.visibleOnAllWorkspaces !== undefined || options.visibleOnFullScreen !== undefined) {
      this.windows.reapplyWorkspaceVisibility();
    }
    if (options.showInTaskbar !== undefined) {
      this.applyPresence();
      this.windows.reapplyWorkspaceVisibility();
    }
    this.publish();
  }

  // ── MainApi: connection ──────────────────────────────────────────────────

  setServer(origin: string): Promise<void> {
    return this.connection.setServer(origin);
  }

  checkServer(): Promise<void> {
    return this.connection.checkServer();
  }

  setConnectionOptions(options: {
    allowInsecureLan?: boolean | undefined;
    acceptPublicOrigin?: boolean | undefined;
  }): Promise<void> {
    return this.connection.setOptions(options);
  }

  openShareLink(link: string, source: RequestSource): Promise<void> {
    return this.connection.openShareLink(link, source);
  }

  disconnect(options: { forget: boolean }): Promise<void> {
    return this.connection.disconnect(options);
  }

  /**
   * "May this app use another server?" is asked here, in a dialog of the main
   * process, and nowhere else. A page can cause the question (by handing over
   * a link) but cannot see, answer or dismiss it; the default button is Cancel
   * and the server is named by its full origin, exactly as it will be used.
   * `withdrawn` closes the dialog as if it had been cancelled.
   */
  private async confirmServerChange(
    request: ServerChangeRequest,
    source: RequestSource,
    withdrawn: AbortSignal,
  ): Promise<boolean> {
    const host = originHost(request.linkOrigin);
    const switching = request.kind === 'switch_server';
    const options: MessageBoxOptions = {
      type: 'question',
      title: 'RealtimeDocs',
      message: switching ? 'This link is for a different server' : 'Use this server?',
      detail: switching
        ? `The link belongs to:\n${request.linkOrigin}\n\nThis app is connected to:\n${request.currentOrigin ?? 'no server'}\n\nIf you switch, any open document is closed, and links, sign-in and documents go to the new server from now on.`
        : `The link belongs to:\n${request.linkOrigin}\n\nRealtimeDocs Desktop will send this link, and later ones, to that server.`,
      buttons: ['Cancel', switching ? `Switch to ${host}` : `Use ${host}`],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal: withdrawn,
    };
    const parent = source === 'settings' ? this.windows.getSettings() : this.windows.getPanel();
    this.logger.info('server_change.asked', { source });
    const result =
      parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
    const accepted = result.response === 1;
    this.logger.info('server_change.answered', { accepted });
    return accepted;
  }

  revalidateSession(): Promise<void> {
    return this.connection.revalidateSession();
  }

  dismissNotice(id: string): void {
    this.connection.dismissNotice(id);
  }

  reportSession(report: Parameters<ConnectionController['reportSession']>[0]): void {
    this.connection.reportSession(report);
  }

  // ── MainApi: capture and the Privacy Test Center ─────────────────────────

  setCaptureEnabled(enabled: boolean): void {
    this.preferences.update((current) => ({
      ...current,
      // `chosen`: from now on "off" is the user's decision and survives updates.
      capture: { ...current.capture, enabled, chosen: true },
    }));
    // Every window that can show document content, including ones opened later.
    this.windows.reapplyProtection();
    this.publish();
  }

  privacySnapshot(): Promise<PrivacyView> {
    return this.refreshPrivacyRecords();
  }

  async privacySave(record: VerificationRecord): Promise<PrivacyView> {
    if (!this.privacy) throw new IpcError('unavailable', 'The Privacy Test Center is not ready.');
    try {
      // The service stamps OS, Electron and app version itself.
      await this.privacy.save(record);
    } catch (error) {
      this.logger.warn('privacy.save_refused', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      throw new IpcError('invalid_record', 'The record could not be saved. Check the form.');
    }
    return this.refreshPrivacyRecords();
  }

  async privacyRemove(id: string): Promise<PrivacyView> {
    if (!this.privacy) throw new IpcError('unavailable', 'The Privacy Test Center is not ready.');
    await this.privacy.remove(id);
    return this.refreshPrivacyRecords();
  }

  /** The main process asks where to save and writes the file; no path goes back to the page. */
  async privacyExport(format: ExportFormat): Promise<{ saved: boolean }> {
    if (!this.privacy) throw new IpcError('unavailable', 'The Privacy Test Center is not ready.');
    const file = await this.privacy.exportText(format);
    let folder: string;
    try {
      folder = app.getPath('documents');
    } catch {
      folder = app.getPath('home');
    }
    const options: SaveDialogOptions = {
      title: 'Export Privacy Test Center records',
      defaultPath: path.join(folder, file.filename),
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    };
    const parent = this.windows.getSettings();
    const choice =
      parent && !parent.isDestroyed()
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return { saved: false };
    try {
      await fs.writeFile(choice.filePath, file.text, { encoding: 'utf8', mode: 0o600 });
    } catch {
      throw new IpcError('write_failed', 'The file could not be written to the place you chose.');
    }
    this.logger.info('privacy.exported', { format });
    return { saved: true };
  }

  frameAck(window: WindowKind, nonce: string): void {
    this.windows.frameAck(window, nonce);
  }

  // ── MainApi: shortcuts ───────────────────────────────────────────────────

  setShortcut(action: ShortcutAction, accelerator: string): void {
    // Registration must happen with handling active.
    this.setShortcutRecording(false);
    const result = this.shortcuts.set(action, accelerator);
    if (!result.ok) {
      this.publish();
      if (result.error === 'invalid') {
        throw new IpcError('invalid_shortcut', ACCELERATOR_ERROR_MESSAGES[result.reason]);
      }
      if (result.error === 'duplicate') {
        throw new IpcError(
          'duplicate_shortcut',
          `That combination is already used for "${SHORTCUT_LABELS[result.conflictsWith]}".`,
        );
      }
      throw new IpcError(
        'shortcut_in_use',
        result.restoredPrevious
          ? 'Another application already uses that combination. Your previous shortcut was kept.'
          : 'Another application already uses that combination.',
      );
    }
    this.preferences.update((current) => ({
      ...current,
      shortcuts: { ...current.shortcuts, [action]: result.accelerator },
    }));
    this.publish();
  }

  resetShortcuts(action: ShortcutAction | undefined): void {
    this.setShortcutRecording(false);
    const defaults = defaultShortcuts(this.platform.id);
    if (action) {
      this.setShortcut(action, defaults[action]);
      return;
    }
    this.preferences.update((current) => ({ ...current, shortcuts: defaults }));
    this.shortcuts.apply(defaults);
    this.publish();
  }

  setShortcutRecording(active: boolean): void {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    this.shortcuts.setSuspended(active);
    if (active) {
      // Never stay suspended: the shortcuts are a recovery path.
      this.recordingTimer = setTimeout(() => {
        this.recordingTimer = null;
        this.shortcuts.setSuspended(false);
        this.publish();
      }, RECORDING_TIMEOUT_MS);
    }
    this.publish();
  }

  // ── MainApi: external links, diagnostics, probe ──────────────────────────

  /**
   * True while a person could be clicking in the document: the panel is on
   * screen, expanded and takes mouse input. Hidden, collapsed or in
   * click-through mode nothing in the document can be clicked, so a request to
   * open a link or to save a file cannot have come from a click.
   */
  private panelIsInteractive(): boolean {
    const panel = this.windows.getPanel();
    return (
      panel !== null &&
      !panel.isDestroyed() &&
      panel.isVisible() &&
      !this.windows.isClickThrough() &&
      !(this.windows.getMode() === 'presenter' && this.preferences.get().window.collapsed)
    );
  }

  async openExternal(url: string, source: RequestSource): Promise<void> {
    // The panel can ask for this from page script, so it is limited to what a
    // person clicking links would do: only while the document can be clicked,
    // and not in bursts. Settings only shows the app's own links.
    if (source === 'panel') {
      if (!this.panelIsInteractive()) {
        this.logger.warn('external.refused_not_interactive', {});
        throw new IpcError(
          'panel_not_interactive',
          'Links can be opened only while the panel is visible, expanded and not in click-through mode.',
        );
      }
      // A link that would be refused anyway does not use up the allowance.
      if (!decideExternalOpen(url).open) {
        this.logger.warn('external.rejected', {});
        throw new IpcError('link_blocked', 'That link cannot be opened from RealtimeDocs.');
      }
      if (!this.panelLinks.take()) {
        this.logger.warn('external.rate_limited', {});
        throw new IpcError('rate_limited', 'Too many links were opened at once. Try again.');
      }
    }
    const opened = await openExternalSafely(url, this.logger);
    if (!opened)
      throw new IpcError('link_blocked', 'That link cannot be opened from RealtimeDocs.');
  }

  getDiagnostics(): Promise<Diagnostics> {
    const state = this.getState();
    const windows: DiagnosticsWindow[] = [];
    const add = (kind: DiagnosticsWindow['kind'], window: Electron.BrowserWindow | null) => {
      if (!window) return;
      let contentProtected: boolean | null = null;
      if (platformHasProtectionApi(this.platform.id)) {
        try {
          contentProtected = window.isContentProtected();
        } catch {
          contentProtected = null;
        }
      }
      windows.push({
        kind,
        bounds: { ...window.getBounds() },
        visible: window.isVisible(),
        alwaysOnTop: window.isAlwaysOnTop(),
        resizable: window.isResizable(),
        contentProtected,
      });
    };
    add('panel', this.windows.getPanel());
    add('settings', this.windows.getSettings());
    add('probe', this.windows.getProbe());

    const gpu: Record<string, string> = {};
    for (const [key, value] of Object.entries(app.getGPUFeatureStatus())) {
      if (typeof value === 'string') gpu[key] = value;
    }
    return Promise.resolve({
      generatedAt: new Date().toISOString(),
      app: state.app,
      versions: { node: process.versions.node, v8: process.versions.v8 },
      osRelease: `${os.type()} ${os.release()}`,
      locale: app.getLocale(),
      windows,
      displays: state.displays,
      shortcuts: state.shortcuts.items,
      tray: state.tray,
      credentials: state.credentials,
      capture: state.capture,
      serverOrigin: state.connection.server.origin,
      gpu,
      userDataPath: this.paths.userData,
      nativeResizeProbe: state.probe.record,
      policyViolations: this.policyViolations.slice(-20),
    });
  }

  openProbe(): void {
    void this.windows.openProbe();
  }

  closeProbe(): void {
    this.windows.closeProbe();
  }

  recordProbe(result: ProbeResult, notes: string): void {
    const info = this.appInfo();
    this.preferences.update((current) => ({
      ...current,
      diagnostics: {
        ...current.diagnostics,
        nativeResizeProbe: {
          result,
          notes: cleanText(notes, 500),
          osPlatform: info.platform,
          osVersion: info.systemVersion,
          electronVersion: info.electronVersion,
          recordedAt: new Date().toISOString(),
        },
      },
    }));
    this.publish();
  }

  // ── Attachment downloads ─────────────────────────────────────────────────

  /**
   * The panel followed a link. If it is the download link of an attachment of
   * the open document, the main process fetches the file itself and returns
   * true. Anything else is not handled (and stays a refused navigation).
   */
  private startAssetDownload(input: string): boolean {
    const { serverOrigin, token } = this.connection.authContext();
    const documentId = this.connection.snapshot().session?.documentId ?? null;
    const download = matchAssetDownload(input, { serverOrigin, documentId });
    if (!download || !token) return false;
    // A save dialog only for a click the reader made: the panel can be
    // clicked right now, and the operating system delivered a click or key
    // press to it a moment ago (a page navigating by script has neither).
    if (!this.panelIsInteractive() || !this.windows.panelHadRecentInput()) {
      this.logger.warn('attachment.refused_not_interactive', {});
      return false;
    }
    // One at a time: a second click while the dialog is open adds nothing.
    if (this.downloading) return true;
    this.downloading = true;
    void this.downloadAttachment(download.url, token).finally(() => {
      this.downloading = false;
    });
    return true;
  }

  /**
   * Fetches one attachment and saves it where the person chooses.
   *
   * The request carries the session token and nothing else, goes out through
   * the main process's own network session, and does not follow redirects: a
   * redirect fails the download, so the token never reaches another address.
   * The bytes are read while the save dialog is open, so the server is not
   * kept waiting for the person's choice. Nothing about the file (name, path,
   * content) is logged. With private mode on, the dialog (drawn by the
   * operating system, outside the protected window) proposes a neutral name.
   */
  private async downloadAttachment(url: string, token: string): Promise<void> {
    this.logger.info('attachment.download_started', {});
    const abort = new AbortController();
    const fail = (reason: string, description: string): void => {
      abort.abort();
      this.logger.warn('attachment.download_failed', { reason });
      this.sendEvent(
        {
          type: 'message',
          tone: 'danger',
          title: 'The attachment could not be downloaded',
          description,
        },
        'panel',
      );
    };
    try {
      const response = await this.mainFetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: '*/*' },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        fail(
          `status_${response.status}`,
          response.status === 401 || response.status === 403 || response.status === 404
            ? 'The server no longer gives this session access to the file.'
            : 'The server did not send the file. Try again in a moment.',
        );
        return;
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
        fail(
          'too_large',
          'The file is larger than this app downloads. Open the document in your browser to download it.',
        );
        return;
      }
      const proposed = safeFileName(
        fileNameFromContentDisposition(response.headers.get('content-disposition')),
      );
      const name = this.preferences.get().capture.enabled ? neutralFileName(proposed) : proposed;
      // Read now, while the person chooses where to save.
      const body = readBodyLimited(response.body, MAX_ATTACHMENT_DOWNLOAD_BYTES);
      // A failure is dealt with where the result is awaited; no unhandled rejection meanwhile.
      body.catch(() => undefined);

      let folder: string;
      try {
        folder = app.getPath('downloads');
      } catch {
        folder = app.getPath('home');
      }
      const options: SaveDialogOptions = {
        title: 'Save attachment',
        defaultPath: path.join(folder, name),
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      };
      const panel = this.windows.getPanel();
      const choice =
        panel && !panel.isDestroyed()
          ? await dialog.showSaveDialog(panel, options)
          : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) {
        abort.abort();
        this.logger.info('attachment.download_cancelled', {});
        return;
      }

      const result = await body;
      if (!result.ok) {
        fail(
          'too_large',
          'The file is larger than this app downloads. Open the document in your browser to download it.',
        );
        return;
      }
      try {
        const file = await fs.open(choice.filePath, 'w');
        try {
          for (const chunk of result.chunks) {
            await file.write(chunk);
          }
        } finally {
          await file.close();
        }
      } catch {
        // Do not leave half a file behind under the name the person chose.
        await fs.rm(choice.filePath, { force: true }).catch(() => undefined);
        fail('write_failed', 'The file could not be written to the place you chose.');
        return;
      }
      this.logger.info('attachment.download_saved', { bytes: result.size });
      // The page is told that it worked, not where the file went.
      this.sendEvent(
        { type: 'message', tone: 'success', title: 'Attachment saved', description: null },
        'panel',
      );
    } catch {
      // A redirect (never followed), or a connection that was lost.
      fail('error', 'The connection to the server was interrupted. Try again.');
    }
  }

  // ── Renderer console ─────────────────────────────────────────────────────

  /**
   * Warnings and errors from the app's own pages (script errors, refused
   * Content-Security-Policy actions). A packaged build logs only where they
   * came from; the message text, which could in principle quote page content,
   * is kept and logged in development builds only.
   */
  private recordRendererConsole(entry: RendererConsoleEntry): void {
    const packaged = app.isPackaged;
    this.rendererConsole.push(packaged ? { ...entry, message: '' } : entry);
    if (this.rendererConsole.length > RENDERER_CONSOLE_LIMIT) this.rendererConsole.shift();
    const fields = { window: entry.window, source: entry.source, line: entry.line };
    const detail = packaged ? fields : { ...fields, detail: entry.message.slice(0, 300) };
    if (entry.level === 'error') this.logger.error('renderer.console', detail);
    else this.logger.warn('renderer.console', detail);
  }

  /** Recorded renderer warnings and errors, oldest first. */
  rendererConsoleEntries(): RendererConsoleEntry[] {
    return [...this.rendererConsole];
  }

  /**
   * A page's Content-Security-Policy refused something. The page keeps
   * working (that is the policy doing its job), but it should never happen
   * with the app's own code, so it is logged and shown in diagnostics.
   */
  reportPolicyViolation(
    window: PolicyViolationRecord['window'],
    report: { directive: string; blocked: string; source: string; line: number },
  ): void {
    const record: PolicyViolationRecord = { window, ...report, at: new Date().toISOString() };
    this.policyViolations.push(record);
    if (this.policyViolations.length > POLICY_VIOLATION_LIMIT) this.policyViolations.shift();
    this.logger.warn('renderer.policy_violation', {
      window,
      directive: report.directive,
      blocked: report.blocked,
      source: report.source,
      line: report.line,
    });
  }

  /** Refused policy actions recorded in this run, oldest first. */
  policyViolationRecords(): PolicyViolationRecord[] {
    return [...this.policyViolations];
  }

  // ── Accessors for the test hook ──────────────────────────────────────────

  describeShortcut(action: ShortcutAction): string {
    const item = this.shortcuts.status().find((entry) => entry.action === action);
    return item ? formatAccelerator(item.accelerator, this.platform.id) : '';
  }

  /** Runs the same handler the operating system would call for a global shortcut. */
  triggerShortcut(action: ShortcutAction): void {
    if (action === 'toggleVisibility') this.toggleVisibility();
    else void this.windows.recoverPanel();
  }

  /** Runs the same code as clicking a tray / menu item. */
  triggerMenuAction(action: MenuActionId): void {
    this.runMenuAction(action);
  }

  trayMenuModel(): ReturnType<typeof buildTrayMenuModel> {
    return buildTrayMenuModel(this.getState());
  }

  /** The tray tooltip as it would be set now. */
  trayTooltipText(): string {
    return trayTooltip(this.getState());
  }

  /** The document window's native title as the operating system shows it. */
  panelNativeTitle(): string {
    return this.windows.getPanel()?.getTitle() ?? '';
  }

  async flushPreferences(): Promise<void> {
    this.windows.persistBoundsNow();
    await this.preferences.flush();
  }
}
