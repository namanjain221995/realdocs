import { ApiError, type ShareExchangeRequest } from '@realtimedocs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeShareLink, isFinalShareFailure } from '../src/features/share/exchange';
import { createWebApiClient } from '../src/lib/api';
import {
  captureCapabilityFragment,
  type CapabilityWindow,
  dropCapability,
  getCapabilityVersion,
  matchCapabilityRoute,
  readCapability,
  resetCapabilitiesForTests,
  subscribeToCapabilities,
  takeFragmentSecret,
} from '../src/lib/capability';

const GRANT = '0b3f6f0e-6f0a-4c56-9a53-0d8f4e1b2c3d';
const INVITE = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DOCUMENT = '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9';
/** 43 base64url characters, the shape of a real capability secret. */
const SECRET = 'q7Zr1Vn0sKpX3mT8bJcE5yHdLwA2uGfN9oRiQ4eStU6';
const OTHER_SECRET = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';

/** A stand-in for `window` that records what the address bar would show. */
function fakeWindow(url: string): CapabilityWindow & { href: () => string; calls: string[] } {
  const parsed = new URL(url);
  const calls: string[] = [];
  const location = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
  return {
    location,
    history: {
      state: { idx: 3 },
      replaceState(_state: unknown, _unused: string, next?: string | URL | null) {
        const target = new URL(String(next), parsed.origin);
        calls.push(String(next));
        location.pathname = target.pathname;
        location.search = target.search;
        location.hash = target.hash;
      },
    },
    href: () => `${parsed.origin}${location.pathname}${location.search}${location.hash}`,
    calls,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  resetCapabilitiesForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('takeFragmentSecret', () => {
  it('returns the secret and removes the fragment in the same step', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET}`);
    const result = takeFragmentSecret(win);
    expect(result).toEqual({ kind: 'ok', secret: SECRET });
    expect(win.location.hash).toBe('');
    expect(win.href()).toBe(`https://docs.example.test/s/${GRANT}`);
    expect(win.calls).toEqual([`/s/${GRANT}`]);
  });

  it('keeps the query string and the router state when it cleans the URL', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}?from=mail#${SECRET}`);
    const replaceState = vi.spyOn(win.history, 'replaceState');
    takeFragmentSecret(win);
    expect(replaceState).toHaveBeenCalledWith({ idx: 3 }, '', `/s/${GRANT}?from=mail`);
  });

  it('removes a malformed fragment too, and does not return it', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET.slice(0, 20)}`);
    const result = takeFragmentSecret(win);
    expect(result).toEqual({ kind: 'malformed' });
    expect(win.location.hash).toBe('');
    expect(JSON.stringify(result)).not.toContain(SECRET.slice(0, 20));
  });

  it('reports a missing fragment without touching history', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}`);
    expect(takeFragmentSecret(win)).toEqual({ kind: 'missing' });
    expect(win.calls).toEqual([]);
  });
});

