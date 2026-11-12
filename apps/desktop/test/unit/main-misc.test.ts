import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger, redactFields } from '../../src/main/logger';
import {
  TRAY_ITEM_LABELS,
  buildMacAppMenuModel,
  buildTrayMenuModel,
  documentLine,
  trayTooltip,
  type MenuEntry,
} from '../../src/main/menu-model';
import {
  KEYBOARD_RESIZE_STEP,
  matchWindowCommand,
  windowCommandHints,
} from '../../src/shared/window-commands';
import {
  panelWindowOptions,
  probeWindowOptions,
  secureWebPreferences,
  settingsWindowOptions,
} from '../../src/main/window-options';
import {
  accessChip,
  connectionChip,
  connectionStateName,
  documentTitle,
  endedAccess,
  saveLabel,
  saveStateName,
} from '../../src/renderer/shared/labels';
import { BRIDGE_KEYS } from '../../src/shared/bridge';
import { computeCaptureStatus } from '../../src/shared/capture';
import { CH } from '../../src/shared/channels';
import { defaultPreferences } from '../../src/shared/preferences';
import { computePresence } from '../../src/shared/presence';
import {
  MACOS_WHOLE_DISPLAY_WARNING,
  OBSERVED_OUTCOME_LABELS,
  PROTECTION_STATUS_LABELS,
  RETURN_TO_INTERACTIVE_LABEL,
  SAFE_SHARE_GUIDE_STEPS,
} from '../../src/shared/privacy/status';
import { defaultShortcuts, type DesktopPlatform } from '../../src/shared/shortcuts';
import { panelView, type AppState } from '../../src/shared/state';
import { initialUpdateSnapshot } from '../../src/shared/updates';
import { RateLimiter } from '../../src/main/rate-limit';

function state(platform: DesktopPlatform = 'win32', overrides: Partial<AppState> = {}): AppState {
  const preferences = defaultPreferences(platform);
  const shortcuts = defaultShortcuts(platform);
  const base: AppState = {
    revision: 1,
    app: {
      name: 'RealtimeDocs',
      version: '0.1.0',
      platform,
      arch: 'x64',
      systemVersion: platform === 'win32' ? '10.0.22631' : '15.1',
      electronVersion: '45.2.3',
      chromeVersion: '156.0.0.0',
      packaged: true,
    },
    appearance: preferences.appearance,
    behaviour: preferences.behaviour,
    panel: {
      mode: 'presenter',
      visible: true,
      focused: false,
      collapsed: false,
      pinned: true,
      pinLevel: 'floating',
      clickThrough: false,
      canEnterClickThrough: true,
      clickThroughBlockedReason: null,
      recoveryPaths: { shortcut: true, tray: true, hoverBadge: true },
      canHide: true,
      bounds: { x: 100, y: 100, width: 720, height: 460 },
      displayId: 1,
      visibleOnAllWorkspaces: false,
      visibleOnFullScreen: false,
      lastRecovery: null,
      parked: null,
    },
    connection: {
      server: {
        origin: null,
        transport: null,
        status: 'unset',
        message: null,
        serverVersion: null,
        publicOrigin: null,
        checkedAt: null,
      },
      session: null,
      report: null,
      busy: null,
      notice: null,
      allowInsecureLan: false,
      acceptedLinkOrigin: null,
    },
    credentials: { mode: 'os_encrypted', backend: null, detail: '' },
    shortcuts: {
      recording: false,
      items: (['toggleVisibility', 'returnToInteractive'] as const).map((action) => ({
        action,
        accelerator: shortcuts[action],
        keyCaps: shortcuts[action].split('+'),
        registered: true,
        error: null,
        isDefault: true,
      })),
    },
    tray: { available: true, error: null },
    capture: {
      requested: preferences.capture.enabled,
      apiAvailable: platform !== 'linux',
      results: [],
      status: computeCaptureStatus({
        mode: 'desktop',
        platform,
        systemVersion: platform === 'win32' ? '10.0.22631' : '15.1',
        requested: preferences.capture.enabled,
        results: [],
      }),
      native: null,
    },
    presence: computePresence({
      platform,
      showInTaskbar: false,
      trayAvailable: true,
      shortcutAvailable: true,
    }),
    guide: { open: false, seen: true },
    displays: [],
    settings: { open: false, tab: 'connection' },
    probe: { open: false, record: null },
    preferencesRepaired: false,
    updates: initialUpdateSnapshot('0.1.0'),
  };
  return { ...base, ...overrides };
}

