/**
 * macOS adapter.
 *
 * - Recovery surface: a menu-bar item (template image) with the same menu as
 *   the Windows tray. In Presenter Mode RealtimeDocs runs with the `accessory`
 *   activation policy (no Dock icon) whenever that item exists; otherwise, and
 *   in normal-window mode, it is a regular app and clicking its Dock icon
 *   shows the panel.
 * - A native application menu, so Undo/Redo/Cut/Copy/Paste/Select All work
 *   with their Command shortcuts through the standard roles.
 * - Spaces and fullscreen visibility are user-controlled through
 *   `setVisibleOnAllWorkspaces`. Electron documents that this call can switch
 *   the process between a regular and a UI-element application, which hides
 *   the window and Dock icon briefly (and the Dock icon while fullscreen
 *   visibility is on); the menu-bar item and global shortcuts keep working.
 * - Deep links arrive through the `open-url` event; the URL scheme must be in
 *   the bundle's Info.plist, which the packaging script writes.
 */
import path from 'node:path';
import { nativeImage, type App } from 'electron';
import { DESKTOP_PROTOCOL } from '@realtimedocs/contracts';
import { buildMacAppMenuModel } from '../menu-model';
import { buildMenu } from './menu-builder';
import type { PlatformAdapter } from './types';

export const darwinAdapter: PlatformAdapter = {
  id: 'darwin',
  hasDock: true,
  reassertsPin: false,
  supportsMouseForwarding: true,
  trayClickShowsPanel: false,

  panelWindowOptions({ mode }) {
    // The presenter panel stays out of Mission Control; the ordinary window does not.
    return { hiddenInMissionControl: mode === 'presenter' };
  },

  applyPresence(app, _window, presence) {
    // `accessory`: no Dock icon and no visible menu bar. The application menu
    // stays set, so its Edit commands keep their Command shortcuts.
    app.setActivationPolicy(presence.activationPolicy ?? 'regular');
  },

  applyMissionControl(window, hidden) {
    window.setHiddenInMissionControl(hidden);
  },

  applyPin(window, pinned, level) {
    if (pinned) window.setAlwaysOnTop(true, level);
    else window.setAlwaysOnTop(false);
  },

  applyWorkspaceVisibility(window, visibility, accessory) {
    window.setVisibleOnAllWorkspaces(visibility.allWorkspaces, {
      visibleOnFullScreen: visibility.allWorkspaces && visibility.fullScreen,
      // Without a Dock icon the process type must not be switched back and forth.
      skipTransformProcessType: accessory,
    });
  },

  trayImage(assetsDirectory, active) {
    // Template images (black + alpha, file name ending in "Template") adapt to
    // light and dark menu bars; the @2x file next to it is picked up for Retina.
    const image = nativeImage.createFromPath(
      path.join(assetsDirectory, active ? 'trayActiveTemplate.png' : 'trayTemplate.png'),
    );
    image.setTemplateImage(true);
    return image;
  },

  windowIconPath() {
    // macOS windows take their icon from the application bundle.
    return undefined;
  },

  buildApplicationMenu(state, run) {
    return buildMenu(buildMacAppMenuModel(state), { run, registerAccelerators: true });
  },

  registerProtocolClient(app: App) {
    // Effective only for a packaged bundle whose Info.plist declares the scheme.
    return app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL);
  },

  onReady() {
    // Nothing: the Dock icon and its default menu are the system's.
  },
};
