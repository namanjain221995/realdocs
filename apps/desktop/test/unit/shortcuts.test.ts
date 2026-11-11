import { describe, expect, it, vi } from 'vitest';
import { ShortcutManager, type ShortcutRegistrar } from '../../src/main/shortcut-manager';
import {
  SHORTCUT_ACTIONS,
  acceleratorFromKeyEvent,
  acceleratorKeyCaps,
  defaultShortcuts,
  findDuplicateActions,
  formatAccelerator,
  parseAccelerator,
  sanitizeShortcutMap,
  type DesktopPlatform,
  type ShortcutAction,
} from '../../src/shared/shortcuts';

/** Simulates the operating system's global hot-key table, including keys owned by other apps. */
class FakeRegistrar implements ShortcutRegistrar {
  readonly owned = new Map<string, () => void>();
  readonly takenByOthers = new Set<string>();
  /** Accelerators for which `register` claims success but the OS did not bind them. */
  readonly lying = new Set<string>();
  suspended = false;

  register(accelerator: string, callback: () => void): boolean {
    if (this.takenByOthers.has(accelerator)) return false;
    if (this.lying.has(accelerator)) return true;
    this.owned.set(accelerator, callback);
    return true;
  }
  unregister(accelerator: string): void {
    this.owned.delete(accelerator);
  }
  isRegistered(accelerator: string): boolean {
    return this.owned.has(accelerator);
  }
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }
  press(accelerator: string): void {
    if (!this.suspended) this.owned.get(accelerator)?.();
  }
}

function setup(platform: DesktopPlatform = 'win32') {
  const registrar = new FakeRegistrar();
  const handlers = {
    toggleVisibility: vi.fn(),
    returnToInteractive: vi.fn(),
  } satisfies Record<ShortcutAction, () => void>;
  const manager = new ShortcutManager(registrar, platform, handlers);
  return { registrar, handlers, manager };
}