/** A state with a document open; private mode as given (on by default, as in fresh preferences). */
function withDocument(options: { requested?: boolean } = {}): AppState {
  const base = state();
  const requested = options.requested ?? true;
  return state('win32', {
    connection: {
      ...base.connection,
      server: { ...base.connection.server, origin: 'https://docs.example.com' },
      session: {
        documentId: '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d',
        title: `Quarterly ${'numbers '.repeat(20)}`,
        role: 'viewer',
        expiresAt: null,
        accountId: null,
        via: 'share_link',
        restored: false,
        sequence: 1,
      },
    },
    capture: {
      ...base.capture,
      requested,
      status: computeCaptureStatus({
        mode: 'desktop',
        platform: 'win32',
        systemVersion: '10.0.22631',
        requested,
        results: [],
      }),
    },
  });
}

function flatten(entries: MenuEntry[]): MenuEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.submenu ?? [])]);
}

const find = (entries: MenuEntry[], action: string) =>
  flatten(entries).find((entry) => entry.action === action);

describe('tray / menu-bar recovery menu', () => {
  const items = (menu: MenuEntry[]) => menu.filter((entry) => entry.type !== 'separator');

  it('has exactly the owner’s items, in this order, and nothing else', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const menu = buildTrayMenuModel(state(platform));
      expect(items(menu).map((entry) => entry.label)).toEqual([...TRAY_ITEM_LABELS]);
      expect(TRAY_ITEM_LABELS).toEqual([
        'Show',
        'Hide',
        RETURN_TO_INTERACTIVE_LABEL,
        'Click-through Mode',
        'Reconnect',
        'Privacy Test Center',
        'Settings',
        'Quit',
      ]);
      expect(items(menu).map((entry) => entry.action)).toEqual([
        'show-panel',
        'hide-panel',
        'return-to-interactive',
        'click-through-mode',
        'reconnect',
        'open-privacy-test-center',
        'open-settings',
        'quit',
      ]);
      // No informational line can carry the document title into a native menu.
      expect(menu.some((entry) => entry.type === 'info')).toBe(false);
    }
  });

  it('keeps the emergency item enabled in every state, labelled with the contract string', () => {
    const base = state();
    for (const panel of [
      base.panel,
      { ...base.panel, clickThrough: true },
      { ...base.panel, visible: false, canHide: false },
      { ...base.panel, parked: 'display_removed' as const, visible: false },
      { ...base.panel, collapsed: true },
      {
        ...base.panel,
        canEnterClickThrough: false,
        recoveryPaths: { shortcut: false, tray: false, hoverBadge: false },
      },
    ]) {
      const entry = find(buildTrayMenuModel(state('win32', { panel })), 'return-to-interactive');
      expect(entry).toMatchObject({ label: RETURN_TO_INTERACTIVE_LABEL, enabled: true });
    }
  });

  it('marks the current mode and refuses click-through without a way back, never the way out', () => {
    const base = state();
    const menu = buildTrayMenuModel(base);
    expect(find(menu, 'return-to-interactive')).toMatchObject({ type: 'radio', checked: true });
    expect(find(menu, 'click-through-mode')).toMatchObject({
      type: 'radio',
      checked: false,
      enabled: true,
    });
    const active = state('win32', { panel: { ...base.panel, clickThrough: true } });
    expect(find(buildTrayMenuModel(active), 'click-through-mode')?.checked).toBe(true);
    expect(trayTooltip(active)).toContain('click-through is on');
    const stuck = state('win32', {
      panel: {
        ...base.panel,
        canEnterClickThrough: false,
        recoveryPaths: { shortcut: false, tray: false, hoverBadge: true },
      },
    });
    expect(find(buildTrayMenuModel(stuck), 'click-through-mode')?.enabled).toBe(false);
    // The ordinary window has no click-through at all.
    const normal = state('win32', { panel: { ...base.panel, mode: 'normal' } });
    expect(find(buildTrayMenuModel(normal), 'click-through-mode')?.enabled).toBe(false);
  });

  it('offers Hide only when hiding leaves a way back, and Reconnect only with a document', () => {
    const base = state();
    expect(find(buildTrayMenuModel(base), 'hide-panel')?.enabled).toBe(true);
    const cannotHide = state('win32', { panel: { ...base.panel, canHide: false } });
    expect(find(buildTrayMenuModel(cannotHide), 'hide-panel')?.enabled).toBe(false);
    const hidden = state('win32', { panel: { ...base.panel, visible: false } });
    expect(find(buildTrayMenuModel(hidden), 'hide-panel')?.enabled).toBe(false);
    expect(find(buildTrayMenuModel(hidden), 'show-panel')?.enabled ?? true).toBe(true);
    expect(find(buildTrayMenuModel(base), 'reconnect')?.enabled).toBe(false);
    expect(find(buildTrayMenuModel(withDocument()), 'reconnect')?.enabled).toBe(true);
  });

  it('shows each registered shortcut next to its item, and none that failed', () => {
    const base = state();
    expect(find(buildTrayMenuModel(base), 'show-panel')?.accelerator).toBe('Control+Alt+Shift+D');
    expect(find(buildTrayMenuModel(base), 'return-to-interactive')?.accelerator).toBe(
      'Control+Alt+Shift+T',
    );
    const failed = state('win32', {
      shortcuts: {
        recording: false,
        items: base.shortcuts.items.map((item) =>
          item.action === 'returnToInteractive'
            ? { ...item, registered: false, error: 'in_use' as const }
            : item,
        ),
      },
    });
    expect(find(buildTrayMenuModel(failed), 'return-to-interactive')?.accelerator).toBeUndefined();
    expect(find(buildTrayMenuModel(failed), 'show-panel')?.accelerator).toBe('Control+Alt+Shift+D');
  });

  it('never names the document in the tooltip or menus while private mode is on', () => {
    const open = withDocument();
    expect(open.capture.requested).toBe(true);
    expect(documentLine(open)).toBe('Document open');
    const tooltip = trayTooltip(open);
    expect(tooltip.startsWith('RealtimeDocs')).toBe(true);
    expect(tooltip).not.toContain('Quarterly');
    for (const entry of flatten([
      ...buildTrayMenuModel(open),
      ...buildMacAppMenuModel({ ...open, app: { ...open.app, platform: 'darwin' } }),
    ])) {
      expect(entry.label ?? '').not.toContain('Quarterly');
    }
    // With private mode off the title may appear, bounded.
    const off = withDocument({ requested: false });
    expect(documentLine(off).length).toBeLessThanOrEqual(60);
    expect(trayTooltip(off)).toContain('Quarterly');
  });

  it('says in the tooltip what the chip and Settings say', () => {
    const open = withDocument();
    expect(trayTooltip(open)).toContain(open.capture.status.label);
    const parked = state('win32', {
      panel: { ...state().panel, parked: 'display_removed', visible: false },
    });
    expect(trayTooltip(parked)).toContain('notes display disconnected');
  });
});

