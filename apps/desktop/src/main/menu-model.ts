/**
 * Menu contents as plain data: the tray (Windows) / menu-bar (macOS) menu,
 * which is the recovery surface on both platforms, and the macOS application
 * menu. `platform/menu-builder.ts` turns these into Electron menus and
 * attaches the click handlers; the unit tests check entries, order, enabled
 * state and wording.
 */
import { captureTrayLines } from '../shared/capture';
import { SIZE_PRESET_NAMES, type SizePreset } from '../shared/geometry';
import { RETURN_TO_INTERACTIVE_LABEL } from '../shared/privacy/status';
import type { ShortcutAction } from '../shared/shortcuts';
import { NEUTRAL_TITLE } from '../shared/surfaces';
import type { AppState } from '../shared/state';

export type MenuActionId =
  | 'show-panel'
  | 'hide-panel'
  | 'toggle-visibility'
  | 'return-to-interactive'
  | 'click-through-mode'
  | 'reconnect'
  | 'open-privacy-test-center'
  | 'open-settings'
  | 'open-share-guide'
  | 'toggle-pin'
  | 'toggle-collapse'
  | 'toggle-capture'
  | 'reset-position'
  | 'presenter-mode'
  | 'normal-window'
  | 'close-window'
  | 'quit'
  | `preset:${SizePreset}`;

/** Roles handled natively by Electron/macOS (editing, app lifecycle). */
export type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll'
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'front'
  | 'startSpeaking'
  | 'stopSpeaking';

export interface MenuEntry {
  type: 'item' | 'checkbox' | 'radio' | 'separator' | 'info' | 'submenu';
  label?: string;
  action?: MenuActionId;
  role?: MenuRole;
  enabled?: boolean;
  checked?: boolean;
  /** Displayed next to the item. On macOS application menus it is also the key equivalent. */
  accelerator?: string;
  submenu?: MenuEntry[];
}

const SEPARATOR: MenuEntry = { type: 'separator' };

function shortcutFor(state: AppState, action: ShortcutAction): string | undefined {
  const item = state.shortcuts.items.find((entry) => entry.action === action);
  return item?.registered ? item.accelerator : undefined;
}

function withAccelerator(entry: MenuEntry, accelerator: string | undefined): MenuEntry {
  return accelerator ? { ...entry, accelerator } : entry;
}

const PRESET_LABELS: Record<SizePreset, string> = {
  compact: 'Compact (480 × 300)',
  standard: 'Standard (720 × 460)',
  wide: 'Wide (960 × 460)',
  tall: 'Tall (560 × 720)',
  large: 'Large (1040 × 680)',
};

export function presetEntries(): MenuEntry[] {
  return SIZE_PRESET_NAMES.map((preset) => ({
    type: 'item',
    label: PRESET_LABELS[preset],
    action: `preset:${preset}`,
  }));
}

/**
 * The open document as the operating system's own surfaces may name it.
 * With private mode on that is never the title: a tooltip or a menu is drawn
 * by the operating system, outside every window, and is not covered by the
 * capture-exclusion request.
 */
