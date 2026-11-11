/**
 * Decides, for one outgoing renderer request, whether the desktop session's
 * bearer token is attached. Pure: the Electron `webRequest` glue in
 * `session-security.ts` calls this for every request and applies the result.
 *
 * The token is attached only when ALL of these hold:
 * - a session token exists;
 * - the request URL is http(s) and its origin is exactly the configured
 *   server origin (string equality of `URL.origin`: look-alike hosts, other
 *   ports, other schemes and user-info tricks never match);
 * - the path is under `/api/`;
 * - it is not a WebSocket handshake (collaboration authenticates with a
 *   single-use ticket inside the socket, never with the session token);
 * - it is not an `OPTIONS` request. Chromium's cross-origin preflights pass
 *   through this listener too, and a preflight must never carry credentials;
 * - the request was issued by the packaged renderer (`app://realtimedocs`);
 * - the request has not been redirected. The listener runs again for every
 *   hop of a redirect; from the second hop on the token is never attached,
 *   wherever the redirect points, including another API path of the same
 *   server. The server's API does not redirect, so a redirect is unexpected
 *   and the request simply continues without credentials.
 *
 * In every other case any `Authorization` header already on the request is
 * removed, so a token attached for the first hop cannot travel with a
 * redirect either.
 */
import { DESKTOP_APP_ORIGIN } from '@realtimedocs/contracts';

export interface OutgoingRequest {
  url: string;
  /** HTTP method. */
  method: string;
  /** Electron `resourceType` (`xhr`, `image`, `webSocket`, `mainFrame`, …). */
  resourceType: string;
  /** Origin that issued the request; undefined for browser-initiated requests. */
  initiatorOrigin?: string | undefined;
  /** True when this is the second or a later hop of a redirected request. */
  redirected?: boolean | undefined;
  requestHeaders: Record<string, string>;
}

export interface AuthContext {
  serverOrigin: string | null;
  token: string | null;
}

export type AuthDecisionReason =
  | 'attached'
  | 'no_session'
  | 'bad_url'
  | 'not_http'
  | 'foreign_origin'
  | 'not_api_path'
  | 'websocket'
  | 'preflight'
  | 'foreign_initiator'
  | 'redirected';

export interface AuthDecision {
  attach: boolean;
  reason: AuthDecisionReason;
  /** Headers to send. Always free of a stale `Authorization` unless `attach` is true. */
  requestHeaders: Record<string, string>;
  /** True when the returned headers differ from the input. */
  changed: boolean;
}

function withoutAuthorization(headers: Record<string, string>): {
  headers: Record<string, string>;
  removed: boolean;
} {
  const result: Record<string, string> = {};
  let removed = false;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'authorization') {
      removed = true;
      continue;
    }
    result[name] = value;
  }
  return { headers: result, removed };
}

export function classifyRequest(
  request: OutgoingRequest,
  context: AuthContext,
): AuthDecisionReason {
  if (!context.token || !context.serverOrigin) return 'no_session';
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'bad_url';
  }
  if (request.resourceType === 'webSocket' || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return 'websocket';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'not_http';
  if (url.origin !== context.serverOrigin) return 'foreign_origin';
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return 'not_api_path';
  if (request.method.toUpperCase() === 'OPTIONS') return 'preflight';
  if (request.initiatorOrigin !== DESKTOP_APP_ORIGIN) return 'foreign_initiator';
  if (request.redirected === true) return 'redirected';
  return 'attached';
}

export function decideAuthorization(request: OutgoingRequest, context: AuthContext): AuthDecision {
  const reason = classifyRequest(request, context);
  const stripped = withoutAuthorization(request.requestHeaders);
  if (reason !== 'attached' || !context.token) {
    return {
      attach: false,
      reason,
      requestHeaders: stripped.headers,
      changed: stripped.removed,
    };
  }
  return {
    attach: true,
    reason,
    requestHeaders: { ...stripped.headers, Authorization: `Bearer ${context.token}` },
    changed: true,
  };
}
