/**
 * Linux adapter. Linux is not a product platform: this exists so the app can
 * be developed and smoke-tested under Xvfb on the build server.
 *
 * - Capture exclusion is unavailable (no supported OS request).
 * - Mouse-event forwarding is documented for macOS and Windows only, so the
 *   in-panel "hover to return" recovery is not offered here.
 * - The protocol handler is registered only on request, because doing so
 *   edits the user's desktop configuration.
 */
import path from 'node:path';
import { nativeImage, type App } from 'electron';
import { DESKTOP_PROTOCOL } from '@realtimedocs/contracts';
import type { PlatformAdapter } from './types';

export const linuxAdapter: PlatformAdapter = {
  id: 'linux',
  hasDock: false,
  reassertsPin: false,
  supportsMouseForwarding: false,
  trayClickShowsPanel: true,

  panelWindowOptions() {
    return {};
  },

  applyPresence() {
    // No supported way on Linux (development platform only).
  },

  applyMissionControl() {
    // macOS only.
  },

  applyPin(window, pinned, level) {
    if (pinned) window.setAlwaysOnTop(true, level);
    else window.setAlwaysOnTop(false);
  },

  applyWorkspaceVisibility(window, visibility) {
    window.setVisibleOnAllWorkspaces(visibility.allWorkspaces);
  },

  trayImage(assetsDirectory, active) {
    return nativeImage.createFromPath(
      path.join(assetsDirectory, active ? 'tray-active.png' : 'tray.png'),
    );
  },

  windowIconPath(assetsDirectory) {
    return path.join(assetsDirectory, 'icon.png');
  },

  buildApplicationMenu() {
    return null;
  },

  registerProtocolClient(app: App) {
    if (process.env.RD_DESKTOP_REGISTER_PROTOCOL !== '1') return false;
    if (process.defaultApp) {
      const script = process.argv[1];
      if (!script) return false;
      return app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL, process.execPath, [
        path.resolve(script),
      ]);
    }
    return app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL);
  },

  onReady() {
    // Nothing.
  },
};
