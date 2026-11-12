/**
 * The one interface behind which native differences live. Each adapter
 * (`win32.ts`, `darwin.ts`, `linux.ts`) is small and declarative; everything
 * that can be decided without the operating system stays in `src/shared`.
 *
 * Windows and macOS are the product platforms. Linux exists for development
 * and the automated Xvfb smoke test only.
 */
import type {
  App,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Menu,
  NativeImage,
} from 'electron';
import type { PinLevel } from '../../shared/preferences';
import type { DesktopPlatform } from '../../shared/shortcuts';
import type { AppState, DocumentMode } from '../../shared/state';
import type { MenuActionId } from '../menu-model';

export interface WorkspaceVisibility {
  allWorkspaces: boolean;
  fullScreen: boolean;
}

/** Where RealtimeDocs is listed: decided by `shared/presence.ts` and the document mode. */
export interface PresenceApplication {
  /** Windows: the panel has no taskbar button. */
  omitted: boolean;
  /** macOS: `accessory` means no Dock icon. Null elsewhere. */
  activationPolicy: 'regular' | 'accessory' | null;
}

export interface PlatformAdapter {
  readonly id: DesktopPlatform;

  /** Whether the app has a Dock icon that can bring the panel back (macOS). */
  readonly hasDock: boolean;

  /**
   * The system lets another topmost or full-screen window cover a pinned panel without any event
   * reaching the panel, so the pin has to be applied again at intervals (Windows). Elsewhere the
   * window level and the full-screen visibility setting already keep the panel in front.
   */
  readonly reassertsPin: boolean;

  /**
   * Whether `setIgnoreMouseEvents(true, { forward: true })` is supported, which
   * the in-panel "hover to return" recovery needs (Electron: macOS and Windows).
   */
  readonly supportsMouseForwarding: boolean;

  /** A left click on the tray icon shows the panel (Windows). On macOS the click opens the menu. */
  readonly trayClickShowsPanel: boolean;

  /**
   * Platform-specific additions to the document window's options, applied at
   * creation, before the first show.
   */
  panelWindowOptions(input: {
    mode: DocumentMode;
    omitted: boolean;
  }): Partial<BrowserWindowConstructorOptions>;

  /**
   * Taskbar button (Windows) / activation policy (macOS). Applied before the
   * first show and again whenever the window is recreated or the inputs change.
   */
  applyPresence(app: App, window: BrowserWindow | null, presence: PresenceApplication): void;

  /** macOS: leave the presenter panel out of Mission Control. No-op elsewhere. */
  applyMissionControl(window: BrowserWindow, hidden: boolean): void;

  /**
   * Pin (always-on-top). The level is a request to the window manager; it is
   * never a guarantee to cover every system surface or fullscreen application.
   */
  applyPin(window: BrowserWindow, pinned: boolean, level: PinLevel): void;

  /**
   * Spaces/virtual-desktop and fullscreen visibility, where the platform has
   * the concept. `accessory`: the macOS process already runs without a Dock
   * icon, so Electron's process-type switch is skipped (documented option
   * `skipTransformProcessType`).
   */
  applyWorkspaceVisibility(
    window: BrowserWindow,
    visibility: WorkspaceVisibility,
    accessory: boolean,
  ): void;

  /** Tray / menu-bar image. `active` marks click-through mode. */
  trayImage(assetsDirectory: string, active: boolean): NativeImage;

  /** Icon for ordinary windows, where the platform uses one. */
  windowIconPath(assetsDirectory: string): string | undefined;

  /** The application menu, or null where the platform convention is no menu bar. */
  buildApplicationMenu(state: AppState, run: (action: MenuActionId) => void): Menu | null;

  /** Registers this executable as the handler of `realtimedocs://` links. */
  registerProtocolClient(app: App): boolean;

  /** One-time setup after `ready` (application id, Dock menu, …). */
  onReady(app: App): void;
}
