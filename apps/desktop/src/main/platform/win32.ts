/**
 * Windows adapter.
 *
 * - Recovery surface: notification-area (tray) icon; a left click shows the
 *   panel and returns it to interactive mode.
 * - No menu bar; Chromium's standard Ctrl shortcuts handle editing.
 * - `setVisibleOnAllWorkspaces` is documented as a no-op on Windows, so there
 *   is nothing to apply for virtual desktops.
 * - Deep links arrive as a command-line argument. The handler is registered
 *   with a `--` separator before the URL so nothing in a link can be parsed
 *   as a command-line switch.
 */
import path from 'node:path';
import { nativeImage, type App } from 'electron';
import { DESKTOP_PROTOCOL } from '@realtimedocs/contracts';
import type { PlatformAdapter } from './types';

export const APP_USER_MODEL_ID = 'com.realtimedocs.desktop';

export const win32Adapter: PlatformAdapter = {
  id: 'win32',
  hasDock: false,
  reassertsPin: true,
  supportsMouseForwarding: true,
  trayClickShowsPanel: true,

  panelWindowOptions({ mode, omitted }) {
    // Presenter Mode leaves the panel out of the taskbar (only while the tray
    // icon or a shortcut can bring it back; see shared/presence.ts). The
    // ordinary window always has its taskbar button.
    return { skipTaskbar: mode === 'presenter' && omitted };
  },

  applyPresence(_app, window, presence) {
    if (window && !window.isDestroyed()) window.setSkipTaskbar(presence.omitted);
  },

  applyMissionControl() {
    // macOS only.
  },

  applyPin(window, pinned, level) {
    if (pinned) {
      window.setAlwaysOnTop(true, level);
      // Among topmost windows the most recently raised one wins: a full-screen browser or
      // meeting window that became topmost after the panel would otherwise cover it.
      // `moveTop` changes the stacking order only; it does not activate the window.
      if (window.isVisible()) window.moveTop();
    } else {
      window.setAlwaysOnTop(false);
    }
  },

  applyWorkspaceVisibility() {
    // Not available on Windows (Electron: "This API does nothing on Windows").
  },

  trayImage(assetsDirectory, active) {
    return nativeImage.createFromPath(
      path.join(assetsDirectory, active ? 'tray-active.ico' : 'tray.ico'),
    );
  },

  windowIconPath(assetsDirectory) {
    return path.join(assetsDirectory, 'icon.ico');
  },

  buildApplicationMenu() {
    return null;
  },

  registerProtocolClient(app: App) {
    if (process.defaultApp) {
      const script = process.argv[1];
      if (!script) return false;
      return app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL, process.execPath, [
        path.resolve(script),
        '--',
      ]);
    }
    return app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL, process.execPath, ['--']);
  },

  onReady(app: App) {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  },
};
