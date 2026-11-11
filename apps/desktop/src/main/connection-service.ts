/**
 * HTTP calls the main process makes on the user's behalf: the server check,
 * the share-link exchange (bearer mode), the "Open in Desktop" redemption and
 * session validation/logout.
 *
 * - Every request goes to the configured origin and nowhere else; the wrapper
 *   refuses any other URL and never follows redirects (a redirect could carry
 *   a share secret or the bearer token to another host).
 * - Requests time out, send no cookies and response bodies are size-capped.
 * - Paths, bodies and response validation come from the shared contract
 *   client (`createApiClient`), so the desktop cannot drift from the API.
 *
 * No Electron import: the network function is injected (`session.fetch` in
 * the app, a fake in unit tests).
 */
import {
  ApiError,
  COLLAB_PROTOCOL_VERSION,
  DESKTOP_APP_ORIGIN,
  DOCUMENT_SCHEMA_VERSION,
  createApiClient,
  normalizeServerOrigin,
  type ApiClient,
  type ClientErrorCode,
} from '@realtimedocs/contracts';
import type { ServerStatus } from '../shared/state';
import type { StoredSession } from './credential-store';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ConnectionServiceOptions {
  fetch: FetchLike;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => Date;
}

export interface ServerCheck {
  status: Extract<ServerStatus, 'ok' | 'unreachable' | 'not_realtimedocs' | 'update_required'>;
  message: string | null;
  serverVersion: string | null;
  publicOrigin: string | null;
}

export type ConnectionFailureCode =
  ClientErrorCode | 'missing_token' | 'document_mismatch' | 'origin_not_allowed';

/**
 * How a main-process request presents itself.
 *
 * - `native`: an ordinary HTTP client request with no `Origin` header. Used
 *   for the server check and for bearer-authenticated calls, which the server
 *   exempts from its origin/CSRF rule.
 * - `desktop-origin`: sends `Origin: app://realtimedocs`, which the server's
 *   rule for unauthenticated mutations (share exchange, handoff redemption)
 *   requires. Chromium then treats the call as cross-origin: it sends a
 *   preflight and the server must allow that origin, exactly as it must for
 *   the panel's own requests.
 */
type RequestIdentity = 'native' | 'desktop-origin';

export type SessionResult =
  | { ok: true; session: StoredSession }
  | { ok: false; code: ConnectionFailureCode; message: string };

export type SessionCheck =
  | { ok: true; title: string; role: StoredSession['role']; expiresAt: string | null }
  /** `ended`: the server says the session is over. Otherwise the check itself failed. */
  | { ok: false; ended: boolean; code: ConnectionFailureCode; message: string };

const MESSAGES: Partial<Record<ConnectionFailureCode, string>> = {
  network_error:
    'The server could not be reached. Check the address, your network connection and that any tunnel or VPN is running.',
  aborted: 'The request was cancelled.',
  invalid_response: 'The server sent a response this app does not understand.',
  share_invalid: 'This share link is not valid. Ask the document owner for a new link.',
  share_expired: 'This share link has expired. Ask the document owner for a new link.',
  share_revoked: 'Access revoked: this share link no longer works.',
  handoff_invalid:
    'The "Open in Desktop" code has expired or was already used. Choose "Open in Desktop" in the browser again.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  unauthenticated:
    'The desktop session has ended. Open the document again from the browser or paste a share link.',
  session_expired:
    'The desktop session has expired. Open the document again from the browser or paste a share link.',
  forbidden: 'Access revoked: this session may no longer open the document.',
  not_found: 'The document is not available.',
  document_trashed: 'The document was moved to the trash.',
  update_required:
    'This version of RealtimeDocs Desktop is too old for the server. Install the current version.',
  server_busy: 'The server is busy. Try again in a moment.',
  storage_unavailable: 'The server cannot reach its storage right now. Try again in a moment.',
  bad_origin:
    'The server refused the desktop app. Its administrator needs to allow the desktop origin (app://realtimedocs).',
  csrf_failed:
    'The server refused the desktop app. Its administrator needs to allow the desktop origin (app://realtimedocs).',
  origin_not_allowed:
    'The server is reachable but refused the desktop app (cross-origin check). Its allowed origins must include app://realtimedocs.',
  missing_token: 'The server did not issue a desktop session.',
  document_mismatch: 'The server answered for a different document.',
};

export function describeFailure(code: ConnectionFailureCode): string {
  return MESSAGES[code] ?? 'The request failed. Try again.';
}

function failureFrom(error: unknown): { code: ConnectionFailureCode; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: describeFailure(error.code) };
  return { code: 'network_error', message: describeFailure('network_error') };
}

/** Session codes that mean "this session is over", as opposed to "could not check". */
const SESSION_ENDED: readonly ConnectionFailureCode[] = [
  'unauthenticated',
  'session_expired',
  'forbidden',
  'not_found',
  'document_trashed',
  'share_expired',
  'share_revoked',
];

export class ConnectionService {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly now: () => Date;

  constructor(options: ConnectionServiceOptions) {
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
    this.now = options.now ?? (() => new Date());
  }