describe('panel header: connection, saving and access are separate facts', () => {
  const session = {
    documentId: '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d',
    title: 'Launch notes',
    role: 'editor' as const,
    expiresAt: null,
    accountId: null,
    via: 'share_link' as const,
    restored: false,
    sequence: 4,
  };
  const withConnection = (connection: Partial<AppState['connection']>) => {
    const base = state();
    return state('win32', { connection: { ...base.connection, ...connection } });
  };
  const server = { ...state().connection.server, origin: 'https://docs.example.com' };
  const report = (
    connection: NonNullable<AppState['connection']['report']>['connection'],
    save: NonNullable<AppState['connection']['report']>['save'],
    role: 'viewer' | 'editor' | null = 'editor',
  ) => ({ sequence: 4, connection, save, role, title: null, at: '2026-11-11T00:00:00.000Z' });

  it('says "Connecting" until the editor has reported, and nothing about saving', () => {
    const opening = withConnection({ server, session, report: null });
    expect(connectionChip(opening).label).toBe('Connecting');
    expect(connectionStateName(opening)).toBe('connecting');
    expect(saveLabel(opening)).toBe('');
    expect(accessChip(opening)?.label).toBe('Can edit');
    expect(documentTitle(opening)).toBe('Launch notes');
  });

  it('shows Saved only when the editor session reports saved', () => {
    const cases: [ReturnType<typeof report>, string, string][] = [
      [report('live', 'saved'), 'Live', 'Saved'],
      [report('live', 'saving'), 'Live', 'Saving…'],
      [report('reconnecting', 'pending'), 'Reconnecting', 'Changes pending'],
      [report('offline', 'pending'), 'Offline', 'Changes pending'],
      [report('live', 'error'), 'Live', 'Not saved'],
      // A reader has nothing to save: the access badge says "View only" instead.
      [report('live', 'read_only', 'viewer'), 'Live', ''],
    ];
    for (const [current, connection, save] of cases) {
      const live = withConnection({ server, session, report: current });
      expect(connectionChip(live).label).toBe(connection);
      expect(saveLabel(live)).toBe(save);
      expect(saveStateName(live)).toBe(save ? current.save : '');
    }
  });

  it('claims nothing about saving before the server has said what the role is, except bad news', () => {
    expect(
      saveLabel(withConnection({ server, session, report: report('connecting', 'saved', null) })),
    ).toBe('');
    expect(
      saveLabel(withConnection({ server, session, report: report('offline', 'pending', null) })),
    ).toBe('Changes pending');
  });

  it('takes role and title from the live report once there is one', () => {
    const live = withConnection({
      server,
      session,
      report: { ...report('live', 'read_only', 'viewer'), title: 'Renamed by its owner' },
    });
    expect(accessChip(live)?.label).toBe('View only');
    expect(documentTitle(live)).toBe('Renamed by its owner');
  });

  it('keeps the reason visible after the server ended the session', () => {
    const notice = (code: string) => ({
      id: 'n1',
      tone: 'warning' as const,
      code,
      message: 'x',
      at: '2026-11-11T00:00:00.000Z',
    });
    const cases: [string, string, string][] = [
      ['share_revoked', 'access_revoked', 'Access revoked'],
      ['forbidden', 'access_revoked', 'Access revoked'],
      ['share_expired', 'access_expired', 'Access expired'],
      ['session_expired', 'access_expired', 'Access expired'],
      ['unauthenticated', 'access_expired', 'Access expired'],
      ['document_trashed', 'document_unavailable', 'Unavailable'],
      ['not_found', 'document_unavailable', 'Unavailable'],
    ];
    for (const [code, stateName, label] of cases) {
      const ended = withConnection({ server, session: null, report: null, notice: notice(code) });
      expect(endedAccess(code)).toBe(stateName);
      expect(connectionStateName(ended)).toBe(stateName);
      expect(connectionChip(ended).label).toBe(label);
      expect(saveLabel(ended)).toBe('');
      expect(accessChip(ended)).toBeNull();
    }
    // Any other notice is not an ended session.
    for (const code of ['handoff_invalid', 'too_many_links', 'server_mismatch', undefined, null]) {
      expect(endedAccess(code)).toBeNull();
    }
    const idle = withConnection({ server, session: null, notice: notice('handoff_invalid') });
    expect(connectionStateName(idle)).toBe('idle');
    expect(connectionChip(idle).label).toBe('No document');
  });
});

