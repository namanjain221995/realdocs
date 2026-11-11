/**
 * Navigation and popup policy for app windows. Pure decisions; the Electron
 * event wiring is in `session-security.ts`.
 *
 * - A window may only ever show its own packaged page. Any other navigation
 *   (including redirects and in-page `location =` assignments) is cancelled.
 * - `window.open` and `target=_blank` never create a window. If the target is
 *   a safe external link (http, https, mailto) it is handed to the operating
 *   system's default handler; everything else is dropped.
 */
import { isSafeExternalUrl, sanitizeLinkHref } from '@realtimedocs/contracts';
import { APP_HOST, APP_SCHEME, ENTRY_POINTS } from './protocol-resolve';

/** True only for `app://realtimedocs/<known entry page>` (query and fragment allowed). */
export function isAppPageUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return (
    url.protocol === `${APP_SCHEME}:` &&
    url.hostname === APP_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    Object.hasOwn(ENTRY_POINTS, url.pathname)
  );
}

export type NavigationDecision = 'allow' | 'block';

/**
 * `currentUrl` is the page the window is showing. Only a same-document
 * navigation (same entry page; fragment or query changes) is allowed.
 */
export function decideNavigation(targetUrl: string, currentUrl: string): NavigationDecision {
  if (!isAppPageUrl(targetUrl) || !isAppPageUrl(currentUrl)) return 'block';
  return new URL(targetUrl).pathname === new URL(currentUrl).pathname ? 'allow' : 'block';
}

export type ExternalOpenDecision = { open: true; url: string } | { open: false };

/** Validates a URL before it is given to `shell.openExternal`. Returns the normalised href. */
export function decideExternalOpen(input: unknown): ExternalOpenDecision {
  if (typeof input !== 'string' || input.length > 2048) return { open: false };
  // Stricter than the editor's link rule: the scheme must be spelled out (no
  // "bare domain" upgrade), and nothing that could be read as a local or
  // network path, or that hides a scheme behind whitespace or control
  // characters, is ever handed to the operating system.
  if (!/^(?:https?:\/\/|mailto:)/i.test(input)) return { open: false };
  if (hasControlOrBackslash(input)) return { open: false };
  if (!isSafeExternalUrl(input)) return { open: false };
  const href = sanitizeLinkHref(input);
  if (!href) return { open: false };
  const protocol = new URL(href).protocol;
  if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'mailto:') {
    return { open: false };
  }
  return { open: true, url: href };
}

function hasControlOrBackslash(input: string): boolean {
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x5c || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