  /** `GET /api/meta`: is this a RealtimeDocs server this client can talk to? */
  async checkServer(origin: string): Promise<ServerCheck> {
    try {
      const meta = await this.client(origin, null, 'native').meta();
      const publicOrigin = normalizeServerOrigin(meta.publicOrigin);
      if (meta.minClientSchemaVersion > DOCUMENT_SCHEMA_VERSION) {
        return {
          status: 'update_required',
          message: describeFailure('update_required'),
          serverVersion: meta.version,
          publicOrigin,
        };
      }
      if (meta.protocolVersion !== COLLAB_PROTOCOL_VERSION) {
        return {
          status: 'update_required',
          message:
            meta.protocolVersion > COLLAB_PROTOCOL_VERSION
              ? describeFailure('update_required')
              : 'The server is older than this app and uses an earlier collaboration protocol. Update the server.',
          serverVersion: meta.version,
          publicOrigin,
        };
      }
      return { status: 'ok', message: null, serverVersion: meta.version, publicOrigin };
    } catch (error) {
      const failure = failureFrom(error);
      if (failure.code === 'network_error' || failure.code === 'aborted') {
        return {
          status: 'unreachable',
          message: failure.message,
          serverVersion: null,
          publicOrigin: null,
        };
      }
      return {
        status: 'not_realtimedocs',
        message: 'That address answered, but not like a RealtimeDocs server. Check the address.',
        serverVersion: null,
        publicOrigin: null,
      };
    }
  }

  /** `POST /api/share/exchange` in bearer mode. The secret travels in the body, to `origin` only. */
  async exchangeShareLink(origin: string, grantId: string, secret: string): Promise<SessionResult> {
    try {
      const response = await this.client(origin, null, 'desktop-origin').shares.exchange({
        grantId,
        secret,
        mode: 'bearer',
      });
      if (!response.token) {
        return { ok: false, code: 'missing_token', message: describeFailure('missing_token') };
      }
      return {
        ok: true,
        session: {
          version: 1,
          serverOrigin: origin,
          documentId: response.documentId,
          token: response.token,
          title: response.title,
          role: response.role,
          expiresAt: response.expiresAt,
          accountId: null,
          via: 'share_link',
          savedAt: this.now().toISOString(),
        },
      };
    } catch (error) {
      return { ok: false, ...(await this.diagnose(origin, error)) };
    }
  }

  /** `POST /api/desktop/redeem`: single-use, short-lived "Open in Desktop" code. */
  async redeemHandoff(origin: string, documentId: string, code: string): Promise<SessionResult> {
    try {
      const response = await this.client(origin, null, 'desktop-origin').desktop.redeem({
        documentId,
        code,
      });
      if (!response.token) {
        return { ok: false, code: 'missing_token', message: describeFailure('missing_token') };
      }
      if (response.documentId !== documentId) {
        return {
          ok: false,
          code: 'document_mismatch',
          message: describeFailure('document_mismatch'),
        };
      }
      return {
        ok: true,
        session: {
          version: 1,
          serverOrigin: origin,
          documentId: response.documentId,
          token: response.token,
          title: response.title,
          role: response.role,
          expiresAt: response.expiresAt,
          accountId: response.accountId,
          via: 'handoff',
          savedAt: this.now().toISOString(),
        },
      };
    } catch (error) {
      return { ok: false, ...(await this.diagnose(origin, error)) };
    }
  }

  /** `GET /api/desktop/session`: is the stored session still valid? */
  async checkSession(session: StoredSession): Promise<SessionCheck> {
    try {
      const response = await this.client(
        session.serverOrigin,
        session.token,
        'native',
      ).desktop.session();
      if (response.documentId !== session.documentId) {
        return {
          ok: false,
          ended: true,
          code: 'document_mismatch',
          message: describeFailure('document_mismatch'),
        };
      }
      return {
        ok: true,
        title: response.title,
        role: response.role,
        expiresAt: response.expiresAt,
      };
    } catch (error) {
      const failure = failureFrom(error);
      return { ok: false, ended: SESSION_ENDED.includes(failure.code), ...failure };
    }
  }

  /** `POST /api/desktop/logout`: best effort; the local copy is discarded regardless. */
  async logout(session: StoredSession): Promise<boolean> {
    try {
      await this.client(session.serverOrigin, session.token, 'native').desktop.logout();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A cross-origin request that the server's origin check refuses fails
   * before any response is readable, which looks like "unreachable". If the
   * server answers a plain request at the same moment, the real cause is the
   * origin check, and the user is told that instead.
   */
  private async diagnose(
    origin: string,
    error: unknown,
  ): Promise<{ code: ConnectionFailureCode; message: string }> {
    const failure = failureFrom(error);
    if (failure.code !== 'network_error') return failure;
    const check = await this.checkServer(origin);
    if (check.status === 'unreachable' || check.status === 'not_realtimedocs') return failure;
    return { code: 'origin_not_allowed', message: describeFailure('origin_not_allowed') };
  }

  private client(origin: string, bearer: string | null, identity: RequestIdentity): ApiClient {
    return createApiClient({
      baseUrl: origin,
      credentials: 'omit',
      fetch: (input, init) => this.guardedFetch(origin, bearer, identity, input, init),
    });
  }

  private async guardedFetch(
    origin: string,
    bearer: string | null,
    identity: RequestIdentity,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): Promise<Response> {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(target);
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) {
      throw new TypeError('Refusing a request outside the configured server API.');
    }
    const headers = new Headers(init?.headers);
    if (identity === 'desktop-origin') headers.set('origin', DESKTOP_APP_ORIGIN);
    else headers.delete('origin');
    headers.delete('cookie');
    if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    else headers.delete('authorization');

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await this.fetchImpl(url.href, {
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    });
    return this.capped(response);
  }

  /** Re-wraps the response with a bounded body so a hostile server cannot exhaust memory. */
  private async capped(response: Response): Promise<Response> {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new TypeError('Response too large.');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw new TypeError('Response too large.');
        }
        chunks.push(value);
      }
    }
    const body = total > 0 ? Buffer.concat(chunks, total) : null;
    // 204/304 must not carry a body.
    const nullBody = response.status === 204 || response.status === 304;
    return new Response(nullBody ? null : body, {
      status: response.status,
      headers: response.headers,
    });
  }
}