describe('macOS application menu', () => {
  const menu = buildMacAppMenuModel(state('darwin'));
  const roles = flatten(menu)
    .map((entry) => entry.role)
    .filter(Boolean);

  it('uses native roles for editing so Command shortcuts work', () => {
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(roles).toContain(role);
    }
    expect(menu.map((entry) => entry.label)).toEqual(['RealtimeDocs', 'Edit', 'Panel', 'Window']);
  });

  it('has the standard app commands, with quit separate from closing a window', () => {
    for (const role of ['about', 'hide', 'hideOthers', 'unhide', 'services'])
      expect(roles).toContain(role);
    expect(find(menu, 'quit')?.accelerator).toBe('Command+Q');
    expect(find(menu, 'close-window')?.accelerator).toBe('Command+W');
    expect(find(menu, 'open-settings')?.accelerator).toBe('Command+,');
  });

  it('repeats the recovery commands in the Panel menu', () => {
    for (const action of [
      'toggle-visibility',
      'return-to-interactive',
      'click-through-mode',
      'toggle-pin',
      'reset-position',
      'toggle-collapse',
      'preset:standard',
      'normal-window',
      'open-share-guide',
      'open-privacy-test-center',
    ]) {
      expect(find(menu, action), action).toBeDefined();
    }
    expect(find(menu, 'return-to-interactive')?.label).toBe(RETURN_TO_INTERACTIVE_LABEL);
  });
});

