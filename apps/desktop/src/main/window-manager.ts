/**
 * Owns the app's windows: the document window (the transparent panel in
 * Private Presenter Mode, or an ordinary framed window in normal mode), the
 * settings window and the resize probe. Creation, placement, pin, collapse,
 * the custom resize drag, click-through, taskbar/Dock presence, the fail-safe
 * for a disconnected display, and the capture-exclusion request for every
 * window that can show document content.
 *
 * Order for every window: created hidden; capture exclusion, always-on-top,
 * taskbar omission, transparency and the security options are all set before
 * the first show, and again whenever the window is recreated. After a show
 * (or a change of the request) the window is "pending" until it has been
 * drawn once: only then may the request be reported as accepted.
 */
import { randomBytes } from 'node:crypto';
import { BrowserWindow, app, screen, type Session } from 'electron';
import {
  PROTECTED_WINDOW_KINDS,
  platformHasProtectionApi,
  type ProtectedWindowKind,
  type WindowProtectionResult,
} from '../shared/capture';
import { CH } from '../shared/channels';
import {
  PANEL,
  PANEL_LIMITS,
  SIZE_PRESETS,
  applySize,
  chooseDragDelta,
  clampRectToArea,
  collapsedBounds,
  computeResize,
  decideDisplayChange,
  expandedBounds,
  nudgePosition,
  nudgeSize,
  pickDisplayForRect,
  primaryDisplay,
  rectsEqual,
  resolvePlacement,
  sanitizeRequestedBounds,
  type DisplayInfo,
  type KnownDisplay,
  type PlacementResult,
  type Point,
  type RecoveryReason,
  type Rect,
  type ResizeEdge,
  type SizeLimits,
  type SizePreset,
} from '../shared/geometry';
import { ACTIVATING_INPUT_TYPES, PANEL_INPUT_WINDOW_MS } from '../shared/panel-requests';
import type {
  DocumentWindowPreferences,
  Preferences,
  WindowPreferences,
} from '../shared/preferences';
import type { DocumentMode, SettingsTab } from '../shared/state';
import type { WindowKind } from './ipc-router';
import type { Logger } from './logger';
import type { DisplayAffinityDiagnostics } from './native/display-affinity';
import type { PlatformAdapter, PresenceApplication } from './platform';
import { guardWebContents } from './session-security';
import {
  documentWindowOptions,
  panelWindowOptions,
  probeWindowOptions,
  settingsWindowOptions,
  type WindowOptionInput,
} from './window-options';

const APP_ORIGIN = 'app://realtimedocs';
const RESIZE_THROTTLE_MS = 8;
const RESIZE_IDLE_TIMEOUT_MS = 15_000;
/** Focus events right after entering click-through are echoes of our own blur, not a user activation. */
const CLICK_THROUGH_FOCUS_GRACE_MS = 600;
/** After the preload's two animation frames: a little more, so one full composition has surely passed. */
const COMPOSITION_MARGIN_MS = 100;
/** A window that does not answer (not drawn: occluded, still loading) is asked again. */
const FRAME_RETRY_MS = 3000;

export interface WindowManagerOptions {
  platform: PlatformAdapter;
  session: Session;
  preloadPath: string;
  assetsDirectory: string;
  packaged: boolean;
  logger: Logger;
  getPreferences: () => Preferences;
  updateWindowPreferences: (change: (current: WindowPreferences) => WindowPreferences) => void;
  updateDocumentWindowPreferences: (
    change: (current: DocumentWindowPreferences) => DocumentWindowPreferences,
  ) => void;
  isCaptureRequested: () => boolean;
  /** Where RealtimeDocs is listed for the current mode (taskbar button, Dock icon). */
  getPresence: () => PresenceApplication;
  /** Whether hiding the panel would leave a way to bring it back. */
  canHide: () => boolean;
  /** The panel was parked (its display went away while private mode was on). */
  onParked: () => void;
  /** The optional Windows diagnostics module (main process only). */
  nativeAffinity: DisplayAffinityDiagnostics | null;
  /** Something visible changed: publish a new state snapshot. */
  onChange: () => void;
  isQuitting: () => boolean;
  /** A console message from one of the app's own pages (warnings and errors only). */
  onRendererConsole: (entry: RendererConsoleEntry) => void;
  /**
   * The panel tried to navigate somewhere it may not go. Returns true when
   * the link was an attachment of the open document and is being downloaded.
   */
  onPanelLink: (url: string) => boolean;
  /** A page called `window.open` (no window is created; the link may go to the OS). */
  onOpenWindow: (kind: WindowKind, url: string) => void;
}

export interface RendererConsoleEntry {
  window: WindowKind;
  level: 'warning' | 'error';
  /** File name of the script that logged it (no path, no query). */
  source: string;
  line: number;
  message: string;
}

interface ResizeDrag {
  start: Rect;
  edge: ResizeEdge;
  workArea: Rect | null;
  /** Pointer position (main-process reading) when the drag began. */
  startCursor: Point | null;
  cursorMoved: boolean;
  latest: { dx: number; dy: number } | null;
  timer: NodeJS.Timeout | null;
  idle: NodeJS.Timeout | null;
}