describe('accelerator rules', () => {
  it('has Control-based defaults on Windows/Linux and Command+Option-based defaults on macOS', () => {
    for (const platform of ['win32', 'linux'] as const) {
      for (const accelerator of Object.values(defaultShortcuts(platform))) {
        expect(accelerator.startsWith('Control+Alt+Shift+')).toBe(true);
        expect(parseAccelerator(accelerator, platform).ok).toBe(true);
      }
    }
    for (const accelerator of Object.values(defaultShortcuts('darwin'))) {
      expect(accelerator.startsWith('Command+Alt+Shift+')).toBe(true);
      expect(parseAccelerator(accelerator, 'darwin').ok).toBe(true);
    }
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(findDuplicateActions(defaultShortcuts(platform), platform)).toEqual([]);
    }
  });

  it('normalises aliases, case and order', () => {
    expect(parseAccelerator('shift+ctrl+alt+d', 'win32')).toMatchObject({
      ok: true,
      accelerator: 'Control+Alt+Shift+D',
    });
    expect(parseAccelerator('CmdOrCtrl+Shift+F9', 'win32')).toMatchObject({
      ok: true,
      accelerator: 'Control+Shift+F9',
    });
    expect(parseAccelerator('CmdOrCtrl+Shift+F9', 'darwin')).toMatchObject({
      ok: true,
      accelerator: 'Command+Shift+F9',
    });
    expect(parseAccelerator(' Option + Cmd + space ', 'darwin')).toMatchObject({
      ok: true,
      accelerator: 'Command+Alt+Space',
    });
    expect(parseAccelerator('Control+Alt+Up', 'linux')).toMatchObject({
      ok: true,
      accelerator: 'Control+Alt+Up',
    });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['Control+Alt', 'no_key'],
    ['Control++D', 'no_key'],
    ['Control+Alt+D+E', 'multiple_keys'],
    ['Control+Alt+Enter', 'unknown_key'],
    ['Control+Alt+Delete', 'unknown_key'],
    ['Control+Alt+Escape', 'unknown_key'],
    ['Control+Alt+<script>', 'unknown_key'],
    ['AltGr+E', 'unsupported_modifier'],
    ['Command+Shift+D', 'command_only_on_macos'],
    ['Super+D', 'windows_key_reserved'],
    ['D', 'needs_modifier'],
    ['Shift+D', 'needs_modifier'],
    ['Alt+D', 'needs_modifier'],
    ['Alt+Shift+D', 'needs_modifier'],
    ['F5', 'needs_modifier'],
    ['Control+C', 'needs_second_modifier'],
    ['Control+V', 'needs_second_modifier'],
    ['Control+1', 'needs_second_modifier'],
    ['Alt+F4', 'reserved'],
    ['Control+Alt+F4', 'reserved'],
    ['x'.repeat(80), 'too_long'],
  ])('rejects %j on Windows (%s)', (input, error) => {
    expect(parseAccelerator(input, 'win32')).toEqual({ ok: false, error });
  });

  it('rejects macOS system shortcuts and single-modifier editing shortcuts', () => {
    for (const reserved of [
      'Command+Shift+3',
      'Command+Shift+4',
      'Command+Shift+5',
      'Command+Control+Q',
      'Cmd+Option+D',
      'Command+Shift+Q',
    ]) {
      expect(parseAccelerator(reserved, 'darwin')).toEqual({ ok: false, error: 'reserved' });
    }
    for (const editing of ['Command+C', 'Command+V', 'Command+Q', 'Command+W', 'Command+Z']) {
      expect(parseAccelerator(editing, 'darwin')).toEqual({
        ok: false,
        error: 'needs_second_modifier',
      });
    }
    expect(parseAccelerator('Option+D', 'darwin')).toEqual({ ok: false, error: 'needs_modifier' });
  });

  it('allows function keys with one modifier and F13–F24 alone', () => {
    expect(parseAccelerator('Control+F9', 'win32').ok).toBe(true);
    expect(parseAccelerator('Alt+F9', 'win32').ok).toBe(true);
    expect(parseAccelerator('F13', 'win32').ok).toBe(true);
    expect(parseAccelerator('F24', 'darwin').ok).toBe(true);
    expect(parseAccelerator('F25', 'win32')).toEqual({ ok: false, error: 'unknown_key' });
  });

  it('rejects non-string input', () => {
    for (const input of [null, undefined, 5, {}, ['Control+Alt+Shift+D']]) {
      expect(parseAccelerator(input, 'win32').ok).toBe(false);
    }
  });

  it('formats key caps per platform', () => {
    expect(acceleratorKeyCaps('Control+Alt+Shift+D', 'win32')).toEqual([
      'Ctrl',
      'Alt',
      'Shift',
      'D',
    ]);
    expect(acceleratorKeyCaps('Command+Alt+Shift+D', 'darwin')).toEqual([
      'Cmd',
      'Option',
      'Shift',
      'D',
    ]);
    expect(formatAccelerator('Control+Alt+Shift+T', 'linux')).toBe('Ctrl+Alt+Shift+T');
  });

  it('detects actions that would share a combination', () => {
    expect(
      findDuplicateActions(
        {
          toggleVisibility: 'Ctrl+Alt+Shift+D',
          returnToInteractive: 'shift+alt+control+d',
        },
        'win32',
      ),
    ).toEqual([['toggleVisibility', 'returnToInteractive']]);
  });

  it('repairs a saved map: invalid and duplicate entries fall back to defaults', () => {
    expect(
      sanitizeShortcutMap(
        {
          toggleVisibility: 'Control+Alt+Shift+K',
          returnToInteractive: 'Control+Alt+Shift+K',
        },
        'win32',
      ),
    ).toEqual({
      toggleVisibility: 'Control+Alt+Shift+K',
      returnToInteractive: 'Control+Alt+Shift+T',
    });
    // The retired actions of earlier versions are ignored; nothing else is kept.
    expect(
      sanitizeShortcutMap(
        { toggleClickThrough: 'Control+Alt+Shift+Q', togglePin: 'Control+Alt+Shift+P' },
        'win32',
      ),
    ).toEqual(defaultShortcuts('win32'));
    expect(sanitizeShortcutMap(null, 'darwin')).toEqual(defaultShortcuts('darwin'));
    // A macOS map opened on Windows cannot keep Command.
    expect(sanitizeShortcutMap(defaultShortcuts('darwin'), 'win32')).toEqual(
      defaultShortcuts('win32'),
    );
  });
});