describe('window options', () => {
  const input = {
    preloadPath: '/app/preload/preload.cjs',
    session: undefined,
    packaged: true,
    platform: 'win32' as const,
  };

  it('makes every renderer isolated, sandboxed and Node-free', () => {
    for (const options of [
      panelWindowOptions({ ...input, bounds: { x: 1, y: 2, width: 720, height: 460 } }),
      settingsWindowOptions(input),
      probeWindowOptions(input),
    ]) {
      expect(options.show).toBe(false);
      expect(options.webPreferences).toMatchObject({
        preload: '/app/preload/preload.cjs',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        experimentalFeatures: false,
      });
      expect(options.webPreferences).not.toHaveProperty('enableBlinkFeatures');
    }
  });

  it('disables developer tools in packaged builds only', () => {
    expect(secureWebPreferences(input).devTools).toBe(false);
    expect(secureWebPreferences({ ...input, packaged: false }).devTools).toBe(true);
  });

  it('creates the panel frameless, transparent, non-resizable and without whole-window opacity', () => {
    const options = panelWindowOptions({
      ...input,
      bounds: { x: 10, y: 20, width: 720, height: 460 },
    });
    expect(options).toMatchObject({
      x: 10,
      y: 20,
      width: 720,
      height: 460,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
    });
    expect(options).not.toHaveProperty('opacity');
  });

  it('keeps the settings window an ordinary opaque window', () => {
    expect(settingsWindowOptions(input)).toMatchObject({
      frame: true,
      transparent: false,
      resizable: true,
    });
  });

  it('makes only the diagnostics probe natively resizable and transparent', () => {
    expect(probeWindowOptions(input)).toMatchObject({
      frame: false,
      transparent: true,
      resizable: true,
    });
  });
});

describe('panel keyboard commands', () => {
  const key = (
    code: string,
    overrides: Partial<Parameters<typeof matchWindowCommand>[0]> = {},
  ) => ({
    type: 'keyDown',
    key: '',
    code,
    control: true,
    alt: true,
    shift: true,
    meta: false,
    ...overrides,
  });

  it('resizes with the arrow keys', () => {
    expect(matchWindowCommand(key('ArrowRight'))).toEqual({
      kind: 'nudge-size',
      deltaWidth: KEYBOARD_RESIZE_STEP,
      deltaHeight: 0,
    });
    expect(matchWindowCommand(key('ArrowUp'))).toEqual({
      kind: 'nudge-size',
      deltaWidth: 0,
      deltaHeight: -KEYBOARD_RESIZE_STEP,
    });
  });

  it('maps digits to presets, 0 to reset and C to collapse', () => {
    expect(matchWindowCommand(key('Digit1'))).toEqual({ kind: 'preset', preset: 'compact' });
    expect(matchWindowCommand(key('Digit2'))).toEqual({ kind: 'preset', preset: 'standard' });
    expect(matchWindowCommand(key('Digit5'))).toEqual({ kind: 'preset', preset: 'large' });
    expect(matchWindowCommand(key('Digit6'))).toBeNull();
    expect(matchWindowCommand(key('Digit0'))).toEqual({ kind: 'reset-position' });
    expect(matchWindowCommand(key('KeyC'))).toEqual({ kind: 'toggle-collapse' });
  });

  it('never fires for ordinary typing or editing shortcuts', () => {
    expect(matchWindowCommand(key('ArrowRight', { shift: false }))).toBeNull();
    expect(matchWindowCommand(key('ArrowRight', { alt: false }))).toBeNull();
    expect(matchWindowCommand(key('ArrowRight', { control: false }))).toBeNull();
    expect(matchWindowCommand(key('ArrowRight', { meta: true }))).toBeNull();
    expect(matchWindowCommand(key('ArrowRight', { type: 'keyUp' }))).toBeNull();
    // Never while an input method is composing (IME).
    expect(matchWindowCommand(key('ArrowRight', { composing: true }))).toBeNull();
    expect(matchWindowCommand(key('KeyA'))).toBeNull();
    // The editor's heading shortcut (Ctrl/Cmd+Alt+1) is untouched.
    expect(matchWindowCommand(key('Digit1', { shift: false }))).toBeNull();
  });

  it('describes the chord per platform', () => {
    expect(windowCommandHints('win32').chord).toBe('Ctrl+Alt+Shift');
    expect(windowCommandHints('darwin').chord).toBe('Control+Option+Shift');
  });
});