export function toDisplayInfo(display: Electron.Display, primaryId: number): DisplayInfo {
  return {
    id: display.id,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId,
    internal: display.internal,
    label: display.label,
    rotation: display.rotation,
  };
}

export type ParkedReason = 'display_removed';

export class WindowManager {
  private panel: BrowserWindow | null = null;
  private panelMode: DocumentMode = 'presenter';
  private settings: BrowserWindow | null = null;
  private probe: BrowserWindow | null = null;
  private readonly kinds = new Map<number, WindowKind>();
  private readonly protection = new Map<ProtectedWindowKind, WindowProtectionResult>();
  private readonly frames = new Map<
    ProtectedWindowKind,
    { nonce: string; timer: NodeJS.Timeout }
  >();
  private clickThrough = false;
  private clickThroughSince = 0;
  private hoverRecovery = false;
  private drag: ResizeDrag | null = null;
  private lastRecovery: { reason: RecoveryReason; at: string } | null = null;
  private settingsTab: SettingsTab = 'connection';
  private boundsTimer: NodeJS.Timeout | null = null;
  private panelReady = false;
  private lastPanelInput = 0;
  private parked: ParkedReason | null = null;
  /** The display the document window was on when it was last placed or moved. */
  private knownDisplay: KnownDisplay | null = null;
  /** True while the document window is replaced (mode switch): its close is real then. */
  private replacing = false;
  private panelTitle = 'RealtimeDocs';

  constructor(private readonly options: WindowManagerOptions) {}

  // ── Lookup ───────────────────────────────────────────────────────────────

  kindOf(webContentsId: number): WindowKind | null {
    return this.kinds.get(webContentsId) ?? null;
  }

  /** The document window (panel or ordinary window), whichever mode it is in. */
  getPanel(): BrowserWindow | null {
    return this.panel && !this.panel.isDestroyed() ? this.panel : null;
  }

  getSettings(): BrowserWindow | null {
    return this.settings && !this.settings.isDestroyed() ? this.settings : null;
  }

  getProbe(): BrowserWindow | null {
    return this.probe && !this.probe.isDestroyed() ? this.probe : null;
  }

  /** Windows that should receive state snapshots. */
  allWindows(): BrowserWindow[] {
    return [this.getPanel(), this.getSettings(), this.getProbe()].filter(
      (window): window is BrowserWindow => window !== null,
    );
  }

