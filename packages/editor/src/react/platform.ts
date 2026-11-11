/** Platform detection for shortcut hints (⌘ on macOS, Ctrl elsewhere). */

let cachedMac: boolean | null = null;

/**
 * True where the editor's `Mod` key is Command. This is deliberately the same
 * test ProseMirror's keymap uses to bind `Mod-` shortcuts, so a hint always
 * names the key that actually works, also in browsers whose user agent string
 * claims another system than `navigator.platform` does.
 */
export function isMacPlatform(): boolean {
  if (cachedMac !== null) return cachedMac;
  if (typeof navigator === 'undefined') return false;
  cachedMac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  return cachedMac;
}

/** Test hook: forget the cached platform. */
export function resetPlatformCache(): void {
  cachedMac = null;
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Ctrl: '⌃',
  Enter: '↩',
};

/**
 * Formats a shortcut written as `Mod+Shift+Z` for the current platform:
 * `⌘⇧Z` on macOS, `Ctrl+Shift+Z` elsewhere.
 */
export function formatShortcut(shortcut: string, mac: boolean = isMacPlatform()): string {
  const parts = shortcut.split('+');
  if (mac) return parts.map((part) => MAC_SYMBOLS[part] ?? part).join('');
  return parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)).join('+');
}