describe('logging', () => {
  it('redacts sensitive keys and secret-shaped values', () => {
    const secret = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
    expect(
      redactFields({
        token: 'abc',
        shareSecret: secret,
        handoffCode: secret,
        authorization: 'Bearer x',
        link: 'https://docs.example.com/s/x#y',
        reason: `failed for ${secret}`,
        host: 'docs.example.com',
        count: 3,
        skipped: undefined,
      }),
    ).toEqual({
      token: '[redacted]',
      shareSecret: '[redacted]',
      handoffCode: '[redacted]',
      authorization: '[redacted]',
      link: '[redacted]',
      reason: 'failed for [redacted]',
      host: 'docs.example.com',
      count: 3,
    });
  });

  it('writes one JSON line per event and honours the minimum level', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line), 'warn');
    logger.info('ignored');
    logger.warn('deep_link.rejected', { reason: 'server_mismatch' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'warn',
      event: 'deep_link.rejected',
      reason: 'server_mismatch',
    });
  });
});

describe('what the panel is told', () => {
  it('leaves out verification records, the monitor layout and the probe note', () => {
    const full = state('win32', {
      displays: [
        {
          id: 1,
          label: 'Built-in',
          primary: true,
          scaleFactor: 2,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        },
      ],
      probe: {
        open: true,
        record: {
          result: 'works',
          notes: 'only the settings window shows this',
          osPlatform: 'win32',
          osVersion: '10.0.22631',
          electronVersion: '45.2.3',
          recordedAt: '2026-11-10T10:00:00.000Z',
        },
      },
    });
    full.capture.native = {
      present: true,
      sha256Prefix: '0123456789ab',
      reason: null,
      label: null,
      affinity: 'exclude_from_capture',
      compositionEnabled: true,
    };
    const before = JSON.stringify(full);
    const reduced = panelView(full);

    expect(reduced.displays).toEqual([]);
    expect(reduced.probe).toEqual({ open: true, record: null });
    expect(reduced.capture.native).toBeNull();
    expect(JSON.stringify(reduced)).not.toMatch(/only the settings|0123456789ab/);
    // What the panel does display is unchanged, and the full state is not modified.
    expect(reduced.capture.status.label).toBe(full.capture.status.label);
    expect(reduced.capture.requested).toBe(full.capture.requested);
    expect(reduced.connection).toEqual(full.connection);
    expect(reduced.panel).toEqual(full.panel);
    expect(reduced.appearance).toEqual(full.appearance);
    expect(JSON.stringify(full)).toBe(before);
  });
});