describe('captureCapabilityFragment', () => {
  it('recognises share and invitation routes only', () => {
    expect(matchCapabilityRoute(`/s/${GRANT}`)).toEqual({ purpose: 'share', id: GRANT });
    expect(matchCapabilityRoute(`/invite/${INVITE}/`)).toEqual({ purpose: 'invite', id: INVITE });
    expect(matchCapabilityRoute(`/d/${DOCUMENT}`)).toBeNull();
    expect(matchCapabilityRoute('/settings')).toBeNull();
  });

  it('holds the secret in memory under its link and cleans the address bar', () => {
    const win = fakeWindow(`https://docs.example.test/invite/${INVITE}#${SECRET}`);
    captureCapabilityFragment(win);
    expect(win.location.hash).toBe('');
    expect(readCapability('invite', INVITE)).toEqual({ kind: 'ok', secret: SECRET });
    expect(readCapability('share', INVITE)).toEqual({ kind: 'missing' });
  });

  it('leaves ordinary anchors on other routes alone', () => {
    const win = fakeWindow('https://docs.example.test/settings#recovery-drafts');
    captureCapabilityFragment(win);
    expect(win.location.hash).toBe('#recovery-drafts');
    expect(win.calls).toEqual([]);
  });

  it('keeps what it captured when called again after the fragment is gone', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET}`);
    captureCapabilityFragment(win);
    captureCapabilityFragment(win);
    expect(readCapability('share', GRANT)).toEqual({ kind: 'ok', secret: SECRET });
  });

  it('replaces the held secret when the link is opened again with a new fragment', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET}`);
    const listener = vi.fn();
    const unsubscribe = subscribeToCapabilities(listener);
    captureCapabilityFragment(win);
    const versionAfterFirst = getCapabilityVersion();
    win.location.hash = `#${OTHER_SECRET}`;
    captureCapabilityFragment(win);
    unsubscribe();
    expect(readCapability('share', GRANT)).toEqual({ kind: 'ok', secret: OTHER_SECRET });
    expect(getCapabilityVersion()).toBeGreaterThan(versionAfterFirst);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('forgets the secret on request', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET}`);
    captureCapabilityFragment(win);
    dropCapability('share', GRANT);
    expect(readCapability('share', GRANT)).toEqual({ kind: 'missing' });
  });

  it('never writes the secret to web storage or cookies', () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET}`);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    captureCapabilityFragment(win);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(SECRET);
  });
});

