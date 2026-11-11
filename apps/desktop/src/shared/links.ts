/**
 * Decisions for the two ways a document reaches the desktop app:
 *
 * - "Open in Desktop": a `realtimedocs://open?server=…&doc=…&code=…` deep link
 *   delivered by the operating system (argv or `open-url`). Any web page can
 *   trigger such a link, so it can never configure the app, switch servers or
 *   cause a request to a server the user did not set.
 * - "Paste Share Link": a `https://server/s/<grant>#<secret>` link typed or
 *   pasted by the user. Switching to the link's server is possible, but only
 *   after explicit confirmation.
 *
 * Pure functions; the network calls live in `src/main/connection-service.ts`.
 */
import { DESKTOP_PROTOCOL, parseDesktopHandoffUrl, parseShareUrl } from '@realtimedocs/contracts';
import {
  classifyLinkOrigin,
  evaluateServerOrigin,
  originHost,
  type LinkOriginContext,
  type OriginPolicyError,
} from './server-origin';

const DEEP_LINK_PREFIX = `${DESKTOP_PROTOCOL}:`;
/** Generous upper bound; real links are about 200 characters. */
const MAX_LINK_LENGTH = 2048;

/**
 * Finds the deep link among process arguments (Windows/Linux pass it as an
 * argument to the first or a second instance). Only the scheme is checked
 * here; the strict parser decides whether the link is acceptable.
 */
export function findDeepLinkArg(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.length > MAX_LINK_LENGTH) continue;
    if (arg.slice(0, DEEP_LINK_PREFIX.length).toLowerCase() === DEEP_LINK_PREFIX) return arg;
  }
  return null;
}

export type DeepLinkRejection = 'invalid_link' | 'no_server_configured' | 'server_mismatch';

export type DeepLinkDecision =
  | { action: 'redeem'; documentId: string; code: string }
  | { action: 'reject'; code: DeepLinkRejection; linkHost: string | null };

export const DEEP_LINK_MESSAGES: Record<DeepLinkRejection, string> = {
  invalid_link: 'The "Open in Desktop" link was not recognised. Nothing was opened.',
  no_server_configured:
    'Set your RealtimeDocs server in Settings before using "Open in Desktop". Nothing was opened.',
  server_mismatch:
    'That "Open in Desktop" link belongs to a different server than the one this app is connected to. Nothing was opened.',
};

/**
 * Validates an "Open in Desktop" link against the configured server. A link
 * for any other origin is rejected without contacting that origin.
 */
export function evaluateDeepLink(input: unknown, context: LinkOriginContext): DeepLinkDecision {
  if (typeof input !== 'string' || input.length > MAX_LINK_LENGTH) {
    return { action: 'reject', code: 'invalid_link', linkHost: null };
  }
  const parsed = parseDesktopHandoffUrl(input);
  if (!parsed) return { action: 'reject', code: 'invalid_link', linkHost: null };
  const linkHost = originHost(parsed.serverOrigin);
  if (!context.serverOrigin) {
    return { action: 'reject', code: 'no_server_configured', linkHost };
  }
  if (classifyLinkOrigin(parsed.serverOrigin, context) === 'mismatch') {
    return { action: 'reject', code: 'server_mismatch', linkHost };
  }
  return { action: 'redeem', documentId: parsed.documentId, code: parsed.code };
}

export type ShareLinkRejection = 'invalid_link' | OriginPolicyError;

export type ShareLinkDecision =
  | { action: 'exchange'; grantId: string; secret: string }
  | {
      action: 'confirm';
      reason: 'different_server' | 'no_server_configured';
      linkOrigin: string;
      grantId: string;
      secret: string;
    }
  | { action: 'reject'; code: ShareLinkRejection; linkOrigin: string | null };

export const SHARE_LINK_INVALID_MESSAGE =
  'That does not look like a RealtimeDocs share link. Paste the complete link, including the part after the # sign.';

/**
 * Validates a pasted share link. When the link belongs to another server the
 * caller must obtain explicit confirmation before switching; the link's
 * origin has to satisfy the same transport policy as a manually entered one.
 */
export function evaluateShareLink(
  input: unknown,
  context: LinkOriginContext,
  options: { allowInsecureLan: boolean },
): ShareLinkDecision {
  if (typeof input !== 'string' || input.length > MAX_LINK_LENGTH) {
    return { action: 'reject', code: 'invalid_link', linkOrigin: null };
  }
  const parsed = parseShareUrl(input);
  if (!parsed) return { action: 'reject', code: 'invalid_link', linkOrigin: null };

  const match = classifyLinkOrigin(parsed.serverOrigin, context);
  if (match !== 'mismatch') {
    return { action: 'exchange', grantId: parsed.grantId, secret: parsed.secret };
  }

  const policy = evaluateServerOrigin(parsed.serverOrigin, options);
  if (!policy.ok) {
    return { action: 'reject', code: policy.code, linkOrigin: parsed.serverOrigin };
  }
  return {
    action: 'confirm',
    reason: context.serverOrigin ? 'different_server' : 'no_server_configured',
    linkOrigin: policy.origin,
    grantId: parsed.grantId,
    secret: parsed.secret,
  };
}

/** Safe description of a link for logs and notices: scheme and host only. */
export function describeLinkForLog(input: unknown): string {
  if (typeof input !== 'string') return '(not a string)';
  try {
    const url = new URL(input.trim());
    return `${url.protocol}//${url.host || '(no host)'}/…`;
  } catch {
    return '(unparseable link)';
  }
}