describe('rate limit for actions a page can ask for', () => {
  it('lets a person through and stops a loop', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ minIntervalMs: 700, max: 3, windowMs: 60_000 }, () => now);
    expect(limiter.take()).toBe(true);
    // Too soon after the last one.
    now += 699;
    expect(limiter.take()).toBe(false);
    now += 1;
    expect(limiter.take()).toBe(true);
    now += 700;
    expect(limiter.take()).toBe(true);
    // The fourth in the same minute is refused, however slowly it comes.
    now += 10_000;
    expect(limiter.take()).toBe(false);
    // A refused attempt does not extend the wait: the first one leaves the window on time.
    now = 1_000_000 + 60_000;
    expect(limiter.take()).toBe(true);
  });

  it('refuses every call of a tight loop but the first', () => {
    const now = 5_000;
    const limiter = new RateLimiter({ minIntervalMs: 700, max: 12, windowMs: 60_000 }, () => now);
    const accepted = Array.from({ length: 1000 }, () => limiter.take()).filter(Boolean);
    expect(accepted).toHaveLength(1);
  });
});

describe('bridge surface and wording', () => {
  it('offers no way to confirm anything from a window', () => {
    const bridge = fs.readFileSync(path.join(__dirname, '../../src/shared/bridge.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(__dirname, '../../src/preload/preload.ts'), 'utf8');
    for (const text of [bridge, preload]) {
      expect(text).not.toMatch(/\bconfirm\w*\s*[(:]/);
    }
  });

  it('lists the bridge keys in sorted order for the smoke test', () => {
    expect([...BRIDGE_KEYS]).toEqual([...BRIDGE_KEYS].sort());
    expect(new Set(Object.values(CH)).size).toBe(Object.values(CH).length);
    expect(Object.values(CH).every((channel) => channel.startsWith('rd:'))).toBe(true);
  });

  const sourceRoot = path.resolve(__dirname, '../../src');
  function sourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx|css|html)$/.test(entry.name) ? [full] : [];
    });
  }

  /**
   * Source text without comments (developer notes, not UI) and without the
   * contract's own list of forbidden words, which necessarily contains them.
   */
  function uiText(file: string): string {
    return (
      fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/export const FORBIDDEN_PROTECTION_WORDS = \[[\s\S]*?\] as const;/, '')
        // Electron API identifiers that legitimately contain a word.
        .replace(/bypassCSP|bypassCustomProtocolHandlers|bypassHeatCheck\w*/g, '')
    );
  }

  it('never uses concealment wording anywhere in the source', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      if (
        /\b(invisible|undetectable|bypass(?:es|ed|ing)?|stealth|incognito|guarantee[sd]?)\b/i.test(
          uiText(file),
        )
      ) {
        offenders.push(path.relative(sourceRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never copies a contract string: every surface uses the constant from status.ts', () => {
    const contract = [
      ...Object.values(PROTECTION_STATUS_LABELS),
      ...Object.values(OBSERVED_OUTCOME_LABELS),
      ...SAFE_SHARE_GUIDE_STEPS,
      MACOS_WHOLE_DISPLAY_WARNING,
      RETURN_TO_INTERACTIVE_LABEL,
    ].filter((text) => text.trim().split(/\s+/).length >= 2);
    const contractFile = path.join(sourceRoot, 'shared', 'privacy', 'status.ts');
    const offenders: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      if (file === contractFile) continue;
      const text = uiText(file);
      for (const phrase of contract) {
        // Three words or more are a copy in any letter case (for example inside a
        // sentence); two-word labels only as written, so "protection off" in a
        // description of a tested configuration is not mistaken for the label.
        const copied =
          phrase.split(/\s+/).length >= 3
            ? text.toLowerCase().includes(phrase.toLowerCase())
            : text.includes(phrase);
        if (copied) offenders.push(`${path.relative(sourceRoot, file)}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares no generic IPC, shell, file-system or eval primitive in the preload', () => {
    const preload = fs
      .readFileSync(path.join(sourceRoot, 'preload/preload.ts'), 'utf8')
      // Code only: the header comment explains what a sandboxed preload may require.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*\)/);
    expect(preload).not.toMatch(/\brequire\(|child_process|node:fs|shell\.|eval\(|new Function/);
    // Every invoke/send uses a declared channel constant, never a caller-supplied name.
    const calls = preload.match(/ipcRenderer\.(?:invoke|send)\(([^,)]+)/g) ?? [];
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.every((call) => /\(CH\.[A-Za-z]+$/.test(call))).toBe(true);
  });
});
