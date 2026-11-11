import { ApiError, CSRF_HEADER } from '@realtimedocs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  createWebApiClient,
  getCsrfToken,
  rememberSession,
  setCsrfToken,
} from '../src/lib/api';
import { retryDelay, shouldRetryQuery } from '../src/lib/queryClient';
import { fetchSession } from '../src/lib/session';

const USER = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'asha@example.test',
  displayName: 'Asha Rao',
  role: 'admin',
  status: 'active',
  createdAt: '2026-10-01T09:00:00.000Z',
} as const;
const DOCUMENT = '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
  referrerPolicy: ReferrerPolicy | undefined;
}

function recordingFetch(respond: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake: typeof fetch = (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      credentials: init?.credentials,
      referrerPolicy: init?.referrerPolicy,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { fetch: fake, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setCsrfToken(null);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CSRF token wiring', () => {
  it('takes the token from the session response and sends it on unsafe requests', async () => {
    const { fetch: fake, calls } = recordingFetch((call) => {
      if (call.url === '/api/auth/session') {
        return json(200, {
          user: USER,
          csrfToken: 'csrf-token-from-session',
          expiresAt: '2026-11-11T09:00:00.000Z',
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fake);

    await fetchSession();
    expect(getCsrfToken()).toBe('csrf-token-from-session');

    await api.auth.logout();
    await api.documents.deletePermanently(DOCUMENT);
    await api.invitations.revoke(DOCUMENT);

    const [session, logout, remove, revoke] = calls;
    // Reads never carry the header.
    expect(session?.method).toBe('GET');
    expect(session?.headers).not.toHaveProperty(CSRF_HEADER);
    for (const call of [logout, remove, revoke]) {
      expect(call?.headers[CSRF_HEADER]).toBe('csrf-token-from-session');
    }
    expect(logout?.method).toBe('POST');
    expect(remove?.method).toBe('DELETE');
  });

  it('sends the token on PUT and PATCH as well', async () => {
    setCsrfToken('tok');
    const { fetch: fake, calls } = recordingFetch((call) =>
      call.method === 'PUT' ? json(200, { members: [] }) : json(200, { users: [] }),
    );
    const client = createWebApiClient(fake);
    await client.members.set(DOCUMENT, USER.id, { role: 'editor' });
    await client.users.update(USER.id, { role: 'member' });
    expect(calls.map((call) => [call.method, call.headers[CSRF_HEADER]])).toEqual([
      ['PUT', 'tok'],
      ['PATCH', 'tok'],
    ]);
  });

  it('falls back to the placeholder value for guests, who have no session token', async () => {
    const { fetch: fake, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const client = createWebApiClient(fake);
    await client.shares.endGuestSession(DOCUMENT);
    expect(calls[0]?.headers[CSRF_HEADER]).toBe('1');
  });

  it('follows the token of every session response it is shown', () => {
    rememberSession({ user: USER, csrfToken: 'after-login', expiresAt: null });
    expect(getCsrfToken()).toBe('after-login');
    rememberSession({ user: null, csrfToken: null, expiresAt: null });
    expect(getCsrfToken()).toBeNull();
  });

  it('keeps the token in memory only', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { fetch: fake } = recordingFetch(() =>
      json(200, { user: USER, csrfToken: 'memory-only', expiresAt: null }),
    );
    vi.stubGlobal('fetch', fake);
    await fetchSession();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('memory-only');
  });

  it('talks to its own origin with cookies and without a referrer', async () => {
    const { fetch: fake, calls } = recordingFetch(() => json(200, { documents: [] }));
    const client = createWebApiClient(fake);
    await client.documents.list({ view: 'archived', q: 'plan' });
    expect(calls[0]?.url).toBe('/api/documents?view=archived&q=plan');
    expect(calls[0]?.credentials).toBe('same-origin');
    expect(calls[0]?.referrerPolicy).toBe('no-referrer');
  });
});

describe('query retry rules', () => {
  const error = (code: ConstructorParameters<typeof ApiError>[0], status: number) =>
    new ApiError(code, code, { status });

  it('never retries a 4xx answer', () => {
    for (const [code, status] of [
      ['validation_failed', 400],
      ['unauthenticated', 401],
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['document_trashed', 410],
      ['rate_limited', 429],
    ] as const) {
      expect(shouldRetryQuery(0, error(code, status))).toBe(false);
    }
  });

  it('retries outages twice, then gives up', () => {
    for (const failure of [
      error('internal', 500),
      error('server_busy', 503),
      new ApiError('network_error', 'Failed to fetch'),
    ]) {
      expect(shouldRetryQuery(0, failure)).toBe(true);
      expect(shouldRetryQuery(1, failure)).toBe(true);
      expect(shouldRetryQuery(2, failure)).toBe(false);
    }
  });

  it('does not retry cancellations or responses that break the contract', () => {
    expect(shouldRetryQuery(0, new ApiError('aborted', 'cancelled'))).toBe(false);
    expect(shouldRetryQuery(0, error('invalid_response', 200))).toBe(false);
  });

  it('backs off between attempts, with a ceiling', () => {
    expect(retryDelay(0)).toBeLessThan(retryDelay(1));
    expect(retryDelay(1)).toBeLessThan(retryDelay(2));
    expect(retryDelay(20)).toBe(5000);
  });
});
