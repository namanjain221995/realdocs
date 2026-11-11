/**
 * The web app's API client.
 *
 * Same-origin requests with cookies. The per-session CSRF token comes from
 * `GET /api/auth/session` (and from login / invitation accept / profile
 * update, which return the same shape) and lives in this module's memory
 * only. It is never written to storage.
 */
import { type ApiClient, createApiClient, type SessionResponse } from '@realtimedocs/contracts';

let csrfToken: string | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Records the CSRF token of a session response and returns the response unchanged. */
export function rememberSession<T extends SessionResponse>(session: T): T {
  setCsrfToken(session.csrfToken);
  return session;
}

/** Builds a client. `fetchImpl` exists for tests; the app uses the global `fetch`. */
export function createWebApiClient(fetchImpl?: typeof fetch): ApiClient {
  return createApiClient({
    baseUrl: '',
    credentials: 'same-origin',
    getCsrfToken,
    fetch: fetchImpl,
  });
}

export const api: ApiClient = createWebApiClient();
