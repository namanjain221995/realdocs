/**
 * Capability secrets from URL fragments (share links and invitation links).
 *
 * `https://host/s/<grantId>#<secret>` and `https://host/invite/<id>#<secret>`
 * carry their secret in the fragment, which the browser never sends to a
 * server. This module is the only place that reads it. The rules:
 *
 * 1. The fragment is removed from the address bar in the same synchronous
 *    step that reads it (`history.replaceState`), before the router exists
 *    and before any request is made.
 * 2. The secret is held in memory only, for the lifetime of the page. It is
 *    never written to `localStorage`, `sessionStorage`, a cookie, the query
 *    cache, the console or an error message.
 * 3. It leaves memory as soon as it has been exchanged or has been refused.
 *
 * A reload after step 1 therefore loses the secret by design; the screens say
 * so and ask for the original link.
 */
import { isCapabilitySecret } from '@realtimedocs/contracts';

export type CapabilityPurpose = 'share' | 'invite';

export type Capability =
  /** A well-formed secret is held in memory. */
  | { kind: 'ok'; secret: string }
  /** The link had a fragment, but it is not a capability secret (truncated or altered link). */
  | { kind: 'malformed' }
  /** The link had no fragment (or the page was reloaded after the fragment was removed). */
  | { kind: 'missing' };

/** The parts of `window` this module touches; lets tests pass a stand-in. */
export interface CapabilityWindow {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState' | 'state'>;
}

const ROUTES: readonly { purpose: CapabilityPurpose; pattern: RegExp }[] = [
  { purpose: 'share', pattern: /^\/s\/([^/]+)\/?$/ },
  { purpose: 'invite', pattern: /^\/invite\/([^/]+)\/?$/ },
];

const MISSING: Capability = { kind: 'missing' };

const held = new Map<string, Capability>();
const listeners = new Set<() => void>();
let version = 0;

function keyOf(purpose: CapabilityPurpose, id: string): string {
  return `${purpose}:${id}`;
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function matchCapabilityRoute(
  pathname: string,
): { purpose: CapabilityPurpose; id: string } | null {
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (match?.[1]) return { purpose: route.purpose, id: match[1] };
  }
  return null;
}

/**
 * Reads the fragment and removes it from the address bar in one synchronous
 * step. Any non-empty fragment is removed, including a malformed one: a
 * truncated secret is still not something to leave on screen or in history.
 */
export function takeFragmentSecret(win: CapabilityWindow): Capability {
  const fragment = win.location.hash;
  if (fragment === '' || fragment === '#') return MISSING;
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  const value = fragment.slice(1);
  return isCapabilitySecret(value) ? { kind: 'ok', secret: value } : { kind: 'malformed' };
}

/**
 * Captures the fragment of a share or invitation URL into memory. Safe to call
 * repeatedly: once the fragment is gone, later calls keep what was captured.
 * Fragments on any other route are left alone (they are ordinary anchors).
 */
export function captureCapabilityFragment(win: CapabilityWindow = window): void {
  const route = matchCapabilityRoute(win.location.pathname);
  if (!route) return;
  const capability = takeFragmentSecret(win);
  if (capability.kind === 'missing') return;
  held.set(keyOf(route.purpose, route.id), capability);
  notify();
}

/** What is held for this link right now. Reading does not consume it. */
export function readCapability(purpose: CapabilityPurpose, id: string): Capability {
  return held.get(keyOf(purpose, id)) ?? MISSING;
}

/** Forgets the secret (after a successful exchange, a refusal, or when the screen closes). */
export function dropCapability(purpose: CapabilityPurpose, id: string): void {
  if (held.delete(keyOf(purpose, id))) notify();
}

/** `useSyncExternalStore` wiring: the version changes whenever a capability is captured or dropped. */
export function subscribeToCapabilities(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCapabilityVersion(): number {
  return version;
}

/**
 * Starts watching for fragments that arrive without a page load (the same
 * link pasted into the address bar again). Call once at startup, after the
 * first `captureCapabilityFragment`.
 */
export function watchCapabilityFragments(win: Window = window): () => void {
  const onHashChange = (): void => captureCapabilityFragment(win);
  win.addEventListener('hashchange', onHashChange);
  return () => win.removeEventListener('hashchange', onHashChange);
}

/** Test helper: forget everything. */
export function resetCapabilitiesForTests(): void {
  held.clear();
  version = 0;
}
