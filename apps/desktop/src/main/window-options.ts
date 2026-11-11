/**
 * `BrowserWindow` options for the three app windows, built as plain data so
 * the unit tests can assert the security-relevant flags without Electron.
 * Only type imports from `electron` here.
 */
import type { BrowserWindowConstructorOptions, Session, WebPreferences } from 'electron';
import { PANEL, type Rect } from '../shared/geometry';
import type { DesktopPlatform } from '../shared/shortcuts';

export interface WindowOptionInput {
  preloadPath: string;
  session: Session | undefined;
  packaged: boolean;
  platform: DesktopPlatform;
  iconPath?: string | undefined;
}

/**
 * Renderer hardening shared by every window (Electron security checklist):
 * context isolation, OS sandbox, no Node.js in pages/workers/sub-frames, web
 * security on, no `<webview>`, no drag-and-drop navigation.
 */
export function secureWebPreferences(input: WindowOptionInput): WebPreferences {
  return {
    preload: input.preloadPath,
    ...(input.session ? { session: input.session } : {}),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    plugins: false,
    enableWebSQL: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    autoplayPolicy: 'user-gesture-required',
    // Developer tools are a development aid only; packaged builds cannot open them.
    devTools: !input.packaged,
    spellcheck: true,
  };
}

/**
 * The floating panel: frameless, genuinely transparent, created hidden and
 * non-resizable. Transparency of the surface is CSS alpha in the page; the
 * window never uses whole-window opacity. Resizing is done by the app's own
 * grips through a clamped `setBounds`, because Electron documents that
 * transparent windows are not resizable.
 */
export function panelWindowOptions(
  input: WindowOptionInput & { bounds: Rect },
): BrowserWindowConstructorOptions {
  return {
    x: input.bounds.x,
    y: input.bounds.y,
    width: input.bounds.width,
    height: input.bounds.height,
    title: 'RealtimeDocs',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: false,
    // macOS: the first click on the inactive panel should reach its controls.
    acceptFirstMouse: true,
    ...(input.iconPath ? { icon: input.iconPath } : {}),
    webPreferences: secureWebPreferences(input),
  };
}

/**
 * The document as an ordinary window (normal mode): framed, opaque,
 * resizable by the operating system, in the taskbar and the Dock, never on
 * top and never click-through. It loads the same panel page under the same
 * restrictions (it shows the same foreign content). Created hidden, like
 * every window, so capture exclusion can be requested before the first show.
 */
export function documentWindowOptions(
  input: WindowOptionInput & { bounds: Rect },
): BrowserWindowConstructorOptions {
  return {
    x: input.bounds.x,
    y: input.bounds.y,
    width: input.bounds.width,
    height: input.bounds.height,
    minWidth: PANEL.minWidth,
    minHeight: PANEL.minHeight,
    title: 'RealtimeDocs',
    show: false,
    frame: true,
    transparent: false,
    backgroundColor: '#14161a',
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    ...(input.iconPath ? { icon: input.iconPath } : {}),
    webPreferences: secureWebPreferences(input),
  };
}

/** Ordinary opaque window for configuration and diagnostics. */
export function settingsWindowOptions(input: WindowOptionInput): BrowserWindowConstructorOptions {
  return {
    width: 860,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    title: 'RealtimeDocs Settings',
    show: false,
    frame: true,
    transparent: false,
    backgroundColor: '#14161a',
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    ...(input.iconPath ? { icon: input.iconPath } : {}),
    webPreferences: secureWebPreferences(input),
  };
}

/**
 * Diagnostics-only probe: a small transparent, frameless window that IS
 * natively resizable, so the user can see how their operating system handles
 * it and record the result. The panel itself never relies on this.
 */
export function probeWindowOptions(input: WindowOptionInput): BrowserWindowConstructorOptions {
  return {
    width: 420,
    height: 300,
    minWidth: 260,
    minHeight: 200,
    title: 'RealtimeDocs resize probe',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(input.iconPath ? { icon: input.iconPath } : {}),
    webPreferences: secureWebPreferences(input),
  };
}

export const PANEL_INITIAL_SIZE = {
  width: PANEL.defaultWidth,
  height: PANEL.defaultHeight,
} as const;
