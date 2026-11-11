/**
 * Taskbar and Dock omission: whether RealtimeDocs shows up where the
 * operating system lists running applications.
 *
 * - Windows: the panel has no taskbar button (`skipTaskbar`).
 * - macOS: the app runs with the `accessory` activation policy, so there is no
 *   Dock icon (and no visible application menu; its Edit commands stay set so
 *   Command+C, V, Z and A keep working).
 *
 * On by default. "Show in taskbar / Dock" in Settings opts back in.
 *
 * This is about where the application is listed, nothing else. It does not
 * change what a screen share or a recording contains; that is private mode
 * (`capture.ts`), a separate setting with its own status.
 *
 * The rule that matters is recovery: omission is in effect only while
 * something other than the taskbar or the Dock can bring the panel back. On
 * macOS that is the menu-bar item (without the Dock it is the only way to
 * Settings and Quit); on Windows the tray icon or the global show/hide
 * shortcut. If that is lost, the app goes back into the taskbar / Dock by
 * itself and says so.
 *
 * Pure: no Electron imports. Linux is a development platform only and has no
 * supported way to do this, so omission is never in effect there.
 */
import type { DesktopPlatform } from './shortcuts';

export interface PresenceInput {
  platform: DesktopPlatform;
  /** The user's preference "Show in taskbar / Dock". */
  showInTaskbar: boolean;
  /** The tray icon (Windows) / menu-bar item (macOS) exists. */
  trayAvailable: boolean;
  /** The global show/hide shortcut is registered. */
  shortcutAvailable: boolean;
}

export type PresenceBlock = 'no_recovery_path' | 'unsupported_platform';

export interface PresenceState {
  /** The user's preference "Show in taskbar / Dock". */
  showInTaskbar: boolean;
  /** True while the app really is left out of the taskbar / Dock. */
  omitted: boolean;
  /** False where the platform has no supported way to do this (Linux). */
  supported: boolean;
  /** Why omission is not in effect although it was not opted out of. */
  blocked: PresenceBlock | null;
  /** macOS: the activation policy to apply. Null elsewhere. */
  activationPolicy: 'regular' | 'accessory' | null;
  /** Name of the setting on this platform. */
  title: string;
  /** One line: what is the case right now. */
  label: string;
  /** What that means and how to get back to the panel. */
  detail: string;
}

/** The sentence that keeps this setting apart from private mode. Shown wherever the setting is. */
export const PRESENCE_SCOPE_NOTE =
  'This only changes where RealtimeDocs is listed on your own computer. It does not change what a screen share or a recording contains. For that, see private mode on the Privacy tab.';

export function presenceTitle(platform: DesktopPlatform): string {
  if (platform === 'darwin') return 'Show in the Dock';
  if (platform === 'win32') return 'Show in the taskbar';
  return 'Show in taskbar / Dock';
}

/**
 * Whether there is a way back to the panel that needs neither the taskbar nor
 * the Dock.
 *
 * - macOS: the menu-bar item. Without a Dock icon macOS shows no application
 *   menu either, so the menu-bar item is the one place from which Settings,
 *   "Show panel" and "Quit" can still be reached. A shortcut alone is not
 *   enough.
 * - Windows: the tray icon or the show/hide shortcut.
 */
export function hasPresenceRecovery(
  input: Pick<PresenceInput, 'platform' | 'trayAvailable' | 'shortcutAvailable'>,
): boolean {
  if (input.platform === 'darwin') return input.trayAvailable;
  return input.trayAvailable || input.shortcutAvailable;
}

export function computePresence(input: PresenceInput): PresenceState {
  const title = presenceTitle(input.platform);
  const supported = input.platform === 'win32' || input.platform === 'darwin';
  const mac = input.platform === 'darwin';

  if (!supported) {
    return {
      showInTaskbar: input.showInTaskbar,
      omitted: false,
      supported: false,
      blocked: input.showInTaskbar ? null : 'unsupported_platform',
      activationPolicy: null,
      title,
      label: 'Not available on Linux',
      detail:
        'Electron documents this for Windows and macOS only. On Linux RealtimeDocs stays where the desktop lists it.',
    };
  }

  if (input.showInTaskbar) {
    return {
      showInTaskbar: true,
      omitted: false,
      supported: true,
      blocked: null,
      activationPolicy: mac ? 'regular' : null,
      title,
      label: mac ? 'RealtimeDocs is in the Dock' : 'The panel is in the taskbar',
      detail: mac
        ? 'RealtimeDocs has a Dock icon and an application menu, like any other application.'
        : 'The panel has a taskbar button, like any other window.',
    };
  }

  if (!hasPresenceRecovery(input)) {
    return {
      showInTaskbar: false,
      omitted: false,
      supported: true,
      blocked: 'no_recovery_path',
      activationPolicy: mac ? 'regular' : null,
      title,
      label: mac
        ? 'In the Dock: the menu-bar item is unavailable'
        : 'In the taskbar: no tray icon and no show/hide shortcut',
      detail: mac
        ? 'Without the Dock icon, the menu-bar item is the only way to reach the panel, Settings and Quit. It could not be created, so RealtimeDocs stays in the Dock.'
        : 'Without a taskbar button, the tray icon or the show/hide shortcut must be there to bring the panel back. Neither is available, so the panel stays in the taskbar.',
    };
  }

  const ways = mac
    ? input.shortcutAvailable
      ? 'the menu-bar item or the show/hide shortcut'
      : 'the menu-bar item'
    : input.trayAvailable && input.shortcutAvailable
      ? 'the tray icon or the show/hide shortcut'
      : input.trayAvailable
        ? 'the tray icon'
        : 'the show/hide shortcut';
  return {
    showInTaskbar: false,
    omitted: true,
    supported: true,
    blocked: null,
    activationPolicy: mac ? 'accessory' : null,
    title,
    label: mac ? 'Not in the Dock' : 'Not in the taskbar',
    detail: mac
      ? `RealtimeDocs has no Dock icon and no visible application menu. Use ${ways} to show the panel, open Settings or quit.`
      : `The panel has no taskbar button. Use ${ways} to bring it back. The Settings window, while it is open, has its own taskbar button.`,
  };
}