  displays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display) => toDisplayInfo(display, primaryId));
  }

  isClickThrough(): boolean {
    return this.clickThrough;
  }

  getMode(): DocumentMode {
    return this.panelMode;
  }

  getParked(): ParkedReason | null {
    return this.parked;
  }

  getLastRecovery(): { reason: RecoveryReason; at: string } | null {
    return this.lastRecovery;
  }

  getSettingsTab(): SettingsTab {
    return this.settingsTab;
  }

  protectionResults(): WindowProtectionResult[] {
    return PROTECTED_WINDOW_KINDS.flatMap((kind) => {
      const result = this.protection.get(kind);
      return result ? [{ ...result }] : [];
    });
  }

  panelBounds(): Rect {
    const panel = this.getPanel();
    if (panel) return { ...panel.getBounds() };
    const saved = this.savedPlacement();
    return saved.bounds ?? { x: 0, y: 0, width: PANEL.defaultWidth, height: PANEL.defaultHeight };
  }

  /** Collapse is a presenter-panel feature; the ordinary window is never collapsed. */
  private isCollapsed(): boolean {
    return this.panelMode === 'presenter' && this.options.getPreferences().window.collapsed;
  }

  private savedPlacement(): { bounds: Rect | null; displayId: number | null } {
    const prefs = this.options.getPreferences();
    return this.options.getPreferences().window.mode === 'normal'
      ? { bounds: prefs.documentWindow.bounds, displayId: prefs.documentWindow.displayId }
      : { bounds: prefs.window.bounds, displayId: prefs.window.displayId };
  }

  // ── Document window lifecycle ────────────────────────────────────────────

  private optionInput(): WindowOptionInput {
    return {
      preloadPath: this.options.preloadPath,
      session: this.options.session,
      packaged: this.options.packaged,
      platform: this.options.platform.id,
      iconPath: this.options.platform.windowIconPath(this.options.assetsDirectory),
    };
  }

  private limits(): SizeLimits {
    return this.isCollapsed()
      ? { ...PANEL_LIMITS, minHeight: PANEL.collapsedHeight, maxHeight: PANEL.collapsedHeight }
      : PANEL_LIMITS;
  }

  /**
   * Creates the document window hidden in the mode the preferences name,
   * applies protection, pin, presence and workspace settings, and loads the page.
   */
  async createPanel(): Promise<BrowserWindow> {
    const existing = this.getPanel();
    if (existing) return existing;

    const prefs = this.options.getPreferences();
    const mode: DocumentMode = prefs.window.mode;
    this.panelMode = mode;
    const saved = this.savedPlacement();
    const collapsed = this.isCollapsed();
    const displays = this.displays();
    const previous = saved.displayId === null ? null : { id: saved.displayId };
    // At start, as after a display change: with private mode on, a panel whose
    // display is gone is not moved onto another one by itself.
    const decision = decideDisplayChange({
      current: saved.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
      previous: saved.bounds ? previous : null,
      displays,
      collapsed,
      protect: this.options.isCaptureRequested(),
    });
    const placement: PlacementResult =
      decision.action === 'keep'
        ? resolvePlacement({
            saved: saved.bounds,
            savedDisplayId: saved.displayId,
            displays,
            collapsed,
          })
        : decision.placement;
    if (placement.recovered && placement.reason && placement.reason !== 'no_saved_bounds') {
      this.lastRecovery = { reason: placement.reason, at: new Date().toISOString() };
      this.options.logger.info('panel.bounds_recovered', { reason: placement.reason });
    }

    const presence = this.options.getPresence();
    const base = { ...this.optionInput(), bounds: placement.bounds };
    const window = new BrowserWindow({
      ...(mode === 'presenter' ? panelWindowOptions(base) : documentWindowOptions(base)),
      ...this.options.platform.panelWindowOptions({ mode, omitted: presence.omitted }),
    });
    this.panel = window;
    this.panelReady = false;
    this.register(window, 'panel');
    this.persistBounds(placement.bounds, placement.displayId);

    // Before the window is ever shown:
    this.applyProtection(window, 'panel');
    this.applyPinTo(window);
    this.applyWorkspaceTo(window);
    this.options.platform.applyPresence(app, window, presence);
    this.options.platform.applyMissionControl(window, mode === 'presenter');
    window.setTitle(this.panelTitle);
    // The native title is ours to decide (it is drawn outside the window, for
    // example in the taskbar and in a meeting app's list of windows).
    window.on('page-title-updated', (event) => event.preventDefault());

    window.on('close', (event) => {
      // Closing the panel hides it; quitting is a separate, explicit command.
      if (this.options.isQuitting() || this.replacing) return;
      event.preventDefault();
      this.hidePanel();
    });
    window.on('closed', () => {
      this.unregister(window);
      if (this.panel === window) {
        this.panel = null;
        this.protection.delete('panel');
        this.clearFrame('panel');
      }
      this.clickThrough = false;
      this.endDrag(false);
      this.options.onChange();
    });
    const trackBounds = () => this.scheduleBoundsPersist();
    window.on('move', trackBounds);
    window.on('moved', trackBounds);
    window.on('resize', trackBounds);
    window.on('show', () => {
      this.awaitComposition('panel', window);
      this.options.onChange();
    });
    window.on('hide', () => {
      this.compositionHidden('panel');
      this.options.onChange();
    });
    window.on('blur', () => this.options.onChange());
    window.on('focus', () => {
      // The user activated the panel (taskbar, Alt+Tab, Dock): that is a request to interact.
      if (this.clickThrough && Date.now() - this.clickThroughSince > CLICK_THROUGH_FOCUS_GRACE_MS) {
        this.setClickThrough(false);
      }
      this.options.onChange();
    });
    window.on('always-on-top-changed', () => this.options.onChange());

    window.webContents.on('render-process-gone', (_event, details) => {
      this.options.logger.error('panel.renderer_gone', { reason: details.reason });
      // Never leave a dead, click-through window on screen.
      this.setClickThrough(false);
      if (!window.isDestroyed() && details.reason !== 'clean-exit') {
        setTimeout(() => {
          if (!window.isDestroyed()) window.webContents.reload();
        }, 500);
      }
    });

    if (decision.action === 'park') this.park('startup');

    try {
      await window.loadURL(`${APP_ORIGIN}/panel.html`);
    } catch (error) {
      this.options.logger.error('panel.load_failed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
    this.panelReady = true;
    return window;
  }

  /** Reloads the panel page (new CSP after a server change). */
  reloadPanel(): void {
    const panel = this.getPanel();
    if (panel && this.panelReady) panel.webContents.reload();
  }

  /**
   * Shows the document window. `focus: false` uses `showInactive()`, so the
   * application the user is working in keeps keyboard focus — this is the
   * path for shortcuts, the tray and anything not directly started by a click
   * on the panel itself.
   *
   * `userAction: false` (startup, a document that arrived, a notice) never
   * brings back a parked panel and never moves it onto another display while
   * private mode is on; a user's request does both.
   */
  async showPanel(options: { focus: boolean; userAction?: boolean }): Promise<void> {
    const panel = await this.createPanel();
    if (options.userAction) {
      this.unpark();
      this.placeOnScreen(false);
    } else {
      if (this.parked) return;
      this.revalidateBounds('show');
      if (this.parked) return;
    }
    if (options.focus) {
      if (panel.isMinimized()) panel.restore();
      panel.show();
      panel.focus();
    } else {
      if (panel.isMinimized()) panel.restore();
      panel.showInactive();
      // Bring it above its neighbours without activating it.
      if (!this.isPinnedOnTop()) panel.moveTop();
    }
    this.options.onChange();
  }

  /**
   * The emergency way back ("Return to interactive mode"): leaves
   * click-through, un-parks, un-collapses, shows, raises and moves the panel
   * fully onto a display. Always a user's request.
   */
  async recoverPanel(): Promise<void> {
    await this.createPanel();
    this.unpark();
    this.setClickThrough(false);
    if (this.isCollapsed()) this.setCollapsed(false);
    this.placeOnScreen(true);
    await this.showPanel({ focus: false, userAction: true });
    const panel = this.getPanel();
    panel?.moveTop();
    this.options.onChange();
  }

  hidePanel(): void {
    const panel = this.getPanel();
    if (!panel) return;
    // A hidden panel must come back interactive.
    this.setClickThrough(false);
    this.endDrag(true);
    panel.hide();
    this.options.onChange();
  }

  isPanelVisible(): boolean {
    return this.getPanel()?.isVisible() ?? false;
  }

  /** The document window's native title (taskbar, window lists). */
  setPanelTitle(title: string): void {
    this.panelTitle = title;
    const panel = this.getPanel();
    if (panel && panel.getTitle() !== title) panel.setTitle(title);
  }

  /**
   * Shows the open document in the other mode. The session stays: no new
   * link, no new sign-in; the new window opens its own live connection with a
   * fresh short-lived ticket. Each mode keeps its own bounds.
   */
  async switchMode(mode: DocumentMode): Promise<void> {
    if (mode === this.panelMode && this.getPanel()) return;
    const old = this.getPanel();
    if (old) {
      this.persistBoundsNow();
      this.setClickThrough(false);
    }
    this.options.updateWindowPreferences((current) => ({ ...current, mode }));
    this.parked = null;
    if (old) {
      this.replacing = true;
      try {
        old.destroy();
      } finally {
        this.replacing = false;
      }
    }
    this.panel = null;
    await this.createPanel();
    await this.showPanel({ focus: true, userAction: true });
    this.options.logger.info('panel.mode_changed', { mode });
  }

  // ── Bounds ───────────────────────────────────────────────────────────────

  private workAreaFor(bounds: Rect): Rect | null {
    const displays = this.displays();
    return (pickDisplayForRect(bounds, displays) ?? primaryDisplay(displays))?.workArea ?? null;
  }

  private applyBounds(next: Rect): void {
    const panel = this.getPanel();
    if (!panel) return;
    if (rectsEqual(panel.getBounds(), next)) return;
    panel.setBounds(next);
    this.scheduleBoundsPersist();
  }

  private scheduleBoundsPersist(): void {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = null;
      const panel = this.getPanel();
      if (!panel) return;
      // A parked panel was moved by the operating system, not by the user.
      if (this.parked) return;
      const bounds = { ...panel.getBounds() };
      const display = pickDisplayForRect(bounds, this.displays());
      this.persistBounds(bounds, display?.id ?? null);
      this.options.onChange();
    }, 120);
  }

  /**
   * Hands the panel's current bounds to the preference store right now,
   * instead of after the debounce. Called before quitting (while the window
   * still exists), so the last move or resize is never lost.
   */
  persistBoundsNow(): void {
    if (this.boundsTimer) {
      clearTimeout(this.boundsTimer);
      this.boundsTimer = null;
    }
    const panel = this.getPanel();
    if (!panel) return;
    this.endDrag(true);
    if (this.boundsTimer) {
      clearTimeout(this.boundsTimer);
      this.boundsTimer = null;
    }
    if (this.parked) return;
    const bounds = { ...panel.getBounds() };
    this.persistBounds(bounds, pickDisplayForRect(bounds, this.displays())?.id ?? null);
  }

  private persistBounds(bounds: Rect, displayId: number | null): void {
    const display = displayId === null ? null : this.displays().find((d) => d.id === displayId);
    this.knownDisplay = display ? { id: display.id, bounds: { ...display.bounds } } : null;
    if (this.panelMode === 'normal') {
      this.options.updateDocumentWindowPreferences(() => ({ bounds, displayId }));
      return;
    }
    this.options.updateWindowPreferences((current) => ({
      ...current,
      bounds,
      displayId,
      expandedHeight: current.collapsed ? current.expandedHeight : bounds.height,
    }));
  }

  /**
   * Re-checks the panel against the current displays (show, monitor
   * added/removed, resolution or scale change, wake from sleep). Without
   * private mode an unreachable panel is pulled back onto a display. With
   * private mode on it never moves onto ANOTHER display by itself: it is
   * parked (hidden) instead, and only a user's request brings it back.
   */
  revalidateBounds(trigger: string): void {
    const panel = this.getPanel();
    if (!panel || this.parked) return;
    const current = { ...panel.getBounds() };
    const saved = this.savedPlacement();
    const previous =
      this.knownDisplay ?? (saved.displayId === null ? null : { id: saved.displayId });
    const decision = decideDisplayChange({
      current,
      previous,
      displays: this.displays(),
      collapsed: this.isCollapsed(),
      protect: this.options.isCaptureRequested(),
    });
    if (decision.action === 'keep') return;
    if (decision.action === 'park') {
      this.park(trigger);
      return;
    }
    const { placement } = decision;
    panel.setBounds(placement.bounds);
    if (placement.reason) {
      this.lastRecovery = { reason: placement.reason, at: new Date().toISOString() };
      this.options.logger.info('panel.bounds_recovered', { reason: placement.reason, trigger });
    }
    this.persistBounds(placement.bounds, placement.displayId);
    this.options.onChange();
  }

  /**
   * A display was removed (Electron's `display-removed`). Acted on at once,
   * not after the usual settle delay: with private mode on, the panel must
   * not stay where the operating system has just put it.
   */
  handleDisplayRemoved(): void {
    if (!this.options.isCaptureRequested()) return;
    this.revalidateBounds('display-removed');
  }

  private park(trigger: string): void {
    this.parked = 'display_removed';
    this.setClickThrough(false);
    this.endDrag(false);
    const panel = this.getPanel();
    if (panel) {
      if (this.options.canHide()) {
        panel.hide();
      } else if (this.panelMode === 'normal') {
        // The ordinary window always has its taskbar button to come back from.
        panel.minimize();
      } else {
        // No way back from hiding: collapse to the title strip, which then
        // shows no document content (see the panel header), where it is.
        if (!this.isCollapsed()) this.setCollapsed(true);
      }
    }
    this.options.logger.warn('panel.parked', { reason: 'display_removed', trigger });
    this.options.onParked();
    this.options.onChange();
  }

  private unpark(): void {
    if (!this.parked) return;
    this.parked = null;
    this.options.logger.info('panel.unparked', {});
    this.options.onChange();
  }

  /** Puts the window where it can be reached (a user's request: any display may be used). */
  private placeOnScreen(fully: boolean): void {
    const panel = this.getPanel();
    if (!panel) return;
    const current = { ...panel.getBounds() };
    const displays = this.displays();
    const placement = resolvePlacement({
      saved: current,
      savedDisplayId: null,
      displays,
      collapsed: this.isCollapsed(),
    });
    let next = placement.bounds;
    if (fully) {
      const owner = pickDisplayForRect(next, displays) ?? primaryDisplay(displays);
      if (owner) next = clampRectToArea(next, owner.workArea);
    }
    if (!rectsEqual(current, next)) {
      panel.setBounds(next);
      this.persistBounds(next, pickDisplayForRect(next, displays)?.id ?? null);
    }
  }

  /**
   * `stayOnDisplay`: the panel asked, and private mode is on. The result stays
   * on the display the panel is on, so content in the panel cannot move the
   * notes onto another display (which may be the one being shared).
   */
  setPanelBounds(requested: Partial<Rect>, stayOnDisplay = false): void {
    const panel = this.getPanel();
    if (!panel) return;
    const current = { ...panel.getBounds() };
    this.applyBounds(
      sanitizeRequestedBounds(
        requested,
        current,
        this.displays(),
        this.limits(),
        stayOnDisplay ? current : null,
      ),
    );
  }

  applyPreset(preset: SizePreset): void {
    const panel = this.getPanel();
    if (!panel) return;
    if (this.isCollapsed()) this.setCollapsed(false);
    const current = panel.getBounds();
    this.applyBounds(
      applySize(current, SIZE_PRESETS[preset], PANEL_LIMITS, this.workAreaFor(current)),
    );
  }

  nudge(change: { deltaWidth: number; deltaHeight: number; deltaX: number; deltaY: number }): void {
    const panel = this.getPanel();
    if (!panel) return;
    let next: Rect = { ...panel.getBounds() };
    const workArea = this.workAreaFor(next);
    if (change.deltaX !== 0 || change.deltaY !== 0) {
      next = nudgePosition(next, change.deltaX, change.deltaY, workArea);
    }
    if (change.deltaWidth !== 0 || change.deltaHeight !== 0) {
      next = nudgeSize(
        next,
        change.deltaWidth,
        this.isCollapsed() ? 0 : change.deltaHeight,
        this.limits(),
        workArea,
      );
    }
    this.applyBounds(next);
  }

  /**
   * Back to the default spot. With `keepDisplay` (private mode is on) that is
   * the default spot of the display the panel is on, if it still exists;
   * otherwise, and without private mode, the primary display's.
   */
  resetPosition(keepDisplay = false): void {
    const panel = this.getPanel();
    if (!panel) return;
    const current = { ...panel.getBounds() };
    const collapsed = this.isCollapsed();
    const size = {
      width: current.width,
      height: collapsed ? PANEL.collapsedHeight : current.height,
    };
    const displays = this.displays();
    const home = keepDisplay ? pickDisplayForRect(current, displays) : null;
    const { bounds } = resolvePlacement({
      saved: null,
      savedDisplayId: null,
      // The default spot of that one display, as if it were the primary one.
      displays: home ? [{ ...home, primary: true }] : displays,
      collapsed,
      defaultSize: size,
    });
    this.applyBounds(bounds);
    this.lastRecovery = null;
  }

  // ── Custom resize (the panel is created non-resizable) ───────────────────

  beginResize(edge: ResizeEdge): void {
    const panel = this.getPanel();
    if (!panel || this.clickThrough || this.panelMode !== 'presenter') return;
    this.endDrag(false);
    // A collapsed panel is a fixed-height strip: only its width can change.
    const effective = this.isCollapsed() ? (edge.replace(/[ns]/g, '') as ResizeEdge | '') : edge;
    if (!effective) return;
    const start = { ...panel.getBounds() };
    this.drag = {
      start,
      edge: effective,
      workArea: this.workAreaFor(start),
      startCursor: this.readCursor(),
      cursorMoved: false,
      latest: null,
      timer: null,
      idle: null,
    };
    this.armDragIdle();
  }

  resizeMove(dx: number, dy: number): void {
    const drag = this.drag;
    if (!drag) return;
    // The page's message is the tick; the distance is measured here whenever
    // the platform lets the main process read the pointer.
    const delta = chooseDragDelta({
      startCursor: drag.startCursor,
      cursor: drag.startCursor ? this.readCursor() : null,
      cursorMoved: drag.cursorMoved,
      reported: { dx, dy },
    });
    drag.cursorMoved = delta.cursorMoved;
    drag.latest = { dx: delta.dx, dy: delta.dy };
    this.armDragIdle();
    if (drag.timer) return;
    drag.timer = setTimeout(() => {
      drag.timer = null;
      this.flushDrag();
    }, RESIZE_THROTTLE_MS);
  }

  endResize(): void {
    this.endDrag(true);
  }

  /** Absolute pointer position in DIPs, or null where the platform cannot report it. */
  private readCursor(): Point | null {
    try {
      const point = screen.getCursorScreenPoint();
      return Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { x: point.x, y: point.y }
        : null;
    } catch {
      return null;
    }
  }

  private armDragIdle(): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.idle) clearTimeout(drag.idle);
    // If the renderer never reports the end (crash, lost pointer), stop on our own.
    drag.idle = setTimeout(() => this.endDrag(true), RESIZE_IDLE_TIMEOUT_MS);
  }

  private flushDrag(): void {
    const drag = this.drag;
    const panel = this.getPanel();
    if (!drag || !panel || !drag.latest) return;
    const next = computeResize(
      drag.start,
      drag.edge,
      drag.latest.dx,
      drag.latest.dy,
      this.limits(),
      drag.workArea,
    );
    drag.latest = null;
    if (!rectsEqual(panel.getBounds(), next)) panel.setBounds(next);
  }

  private endDrag(apply: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.timer) clearTimeout(drag.timer);
    if (drag.idle) clearTimeout(drag.idle);
    if (apply) this.flushDrag();
    this.drag = null;
    this.scheduleBoundsPersist();
  }

  // ── Collapse, pin, workspace, presence ───────────────────────────────────

  setCollapsed(collapsed: boolean): void {
    if (this.panelMode !== 'presenter') return;
    const panel = this.getPanel();
    const prefs = this.options.getPreferences().window;
    if (prefs.collapsed === collapsed) return;
    this.endDrag(true);
    const current = panel ? { ...panel.getBounds() } : prefs.bounds;
    this.options.updateWindowPreferences((window) => ({
      ...window,
      collapsed,
      expandedHeight: collapsed && current ? current.height : window.expandedHeight,
    }));
    if (panel && current) {
      const next = collapsed
        ? collapsedBounds(current)
        : expandedBounds(current, prefs.expandedHeight, PANEL_LIMITS, this.workAreaFor(current));
      panel.setBounds(next);
      this.scheduleBoundsPersist();
    }
    this.options.onChange();
  }

  setPinned(pinned: boolean): void {
    this.options.updateWindowPreferences((window) => ({ ...window, pinned }));
    this.reapplyPin();
    this.options.onChange();
  }

  private isPinnedOnTop(): boolean {
    return this.panelMode === 'presenter' && this.options.getPreferences().window.pinned;
  }

  private applyPinTo(window: BrowserWindow): void {
    const prefs = this.options.getPreferences().window;
    // The ordinary window is never on top.
    this.options.platform.applyPin(window, this.isPinnedOnTop(), prefs.pinLevel);
  }

  reapplyPin(): void {
    const panel = this.getPanel();
    if (panel) this.applyPinTo(panel);
  }

  private applyWorkspaceTo(window: BrowserWindow): void {
    const prefs = this.options.getPreferences().window;
    const presenter = this.panelMode === 'presenter';
    this.options.platform.applyWorkspaceVisibility(
      window,
      {
        allWorkspaces: presenter && prefs.visibleOnAllWorkspaces,
        fullScreen: presenter && prefs.visibleOnFullScreen,
      },
      this.options.getPresence().activationPolicy === 'accessory',
    );
  }

  reapplyWorkspaceVisibility(): void {
    const panel = this.getPanel();
    if (panel) this.applyWorkspaceTo(panel);
  }

  /** Taskbar button / activation policy, for the current mode. */
  applyPresence(presence: PresenceApplication): void {
    this.options.platform.applyPresence(app, this.getPanel(), presence);
  }

  // ── Click-through ────────────────────────────────────────────────────────

  /**
   * Turns click-through on or off. The caller has already checked that a
   * recovery path exists before turning it on. The ordinary window never
   * ignores the mouse.
   */
  setClickThrough(enabled: boolean): void {
    const panel = this.getPanel();
    if (!panel) {
      this.clickThrough = false;
      return;
    }
    if (enabled && this.panelMode !== 'presenter') return;
    if (this.clickThrough === enabled) return;
    this.clickThrough = enabled;
    this.hoverRecovery = false;
    if (enabled) {
      this.endDrag(true);
      this.clickThroughSince = Date.now();
      if (this.options.platform.supportsMouseForwarding) {
        // Forwarded mouse moves let the page notice the pointer over the
        // "return to interactive mode" badge.
        panel.setIgnoreMouseEvents(true, { forward: true });
      } else {
        panel.setIgnoreMouseEvents(true);
      }
      // Reading mode: typing should go to the application underneath.
      if (panel.isFocused()) panel.blur();
    } else {
      panel.setIgnoreMouseEvents(false);
    }
    this.options.onChange();
  }

  /**
   * While the pointer rests on the in-panel badge the window accepts mouse
   * events again, so the badge can be clicked. Only on platforms that forward
   * mouse moves to an ignoring window.
   */
  setClickThroughHover(hovering: boolean): void {
    const panel = this.getPanel();
    if (!panel || !this.clickThrough || !this.options.platform.supportsMouseForwarding) return;
    if (this.hoverRecovery === hovering) return;
    this.hoverRecovery = hovering;
    if (hovering) panel.setIgnoreMouseEvents(false);
    else panel.setIgnoreMouseEvents(true, { forward: true });
  }

  // ── Capture exclusion request ────────────────────────────────────────────

  private applyProtection(window: BrowserWindow, kind: ProtectedWindowKind): void {
    const requested = this.options.isCaptureRequested();
    const result: WindowProtectionResult = {
      window: kind,
      requested,
      attempted: false,
      error: null,
      readBack: null,
      affinity: null,
      pendingComposition: false,
      composedAt: null,
      at: new Date().toISOString(),
    };
    if (platformHasProtectionApi(this.options.platform.id)) {
      result.attempted = true;
      try {
        window.setContentProtection(requested);
        result.readBack = window.isContentProtected();
      } catch (error) {
        result.error = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
      }
    }
    this.protection.set(kind, result);
    // A window already on screen has to be drawn once more before the change counts.
    if (!window.isDestroyed() && window.isVisible()) this.awaitComposition(kind, window);
  }

  /** Applies the current request to every existing window (toggle, display change, wake). */
  reapplyProtection(): void {
    const windows: [ProtectedWindowKind, BrowserWindow | null][] = [
      ['panel', this.getPanel()],
      ['settings', this.getSettings()],
      ['probe', this.getProbe()],
    ];
    for (const [kind, window] of windows) {
      if (window) this.applyProtection(window, kind);
      else this.protection.delete(kind);
    }
    this.options.onChange();
  }

  /**
   * Marks a window as not yet drawn since its request and asks it to answer
   * once it has been: with the Windows diagnostics module, after one desktop
   * composition (`DwmFlush`) and a read-back of the window's display affinity;
   * otherwise from the preload after two animation frames, plus a margin.
   */
  private awaitComposition(kind: ProtectedWindowKind, window: BrowserWindow): void {
    const result = this.protection.get(kind);
    if (!result || window.isDestroyed() || !window.isVisible()) return;
    result.pendingComposition = true;
    const native = this.options.nativeAffinity;
    if (native && this.options.platform.id === 'win32') {
      // After the show has been processed.
      setTimeout(() => this.readNativeAffinity(kind, window, native), 0);
      return;
    }
    this.requestFrame(kind, window);
  }

  private requestFrame(kind: ProtectedWindowKind, window: BrowserWindow): void {
    this.clearFrame(kind);
    const nonce = randomBytes(12).toString('base64url');
    const timer = setTimeout(() => {
      if (this.frames.get(kind)?.nonce !== nonce) return;
      this.frames.delete(kind);
      const result = this.protection.get(kind);
      if (result?.pendingComposition && !window.isDestroyed() && window.isVisible()) {
        this.requestFrame(kind, window);
      }
    }, FRAME_RETRY_MS);
    this.frames.set(kind, { nonce, timer });
    if (!window.webContents.isDestroyed()) window.webContents.send(CH.frameRequest, nonce);
  }

  private clearFrame(kind: ProtectedWindowKind): void {
    const entry = this.frames.get(kind);
    if (entry) clearTimeout(entry.timer);
    this.frames.delete(kind);
  }

  /** The preload of `kind` answered; only the answer to the current question counts. */
  frameAck(kind: WindowKind, nonce: string): void {
    const entry = this.frames.get(kind);
    if (!entry || entry.nonce !== nonce) return;
    this.clearFrame(kind);
    setTimeout(() => {
      const result = this.protection.get(kind);
      if (!result?.pendingComposition) return;
      result.pendingComposition = false;
      result.composedAt = new Date().toISOString();
      this.options.onChange();
    }, COMPOSITION_MARGIN_MS);
  }

  private compositionHidden(kind: ProtectedWindowKind): void {
    this.clearFrame(kind);
    const result = this.protection.get(kind);
    if (result) result.pendingComposition = false;
  }

  private readNativeAffinity(
    kind: ProtectedWindowKind,
    window: BrowserWindow,
    native: DisplayAffinityDiagnostics,
  ): void {
    const result = this.protection.get(kind);
    if (!result || window.isDestroyed()) return;
    const flushed = native.waitOneCompositionCycle();
    const reading = native.getAffinity(window);
    result.affinity = reading.ok ? reading.name : 'unknown';
    result.pendingComposition = false;
    result.composedAt = new Date().toISOString();
    if (!flushed.ok || !reading.ok) {
      this.options.logger.warn('native.affinity_read_failed', {
        flush: flushed.ok ? 'ok' : flushed.error,
        read: reading.ok ? 'ok' : reading.error,
      });
    }
    this.options.onChange();
  }

  /** Raw affinity of the document window as last read by the diagnostics module. */
  panelAffinity(): string | null {
    return this.protection.get('panel')?.affinity ?? null;
  }

  // ── Settings and probe windows ───────────────────────────────────────────

  async openSettings(tab?: SettingsTab): Promise<void> {
    if (tab) this.settingsTab = tab;
    const existing = this.getSettings();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      this.options.onChange();
      return;
    }
    const window = new BrowserWindow(settingsWindowOptions(this.optionInput()));
    this.settings = window;
    this.register(window, 'settings');
    this.applyProtection(window, 'settings');
    window.removeMenu();
    window.on('closed', () => {
      this.unregister(window);
      if (this.settings === window) this.settings = null;
      this.protection.delete('settings');
      this.clearFrame('settings');
      this.options.onChange();
    });
    window.on('focus', () => this.options.onChange());
    window.on('show', () => {
      this.awaitComposition('settings', window);
      this.options.onChange();
    });
    window.on('hide', () => this.compositionHidden('settings'));
    try {
      await window.loadURL(`${APP_ORIGIN}/settings.html`);
    } catch (error) {
      this.options.logger.error('settings.load_failed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
    this.options.onChange();
  }

  setSettingsTab(tab: SettingsTab): void {
    this.settingsTab = tab;
  }

  closeSettings(): void {
    this.getSettings()?.close();
  }

  async openProbe(): Promise<void> {
    const existing = this.getProbe();
    if (existing) {
      existing.show();
      return;
    }
    const window = new BrowserWindow(probeWindowOptions(this.optionInput()));
    this.probe = window;
    this.register(window, 'probe');
    this.applyProtection(window, 'probe');
    window.on('closed', () => {
      this.unregister(window);
      if (this.probe === window) this.probe = null;
      this.protection.delete('probe');
      this.clearFrame('probe');
      this.options.onChange();
    });
    window.on('show', () => {
      this.awaitComposition('probe', window);
      this.options.onChange();
    });
    window.on('hide', () => this.compositionHidden('probe'));
    try {
      await window.loadURL(`${APP_ORIGIN}/probe.html`);
    } catch (error) {
      this.options.logger.error('probe.load_failed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
    if (!window.isDestroyed()) window.show();
    this.options.onChange();
  }

  closeProbe(): void {
    this.getProbe()?.close();
  }

  destroyAll(): void {
    for (const window of [this.panel, this.settings, this.probe]) {
      if (window && !window.isDestroyed()) window.destroy();
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Whether the reader clicked or typed in the panel in the last few seconds,
   * as the operating system delivered it (page script cannot produce these
   * events). For the two panel paths that never pass through the preload:
   * `window.open` and following a link to an attachment.
   */
  panelHadRecentInput(now = Date.now()): boolean {
    return now - this.lastPanelInput <= PANEL_INPUT_WINDOW_MS;
  }

  private register(window: BrowserWindow, kind: WindowKind): void {
    this.kinds.set(window.webContents.id, kind);
    if (kind === 'panel') {
      window.webContents.on('input-event', (_event, input) => {
        if (ACTIVATING_INPUT_TYPES.has(input.type)) this.lastPanelInput = Date.now();
      });
    }
    guardWebContents(window.webContents, {
      logger: this.options.logger,
      onOpenWindow: (url) => this.options.onOpenWindow(kind, url),
      // Only the panel shows documents; the other windows have nothing to download.
      ...(kind === 'panel' ? { onRefusedNavigation: this.options.onPanelLink } : {}),
    });
    // Content-Security-Policy violations and script errors surface here from
    // the very first script of a page, before any test or tool can attach.
    window.webContents.on('console-message', (details) => {
      if (details.level !== 'error' && details.level !== 'warning') return;
      let source: string;
      try {
        source = new URL(details.sourceId).pathname.split('/').pop() ?? '';
      } catch {
        source = '';
      }
      this.options.onRendererConsole({
        window: kind,
        level: details.level,
        source,
        line: details.lineNumber,
        message: details.message,
      });
    });
  }

  private unregister(window: BrowserWindow): void {
    for (const [id, kind] of this.kinds) {
      if (
        (kind === 'panel' && window === this.panel) ||
        (kind === 'settings' && window === this.settings) ||
        (kind === 'probe' && window === this.probe)
      ) {
        this.kinds.delete(id);
      }
    }
  }
}
