/**
 * Global shortcut rules: accelerator parsing, validation, platform defaults
 * and conflict detection. Pure — the Electron `globalShortcut` calls live in
 * `src/main/shortcut-manager.ts`, which takes the registrar as a parameter.
 *
 * Accelerator syntax follows Electron's (`Control+Alt+Shift+D`).
 */

import { RETURN_TO_INTERACTIVE_LABEL } from './privacy/status';

/**
 * The two global shortcuts: show or hide the panel, and the emergency way
 * back ("Return to interactive mode": leaves click-through, un-parks,
 * un-collapses, shows, raises and moves the panel fully on screen).
 */
export const SHORTCUT_ACTIONS = ['toggleVisibility', 'returnToInteractive'] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutMap = Record<ShortcutAction, string>;

export type DesktopPlatform = 'win32' | 'darwin' | 'linux';

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  toggleVisibility: 'Show or hide the panel',
  returnToInteractive: `${RETURN_TO_INTERACTIVE_LABEL} (emergency)`,
};

/**
 * Defaults. Windows/Linux use Control-based chords with three modifiers so
 * they neither collide with AltGr typing (AltGr = Ctrl+Alt on many layouts)
 * nor with editing shortcuts. macOS uses Command+Option+Shift.
 */
export function defaultShortcuts(platform: DesktopPlatform): ShortcutMap {
  if (platform === 'darwin') {
    return {
      toggleVisibility: 'Command+Alt+Shift+D',
      returnToInteractive: 'Command+Alt+Shift+T',
    };
  }
  return {
    toggleVisibility: 'Control+Alt+Shift+D',
    returnToInteractive: 'Control+Alt+Shift+T',
  };
}

type Modifier = 'Control' | 'Command' | 'Alt' | 'Shift' | 'Super';
const MODIFIER_ORDER: readonly Modifier[] = ['Control', 'Command', 'Alt', 'Shift', 'Super'];

export type AcceleratorError =
  | 'empty'
  | 'too_long'
  | 'no_key'
  | 'multiple_keys'
  | 'unknown_key'
  | 'unsupported_modifier'
  | 'command_only_on_macos'
  | 'windows_key_reserved'
  | 'needs_modifier'
  | 'needs_second_modifier'
  | 'reserved';

export const ACCELERATOR_ERROR_MESSAGES: Record<AcceleratorError, string> = {
  empty: 'Press a key combination.',
  too_long: 'That combination is too long.',
  no_key: 'Add a letter, digit or function key to the modifiers.',
  multiple_keys: 'Use one key together with modifier keys.',
  unknown_key: 'That key cannot be used in a global shortcut.',
  unsupported_modifier: 'AltGr cannot be used in a global shortcut.',
  command_only_on_macos: 'The Command key is only available on macOS.',
  windows_key_reserved: 'Windows-key combinations are reserved by Windows.',
  needs_modifier: 'Include Ctrl (Command on macOS) so the shortcut does not block typing.',
  needs_second_modifier:
    'Add a second modifier (for example Shift or Alt) so the shortcut does not replace an editing shortcut.',
  reserved: 'That combination is reserved by the operating system.',
};

export type ParsedAccelerator =
  | { ok: true; accelerator: string; modifiers: Modifier[]; key: string }
  | { ok: false; error: AcceleratorError };

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
};

function normalizeKey(token: string): string | null {
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(token);
  if (fn) return `F${fn[1]}`;
  return NAMED_KEYS[token.toLowerCase()] ?? null;
}

function normalizeModifier(
  token: string,
  platform: DesktopPlatform,
): Modifier | 'altgr' | 'command_elsewhere' | null {
  switch (token.toLowerCase()) {
    case 'control':
    case 'ctrl':
      return 'Control';
    case 'command':
    case 'cmd':
      return platform === 'darwin' ? 'Command' : 'command_elsewhere';
    case 'commandorcontrol':
    case 'cmdorctrl':
      return platform === 'darwin' ? 'Command' : 'Control';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'shift':
      return 'Shift';
    case 'super':
    case 'meta':
      return platform === 'darwin' ? 'Command' : 'Super';
    case 'altgr':
      return 'altgr';
    default:
      return null;
  }
}

/** Combinations the operating system owns; registering them would fail or hurt. */
const RESERVED: Record<DesktopPlatform, readonly string[]> = {
  win32: ['Alt+F4', 'Control+Alt+F4', 'Control+Shift+F10'],
  linux: ['Alt+F4', 'Control+Alt+F1', 'Control+Alt+F2', 'Control+Alt+F7'],
  darwin: [
    'Command+Shift+3',
    'Command+Shift+4',
    'Command+Shift+5',
    'Control+Command+Q',
    'Control+Command+F',
    'Control+Command+Space',
    'Command+Alt+D',
    'Command+Shift+Q',
    'Command+Alt+Shift+Q',
  ],
};

function isFunctionKey(key: string): boolean {
  return /^F\d+$/.test(key);
}

/**
 * Parses and validates an accelerator for use as a *global* shortcut and
 * returns it in canonical form (fixed modifier order, canonical names).
 */