describe('recording a combination from a key event', () => {
  const event = (overrides: Partial<Parameters<typeof acceleratorFromKeyEvent>[0]>) => ({
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  });

  it('waits while only modifiers are held', () => {
    expect(
      acceleratorFromKeyEvent(
        event({ key: 'Control', code: 'ControlLeft', ctrlKey: true }),
        'win32',
      ),
    ).toBeNull();
    expect(
      acceleratorFromKeyEvent(event({ key: 'Shift', code: 'ShiftRight', shiftKey: true }), 'win32'),
    ).toBeNull();
  });

  it('builds an accelerator the validator accepts', () => {
    const accelerator = acceleratorFromKeyEvent(
      event({ key: 'D', code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: true }),
      'win32',
    );
    expect(accelerator).toBe('Control+Alt+Shift+D');
    expect(parseAccelerator(accelerator, 'win32').ok).toBe(true);
  });

  it('uses the physical key when Option changed the character on macOS', () => {
    expect(
      acceleratorFromKeyEvent(
        event({ key: '∂', code: 'KeyD', metaKey: true, altKey: true, shiftKey: true }),
        'darwin',
      ),
    ).toBe('Command+Alt+Shift+D');
  });

  it('uses the printed letter on non-QWERTY layouts', () => {
    // AZERTY: the key at the QWERTY "Q" position types "a".
    expect(
      acceleratorFromKeyEvent(
        event({ key: 'a', code: 'KeyQ', ctrlKey: true, shiftKey: true }),
        'win32',
      ),
    ).toBe('Control+Shift+A');
  });

  it('maps digits, function keys, arrows and space', () => {
    expect(
      acceleratorFromKeyEvent(
        event({ key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true }),
        'win32',
      ),
    ).toBe('Control+Shift+5');
    expect(acceleratorFromKeyEvent(event({ key: 'F9', code: 'F9', ctrlKey: true }), 'win32')).toBe(
      'Control+F9',
    );
    expect(
      acceleratorFromKeyEvent(
        event({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: true }),
        'win32',
      ),
    ).toBe('Control+Alt+Up');
    expect(
      acceleratorFromKeyEvent(
        event({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
        'win32',
      ),
    ).toBe('Control+Shift+Space');
    expect(
      acceleratorFromKeyEvent(event({ key: 'Escape', code: 'Escape', ctrlKey: true }), 'win32'),
    ).toBeNull();
  });
});

describe('registration', () => {
  it('registers all defaults and routes presses to the right action', () => {
    const { registrar, handlers, manager } = setup();
    const status = manager.apply(defaultShortcuts('win32'));
    expect(status.map((item) => [item.action, item.registered, item.error])).toEqual(
      SHORTCUT_ACTIONS.map((action) => [action, true, null]),
    );
    registrar.press('Control+Alt+Shift+T');
    expect(handlers.returnToInteractive).toHaveBeenCalledTimes(1);
    expect(handlers.toggleVisibility).not.toHaveBeenCalled();
    expect(manager.isRegistered('returnToInteractive')).toBe(true);
  });

  it('detects a combination another application owns and reports it', () => {
    const { registrar, manager } = setup();
    registrar.takenByOthers.add('Control+Alt+Shift+T');
    const status = manager.apply(defaultShortcuts('win32'));
    const emergency = status.find((item) => item.action === 'returnToInteractive');
    expect(emergency).toMatchObject({
      registered: false,
      error: 'in_use',
      accelerator: 'Control+Alt+Shift+T',
    });
    expect(manager.isRegistered('returnToInteractive')).toBe(false);
    // Each shortcut fails on its own: the other is unaffected.
    expect(manager.isRegistered('toggleVisibility')).toBe(true);
  });

  it('does not trust a "true" from register that the OS did not honour', () => {
    const { registrar, manager } = setup();
    registrar.lying.add('Control+Alt+Shift+D');
    manager.apply(defaultShortcuts('win32'));
    expect(manager.isRegistered('toggleVisibility')).toBe(false);
    expect(manager.status()[0]).toMatchObject({ registered: false, error: 'in_use' });
  });

  it('survives a registrar that throws', () => {
    const handlers = { toggleVisibility: vi.fn(), returnToInteractive: vi.fn() };
    const manager = new ShortcutManager(
      {
        register: () => {
          throw new Error('conversion failure');
        },
        unregister: () => {
          throw new Error('nope');
        },
        isRegistered: () => false,
      },
      'win32',
      handlers,
    );
    expect(manager.apply(defaultShortcuts('win32')).every((item) => !item.registered)).toBe(true);
  });

  it('marks duplicates in a saved map instead of registering one key twice', () => {
    const { registrar, manager } = setup();
    const status = manager.apply({
      toggleVisibility: 'Control+Alt+Shift+D',
      returnToInteractive: 'Control+Alt+Shift+D',
    });
    expect(status[1]).toMatchObject({
      action: 'returnToInteractive',
      registered: false,
      error: 'duplicate',
    });
    expect([...registrar.owned.keys()].sort()).toEqual(['Control+Alt+Shift+D']);
  });

  it('changes a shortcut and releases the old combination', () => {
    const { registrar, handlers, manager } = setup();
    manager.apply(defaultShortcuts('win32'));
    expect(manager.set('toggleVisibility', 'Ctrl+Shift+F9')).toEqual({
      ok: true,
      accelerator: 'Control+Shift+F9',
    });
    expect(registrar.isRegistered('Control+Alt+Shift+D')).toBe(false);
    registrar.press('Control+Shift+F9');
    expect(handlers.toggleVisibility).toHaveBeenCalledTimes(1);
    expect(manager.current().toggleVisibility).toBe('Control+Shift+F9');
    expect(manager.status()[0]?.isDefault).toBe(false);
  });

  it('rolls back to the working shortcut when the new one is taken', () => {
    const { registrar, handlers, manager } = setup();
    manager.apply(defaultShortcuts('win32'));
    registrar.takenByOthers.add('Control+Alt+Shift+Z');
    expect(manager.set('returnToInteractive', 'Control+Alt+Shift+Z')).toEqual({
      ok: false,
      error: 'in_use',
      restoredPrevious: true,
    });
    // The recovery shortcut still works exactly as before.
    expect(manager.isRegistered('returnToInteractive')).toBe(true);
    expect(manager.current().returnToInteractive).toBe('Control+Alt+Shift+T');
    registrar.press('Control+Alt+Shift+T');
    expect(handlers.returnToInteractive).toHaveBeenCalledTimes(1);
  });

  it('refuses invalid combinations and conflicts without touching anything', () => {
    const { registrar, manager } = setup();
    manager.apply(defaultShortcuts('win32'));
    const before = [...registrar.owned.keys()].sort();
    expect(manager.set('returnToInteractive', 'Control+C')).toEqual({
      ok: false,
      error: 'invalid',
      reason: 'needs_second_modifier',
    });
    expect(manager.set('returnToInteractive', 'shift+alt+ctrl+d')).toEqual({
      ok: false,
      error: 'duplicate',
      conflictsWith: 'toggleVisibility',
    });
    expect([...registrar.owned.keys()].sort()).toEqual(before);
  });

  it('can retry a shortcut that failed at startup once the other app released it', () => {
    const { registrar, manager } = setup();
    registrar.takenByOthers.add('Control+Alt+Shift+T');
    manager.apply(defaultShortcuts('win32'));
    expect(manager.isRegistered('returnToInteractive')).toBe(false);
    registrar.takenByOthers.clear();
    expect(manager.set('returnToInteractive', 'Control+Alt+Shift+T').ok).toBe(true);
    expect(manager.isRegistered('returnToInteractive')).toBe(true);
  });

  it('suspends handling while recording and reports that honestly', () => {
    const { registrar, handlers, manager } = setup();
    manager.apply(defaultShortcuts('win32'));
    manager.setSuspended(true);
    expect(registrar.suspended).toBe(true);
    expect(manager.isRegistered('returnToInteractive')).toBe(false);
    expect(manager.status().every((item) => !item.registered && item.error === 'suspended')).toBe(
      true,
    );
    // Even if the OS still delivered the key, nothing happens.
    registrar.suspended = false;
    registrar.press('Control+Alt+Shift+T');
    expect(handlers.returnToInteractive).not.toHaveBeenCalled();
    manager.setSuspended(false);
    registrar.press('Control+Alt+Shift+T');
    expect(handlers.returnToInteractive).toHaveBeenCalledTimes(1);
  });

  it('unregisters everything on shutdown', () => {
    const { registrar, manager } = setup();
    manager.apply(defaultShortcuts('win32'));
    manager.unregisterAll();
    expect(registrar.owned.size).toBe(0);
    expect(manager.isRegistered('toggleVisibility')).toBe(false);
  });
});
