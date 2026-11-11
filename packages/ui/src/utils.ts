/** Anything `cx` accepts: strings, falsy values, nested arrays and `{ className: condition }` maps. */
export type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly ClassValue[]
  | { readonly [className: string]: unknown };

/**
 * Joins class names. Falsy parts are dropped, arrays are flattened and object
 * keys are kept when their value is truthy.
 *
 *   cx('rd-btn', primary && 'rd-btn--primary', { 'is-open': open }, className)
 */
export function cx(...parts: ClassValue[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    let next = '';
    if (typeof part === 'string') {
      next = part;
    } else if (typeof part === 'number' || typeof part === 'bigint') {
      next = String(part);
    } else if (Array.isArray(part)) {
      next = cx(...(part as readonly ClassValue[]));
    } else if (typeof part === 'object') {
      const map = part as { readonly [className: string]: unknown };
      for (const key of Object.keys(map)) {
        if (map[key]) next += (next ? ' ' : '') + key;
      }
    }
    if (next) out += (out ? ' ' : '') + next;
  }
  return out;
}

/**
 * Copies text to the clipboard. Resolves to `true` when the text was copied and
 * `false` otherwise; it never throws or rejects.
 *
 * The async Clipboard API is tried first. Where it is missing or refuses
 * (insecure context, Safari outside a user gesture, an unfocused document) the
 * legacy `document.execCommand('copy')` path runs against an off-screen
 * textarea. Call it directly from a click or key handler so both paths still
 * count as a user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof window !== 'undefined') {
      const clipboard = navigator.clipboard as Clipboard | undefined;
      // `isSecureContext` is `false` on plain-http origins, where the async API
      // is absent or always rejects. `undefined` (older engines) is not a veto.
      if (
        clipboard &&
        typeof clipboard.writeText === 'function' &&
        window.isSecureContext !== false
      ) {
        try {
          await clipboard.writeText(text);
          return true;
        } catch {
          // Fall through to the legacy path.
        }
      }
    }
    return legacyCopy(text);
  } catch {
    return false;
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const host = document.body ?? document.documentElement;
  if (!host) return false;

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  const savedRanges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      savedRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Read-only keeps mobile keyboards closed; 16px stops iOS zooming the page.
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  const style = textarea.style;
  style.position = 'fixed';
  style.top = '0';
  style.left = '0';
  style.width = '1px';
  style.height = '1px';
  style.padding = '0';
  style.border = '0';
  style.opacity = '0';
  style.fontSize = '16px';
  host.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (selection) {
      try {
        selection.removeAllRanges();
        for (const range of savedRanges) selection.addRange(range);
      } catch {
        // Restoring the previous selection is best effort.
      }
    }
    try {
      previousFocus?.focus({ preventScroll: true });
    } catch {
      // The element may have been removed in the meantime.
    }
  }
}