export function parseAccelerator(input: unknown, platform: DesktopPlatform): ParsedAccelerator {
  if (typeof input !== 'string') return { ok: false, error: 'empty' };
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  if (trimmed.length > 64) return { ok: false, error: 'too_long' };

  const tokens = trimmed.split('+').map((token) => token.trim());
  if (tokens.some((token) => token === '')) return { ok: false, error: 'no_key' };

  const modifiers = new Set<Modifier>();
  let key: string | null = null;
  for (const token of tokens) {
    const modifier = normalizeModifier(token, platform);
    if (modifier === 'altgr') return { ok: false, error: 'unsupported_modifier' };
    if (modifier === 'command_elsewhere') return { ok: false, error: 'command_only_on_macos' };
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    const normalized = normalizeKey(token);
    if (!normalized) return { ok: false, error: 'unknown_key' };
    if (key !== null) return { ok: false, error: 'multiple_keys' };
    key = normalized;
  }
  if (key === null) return { ok: false, error: 'no_key' };

  if (platform === 'win32' && modifiers.has('Super')) {
    return { ok: false, error: 'windows_key_reserved' };
  }

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  const hasPrimary = modifiers.has('Control') || modifiers.has('Command') || modifiers.has('Super');
  const functionKey = isFunctionKey(key);
  const highFunctionKey = functionKey && Number(key.slice(1)) >= 13;

  if (!highFunctionKey) {
    if (ordered.length === 0) return { ok: false, error: 'needs_modifier' };
    // Alt/Option + key types characters or opens menus unless it is a function key.
    if (!hasPrimary && !(functionKey && modifiers.has('Alt'))) {
      return { ok: false, error: 'needs_modifier' };
    }
    // Ctrl+C, Cmd+Q and friends: a single modifier with a typing key is an editing shortcut.
    if (!functionKey && ordered.length < 2) return { ok: false, error: 'needs_second_modifier' };
  }

  const accelerator = [...ordered, key].join('+');
  if (RESERVED[platform].includes(accelerator)) return { ok: false, error: 'reserved' };
  return { ok: true, accelerator, modifiers: ordered, key };
}

export function isValidAccelerator(input: unknown, platform: DesktopPlatform): boolean {
  return parseAccelerator(input, platform).ok;
}

/** Human-readable key caps, e.g. `['Ctrl', 'Alt', 'Shift', 'D']` or `['Cmd', 'Option', 'Shift', 'D']`. */
export function acceleratorKeyCaps(accelerator: string, platform: DesktopPlatform): string[] {
  const parsed = parseAccelerator(accelerator, platform);
  const tokens = parsed.ok ? [...parsed.modifiers, parsed.key] : accelerator.split('+');
  return tokens.map((token) => {
    switch (token) {
      case 'Control':
        return 'Ctrl';
      case 'Command':
        return 'Cmd';
      case 'Alt':
        return platform === 'darwin' ? 'Option' : 'Alt';
      case 'Super':
        return platform === 'win32' ? 'Win' : 'Super';
      default:
        return token;
    }
  });
}

export function formatAccelerator(accelerator: string, platform: DesktopPlatform): string {
  return acceleratorKeyCaps(accelerator, platform).join('+');
}

/** Actions that would end up with the same key combination (after normalisation). */
export function findDuplicateActions(
  shortcuts: Partial<Record<ShortcutAction, string>>,
  platform: DesktopPlatform,
): ShortcutAction[][] {
  const byAccelerator = new Map<string, ShortcutAction[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const parsed = parseAccelerator(shortcuts[action], platform);
    if (!parsed.ok) continue;
    const list = byAccelerator.get(parsed.accelerator) ?? [];
    list.push(action);
    byAccelerator.set(parsed.accelerator, list);
  }
  return [...byAccelerator.values()].filter((actions) => actions.length > 1);
}

/** Replaces invalid or missing entries with the platform default (used when loading preferences). */
export function sanitizeShortcutMap(input: unknown, platform: DesktopPlatform): ShortcutMap {
  const defaults = defaultShortcuts(platform);
  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const result = { ...defaults };
  const used = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    const parsed = parseAccelerator(source[action], platform);
    const candidate = parsed.ok && !used.has(parsed.accelerator) ? parsed.accelerator : null;
    const fallback = used.has(defaults[action]) ? null : defaults[action];
    const chosen = candidate ?? fallback ?? defaults[action];
    result[action] = chosen;
    used.add(chosen);
  }
  return result;
}

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
};

/**
 * Builds an accelerator candidate from a DOM `keydown` (shortcut recorder).
 * Returns null while only modifier keys are held. Letters use the logical key
 * when it is a plain A–Z (so AZERTY/QWERTZ users get the letter printed on
 * their key) and fall back to the physical key when a modifier changed the
 * character (Option+D produces "∂" on macOS).
 */
export function acceleratorFromKeyEvent(
  event: KeyEventLike,
  platform: DesktopPlatform,
): string | null {
  let key: string | null;
  const letter = /^Key([A-Z])$/.exec(event.code);
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (letter) {
    key = /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : (letter[1] ?? null);
  } else if (digit) {
    key = digit[1] ?? null;
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
    key = event.key;
  } else {
    key = CODE_KEYS[event.code] ?? null;
  }
  if (!key) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.metaKey) parts.push(platform === 'darwin' ? 'Command' : 'Super');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