export function documentLine(state: AppState): string {
  const session = state.connection.session;
  if (!session) return 'No document open';
  if (state.capture.requested) return 'Document open';
  const title = (state.connection.report?.title ?? session.title).trim() || 'Untitled document';
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

/** Item labels of the tray / menu-bar menu, in this order and no others (owner's specification). */
export const TRAY_ITEM_LABELS = [
  'Show',
  'Hide',
  RETURN_TO_INTERACTIVE_LABEL,
  'Click-through Mode',
  'Reconnect',
  'Privacy Test Center',
  'Settings',
  'Quit',
] as const;

/**
 * Tray (Windows) / menu-bar (macOS) menu. "Return to interactive mode" is the
 * emergency item: always enabled, it leaves click-through, un-parks,
 * un-collapses, shows, raises and moves the panel fully on screen.
 */
export function buildTrayMenuModel(state: AppState): MenuEntry[] {
  const { panel } = state;
  const presenter = panel.mode === 'presenter';
  return [
    withAccelerator(
      { type: 'item', label: 'Show', action: 'show-panel' },
      shortcutFor(state, 'toggleVisibility'),
    ),
    {
      type: 'item',
      label: 'Hide',
      action: 'hide-panel',
      enabled: panel.visible && panel.canHide,
    },
    SEPARATOR,
    withAccelerator(
      {
        type: 'radio',
        label: RETURN_TO_INTERACTIVE_LABEL,
        action: 'return-to-interactive',
        checked: !panel.clickThrough,
        enabled: true,
      },
      shortcutFor(state, 'returnToInteractive'),
    ),
    {
      type: 'radio',
      label: 'Click-through Mode',
      action: 'click-through-mode',
      checked: panel.clickThrough,
      enabled: panel.clickThrough || (presenter && panel.canEnterClickThrough),
    },
    SEPARATOR,
    {
      type: 'item',
      label: 'Reconnect',
      action: 'reconnect',
      enabled: state.connection.session !== null,
    },
    SEPARATOR,
    { type: 'item', label: 'Privacy Test Center', action: 'open-privacy-test-center' },
    { type: 'item', label: 'Settings', action: 'open-settings' },
    SEPARATOR,
    { type: 'item', label: 'Quit', action: 'quit' },
  ];
}

/**
 * Tray tooltip: the app name, where the panel is, and the private-mode status
 * in the same words as the panel chip and Settings. With private mode on it
 * never names the document (it is drawn by the operating system).
 */
export function trayTooltip(state: AppState): string {
  const parts: string[] = [NEUTRAL_TITLE];
  if (!state.capture.requested && state.connection.session) parts.push(documentLine(state));
  if (state.panel.parked) parts.push('panel hidden: notes display disconnected');
  else if (state.panel.clickThrough) parts.push('click-through is on');
  else if (!state.panel.visible) parts.push('panel hidden');
  parts.push(captureTrayLines(state.capture.status).join(' · '));
  return parts.join(' — ');
}

/**
 * macOS application menu. The Edit menu uses native roles so Undo, Redo, Cut,
 * Copy, Paste and Select All work with their Command shortcuts in the panel
 * and the settings window — also in Presenter Mode, where the app has no Dock
 * icon and its menu bar is not shown. Closing a window (Command+W) hides it;
 * quitting is a separate, explicit command (Command+Q).
 */
export function buildMacAppMenuModel(state: AppState): MenuEntry[] {
  const { panel } = state;
  const presenter = panel.mode === 'presenter';
  return [
    {
      type: 'submenu',
      label: 'RealtimeDocs',
      submenu: [
        { type: 'item', role: 'about', label: 'About RealtimeDocs' },
        SEPARATOR,
        { type: 'item', label: 'Settings…', action: 'open-settings', accelerator: 'Command+,' },
        SEPARATOR,
        { type: 'item', role: 'services', label: 'Services' },
        SEPARATOR,
        { type: 'item', role: 'hide', label: 'Hide RealtimeDocs' },
        { type: 'item', role: 'hideOthers', label: 'Hide Others' },
        { type: 'item', role: 'unhide', label: 'Show All' },
        SEPARATOR,
        { type: 'item', label: 'Quit RealtimeDocs', action: 'quit', accelerator: 'Command+Q' },
      ],
    },
    {
      type: 'submenu',
      label: 'Edit',
      submenu: [
        { type: 'item', role: 'undo', label: 'Undo' },
        { type: 'item', role: 'redo', label: 'Redo' },
        SEPARATOR,
        { type: 'item', role: 'cut', label: 'Cut' },
        { type: 'item', role: 'copy', label: 'Copy' },
        { type: 'item', role: 'paste', label: 'Paste' },
        { type: 'item', role: 'pasteAndMatchStyle', label: 'Paste and Match Style' },
        { type: 'item', role: 'delete', label: 'Delete' },
        { type: 'item', role: 'selectAll', label: 'Select All' },
        SEPARATOR,
        {
          type: 'submenu',
          label: 'Speech',
          submenu: [
            { type: 'item', role: 'startSpeaking', label: 'Start Speaking' },
            { type: 'item', role: 'stopSpeaking', label: 'Stop Speaking' },
          ],
        },
      ],
    },
    {
      type: 'submenu',
      label: 'Panel',
      submenu: [
        withAccelerator(
          {
            type: 'item',
            label: panel.visible ? 'Hide Panel' : 'Show Panel',
            action: 'toggle-visibility',
            enabled: panel.visible ? panel.canHide : true,
          },
          shortcutFor(state, 'toggleVisibility'),
        ),
        withAccelerator(
          { type: 'item', label: RETURN_TO_INTERACTIVE_LABEL, action: 'return-to-interactive' },
          shortcutFor(state, 'returnToInteractive'),
        ),
        {
          type: 'checkbox',
          label: 'Click-Through Mode',
          action: 'click-through-mode',
          checked: panel.clickThrough,
          enabled: panel.clickThrough || (presenter && panel.canEnterClickThrough),
        },
        {
          type: 'checkbox',
          label: 'Pin on Top',
          action: 'toggle-pin',
          checked: panel.pinned,
          enabled: presenter,
        },
        SEPARATOR,
        {
          type: 'item',
          label: panel.collapsed ? 'Expand' : 'Collapse to Title Strip',
          action: 'toggle-collapse',
          enabled: presenter,
        },
        { type: 'submenu', label: 'Size', submenu: presetEntries() },
        { type: 'item', label: 'Reset Position', action: 'reset-position' },
        SEPARATOR,
        presenter
          ? { type: 'item', label: 'Open in a Normal Window', action: 'normal-window' }
          : { type: 'item', label: 'Switch to Private Presenter Mode', action: 'presenter-mode' },
        SEPARATOR,
        {
          type: 'checkbox',
          label: 'Private Mode (Request Capture Exclusion)',
          action: 'toggle-capture',
          checked: state.capture.requested,
        },
        ...captureTrayLines(state.capture.status).map((line): MenuEntry => ({
          type: 'info',
          label: line,
        })),
        { type: 'item', label: 'Safe Share Guide…', action: 'open-share-guide' },
        { type: 'item', label: 'Privacy Test Center…', action: 'open-privacy-test-center' },
      ],
    },
    {
      type: 'submenu',
      label: 'Window',
      submenu: [
        { type: 'item', label: 'Close Window', action: 'close-window', accelerator: 'Command+W' },
        SEPARATOR,
        { type: 'item', role: 'front', label: 'Bring All to Front' },
      ],
    },
  ];
}