describe('share exchange', () => {
  it('cleans the address bar before the request and sends the secret only in the body', async () => {
    const win = fakeWindow(`https://docs.example.test/s/${GRANT}#${SECRET}`);
    const seen: { addressBar: string; url: string; method: string; body: string }[] = [];
    const client = createWebApiClient((input, init) => {
      seen.push({
        addressBar: win.href(),
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return Promise.resolve(
        jsonResponse(200, {
          documentId: DOCUMENT,
          title: 'Quarterly review notes',
          role: 'viewer',
          expiresAt: null,
        }),
      );
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    captureCapabilityFragment(win);
    const outcome = await exchangeShareLink(
      GRANT,
      readCapability('share', GRANT),
      client.shares.exchange,
    );

    expect(outcome).toEqual({ ok: true, documentId: DOCUMENT });
    expect(seen).toHaveLength(1);
    const request = seen[0];
    // The fragment was already gone when the request left.
    expect(request?.addressBar).toBe(`https://docs.example.test/s/${GRANT}`);
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/api/share/exchange');
    expect(request?.url).not.toContain(SECRET);
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      grantId: GRANT,
      secret: SECRET,
      mode: 'cookie',
    });
    // Nothing persisted, nothing logged.
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    for (const spy of [log, warn, error]) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it('makes no request when the link has no usable secret', async () => {
    const exchange = vi.fn();
    expect(await exchangeShareLink(GRANT, { kind: 'missing' }, exchange)).toEqual({
      ok: false,
      kind: 'incomplete',
    });
    expect(await exchangeShareLink(GRANT, { kind: 'malformed' }, exchange)).toEqual({
      ok: false,
      kind: 'incomplete',
    });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('makes no request for a link id that is not an id', async () => {
    const exchange = vi.fn();
    const outcome = await exchangeShareLink('not-a-uuid', { kind: 'ok', secret: SECRET }, exchange);
    expect(outcome).toEqual({ ok: false, kind: 'invalid' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each([
    ['share_invalid', 404, 'invalid'],
    ['not_found', 404, 'invalid'],
    ['validation_failed', 400, 'invalid'],
    ['share_expired', 410, 'expired'],
    ['share_revoked', 410, 'revoked'],
    ['session_closed', 410, 'session_closed'],
    ['document_trashed', 410, 'document_unavailable'],
    ['server_busy', 503, 'unavailable'],
    ['storage_unavailable', 503, 'unavailable'],
    ['internal', 500, 'unavailable'],
    ['invalid_response', 200, 'unavailable'],
  ] as const)('maps %s to the %s screen', async (code, status, kind) => {
    const exchange = (_body: ShareExchangeRequest) =>
      Promise.reject(new ApiError(code, `server said ${code}`, { status, requestId: 'req-42' }));
    const outcome = await exchangeShareLink(GRANT, { kind: 'ok', secret: SECRET }, exchange);
    expect(outcome).toMatchObject({ ok: false, kind, requestId: 'req-42' });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it('carries the wait time of a rate limit', async () => {
    const exchange = () =>
      Promise.reject(
        new ApiError('rate_limited', 'slow down', { status: 429, retryAfterSeconds: 30 }),
      );
    const outcome = await exchangeShareLink(GRANT, { kind: 'ok', secret: SECRET }, exchange);
    expect(outcome).toEqual({
      ok: false,
      kind: 'rate_limited',
      retryAfterSeconds: 30,
      requestId: undefined,
    });
  });

  it('tells a dead network from an unreachable server', async () => {
    const exchange = () => Promise.reject(new ApiError('network_error', 'Failed to fetch'));
    const capability = { kind: 'ok', secret: SECRET } as const;
    expect(await exchangeShareLink(GRANT, capability, exchange, () => false)).toEqual({
      ok: false,
      kind: 'offline',
    });
    expect(await exchangeShareLink(GRANT, { ...capability }, exchange, () => true)).toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });

  it('never lets the secret into an outcome, even if the server echoes it', async () => {
    const exchange = () =>
      Promise.reject(new ApiError('internal', `boom ${SECRET}`, { status: 500 }));
    const outcome = await exchangeShareLink(GRANT, { kind: 'ok', secret: SECRET }, exchange);
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it('sends one request when asked twice for the same captured secret', async () => {
    let release: (() => void) | undefined;
    const exchange = vi.fn(
      () =>
        new Promise<{ documentId: string; title: string; role: 'viewer'; expiresAt: null }>(
          (resolve) => {
            release = () =>
              resolve({ documentId: DOCUMENT, title: 'Notes', role: 'viewer', expiresAt: null });
          },
        ),
    );
    const capability = { kind: 'ok', secret: SECRET } as const;
    const first = exchangeShareLink(GRANT, capability, exchange);
    const second = exchangeShareLink(GRANT, capability, exchange);
    release?.();
    expect(await first).toEqual({ ok: true, documentId: DOCUMENT });
    expect(await second).toEqual({ ok: true, documentId: DOCUMENT });
    expect(exchange).toHaveBeenCalledTimes(1);
    // A later retry is a new request.
    const retry = exchangeShareLink(GRANT, capability, exchange);
    release?.();
    await retry;
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('knows which failures end the attempt for good', () => {
    expect(isFinalShareFailure('incomplete')).toBe(true);
    expect(isFinalShareFailure('invalid')).toBe(true);
    expect(isFinalShareFailure('expired')).toBe(true);
    expect(isFinalShareFailure('revoked')).toBe(true);
    expect(isFinalShareFailure('session_closed')).toBe(true);
    expect(isFinalShareFailure('document_unavailable')).toBe(true);
    expect(isFinalShareFailure('rate_limited')).toBe(false);
    expect(isFinalShareFailure('offline')).toBe(false);
    expect(isFinalShareFailure('unavailable')).toBe(false);
  });
});

describe('with the real browser objects', () => {
  it('strips the fragment from window.location through history.replaceState', () => {
    window.history.replaceState(null, '', `/s/${GRANT}#${SECRET}`);
    expect(window.location.hash).toBe(`#${SECRET}`);
    captureCapabilityFragment();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(SECRET);
    expect(window.location.pathname).toBe(`/s/${GRANT}`);
    expect(readCapability('share', GRANT)).toEqual({ kind: 'ok', secret: SECRET });
    window.history.replaceState(null, '', '/');
  });
});
