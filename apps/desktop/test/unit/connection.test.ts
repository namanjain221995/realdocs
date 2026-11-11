import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDesktopHandoffUrl, buildShareUrl } from '@realtimedocs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionController,
  type RequestSource,
  type ServerChangeRequest,
} from '../../src/main/connection-controller';
import { ConnectionService, type FetchLike } from '../../src/main/connection-service';
import { CredentialStore, type EncryptionAdapter } from '../../src/main/credential-store';
import {
  defaultPreferences,
  sanitizePreferences,
  type Preferences,
} from '../../src/shared/preferences';

const SERVER = 'https://docs.example.com';
const OTHER = 'https://other.example';
const DOC = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
const GRANT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SECRET = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const TOKEN = 'desktop-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: RequestRedirect | undefined;
  credentials: RequestCredentials | undefined;
}

type Route = (request: Recorded) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function apiError(status: number, code: string): Response {
  return json(status, { error: { code, message: 'server said no' } });
}

const META = {
  name: 'RealtimeDocs',
  version: '0.1.0',
  schemaVersion: 1,
  minClientSchemaVersion: 1,
  protocolVersion: 1,
  publicOrigin: SERVER,
  limits: {},
  imageMimeTypes: [],
  attachmentExtensions: [],
};

/** A fake network: every request is recorded; unknown URLs fail like an unreachable host. */
function fakeNetwork(routes: Record<string, Route>) {
  const requests: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    const recorded: Recorded = {
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      redirect: init.redirect,
      credentials: init.credentials,
    };
    requests.push(recorded);
    const parsed = new URL(url);
    const route = routes[`${recorded.method} ${parsed.origin}${parsed.pathname}`];
    if (!route) throw new TypeError('fetch failed');
    return route(recorded);
  };
  return { fetch, requests };
}

const memoryEncryption: EncryptionAdapter = {
  availability: () => Promise.resolve({ available: true, backend: null, detail: 'test store' }),
  encrypt: (plain) => Promise.resolve(Buffer.from(plain, 'utf8').reverse()),
  decrypt: (data) => Promise.resolve(Buffer.from(data).reverse().toString('utf8')),
};

describe('connection service', () => {
  it('checks /api/meta as a plain native request: no credentials, no redirects, no Origin', async () => {
    const network = fakeNetwork({ [`GET ${SERVER}/api/meta`]: () => json(200, META) });
    const service = new ConnectionService({ fetch: network.fetch });
    expect(await service.checkServer(SERVER)).toEqual({
      status: 'ok',
      message: null,
      serverVersion: '0.1.0',
      publicOrigin: SERVER,
    });
    expect(network.requests[0]).toMatchObject({ redirect: 'error', credentials: 'omit' });
    // No Origin: the check must work against any server, whatever its cross-origin settings.
    expect(network.requests[0]?.headers.origin).toBeUndefined();
    expect(network.requests[0]?.headers.authorization).toBeUndefined();
    expect(network.requests[0]?.headers.cookie).toBeUndefined();
  });

  it.each([
    ['an unreachable host', {}, 'unreachable'],
    [
      'a web server that is not RealtimeDocs',
      { [`GET ${SERVER}/api/meta`]: () => new Response('<html>hi</html>', { status: 200 }) },
      'not_realtimedocs',
    ],
    [
      'a look-alike product',
      { [`GET ${SERVER}/api/meta`]: () => json(200, { ...META, name: 'SomethingElse' }) },
      'not_realtimedocs',
    ],
    [
      'a 404',
      { [`GET ${SERVER}/api/meta`]: () => new Response('nope', { status: 404 }) },
      'not_realtimedocs',
    ],
    [
      'a newer server schema',
      { [`GET ${SERVER}/api/meta`]: () => json(200, { ...META, minClientSchemaVersion: 99 }) },
      'update_required',
    ],
    [
      'another collaboration protocol',
      { [`GET ${SERVER}/api/meta`]: () => json(200, { ...META, protocolVersion: 2 }) },
      'update_required',
    ],
  ] as [string, Record<string, Route>, string][])('reports %s', async (_name, routes, status) => {
    const service = new ConnectionService({ fetch: fakeNetwork(routes).fetch });
    expect((await service.checkServer(SERVER)).status).toBe(status);
  });

  it('refuses oversized responses', async () => {
    const huge = 'x'.repeat(400 * 1024);
    const network = fakeNetwork({
      [`GET ${SERVER}/api/meta`]: () => json(200, { ...META, version: huge }),
    });
    const service = new ConnectionService({ fetch: network.fetch });
    expect((await service.checkServer(SERVER)).status).toBe('unreachable');
  });

  it('times out instead of hanging', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('timed out', 'TimeoutError')),
        );
      });
    const service = new ConnectionService({ fetch, timeoutMs: 30 });
    expect((await service.checkServer(SERVER)).status).toBe('unreachable');
  });

  it('exchanges a share link in bearer mode with the secret in the body only', async () => {
    const network = fakeNetwork({
      [`POST ${SERVER}/api/share/exchange`]: () =>
        json(200, {
          documentId: DOC,
          title: 'Notes',
          role: 'viewer',
          expiresAt: null,
          token: TOKEN,
        }),
    });
    const service = new ConnectionService({ fetch: network.fetch });
    const result = await service.exchangeShareLink(SERVER, GRANT, SECRET);
    expect(result).toMatchObject({
      ok: true,
      session: { token: TOKEN, via: 'share_link', accountId: null, role: 'viewer' },
    });
    const request = network.requests[0];
    expect(request?.body).toEqual({ grantId: GRANT, secret: SECRET, mode: 'bearer' });
    expect(request?.url).toBe(`${SERVER}/api/share/exchange`);
    expect(request?.url).not.toContain(SECRET);
    // Unauthenticated mutations identify as the desktop app for the server's origin rule.
    expect(request?.headers.origin).toBe('app://realtimedocs');
    expect(request?.headers.authorization).toBeUndefined();
    expect(request).toMatchObject({ redirect: 'error', credentials: 'omit' });
  });

  it('tells a refused origin check apart from an unreachable server', async () => {
    // The cross-origin request fails before any response is readable...
    const refusing = fakeNetwork({
      [`POST ${SERVER}/api/share/exchange`]: () => {
        throw new TypeError('Failed to fetch');
      },
      [`POST ${SERVER}/api/desktop/redeem`]: () => {
        throw new TypeError('Failed to fetch');
      },
      // ...while a plain request is answered: the server is there.
      [`GET ${SERVER}/api/meta`]: () => json(200, META),
    });
    const service = new ConnectionService({ fetch: refusing.fetch });
    const exchange = await service.exchangeShareLink(SERVER, GRANT, SECRET);
    expect(exchange).toMatchObject({ ok: false, code: 'origin_not_allowed' });
    if (!exchange.ok) expect(exchange.message).toContain('app://realtimedocs');
    expect(await service.redeemHandoff(SERVER, DOC, SECRET)).toMatchObject({
      ok: false,
      code: 'origin_not_allowed',
    });

    // Nothing answers at all: it really is unreachable.
    const down = new ConnectionService({ fetch: fakeNetwork({}).fetch });
    expect(await down.exchangeShareLink(SERVER, GRANT, SECRET)).toMatchObject({
      ok: false,
      code: 'network_error',
    });
    expect(await down.redeemHandoff(SERVER, DOC, SECRET)).toMatchObject({
      ok: false,
      code: 'network_error',
    });
  });

  it.each([
    [404, 'share_invalid'],
    [410, 'share_expired'],
    [410, 'share_revoked'],
    [429, 'rate_limited'],
  ])('maps HTTP %i %s to a displayable failure', async (status, code) => {
    const network = fakeNetwork({
      [`POST ${SERVER}/api/share/exchange`]: () => apiError(status, code),
    });
    const result = await new ConnectionService({ fetch: network.fetch }).exchangeShareLink(
      SERVER,
      GRANT,
      SECRET,
    );
    expect(result).toMatchObject({ ok: false, code });
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(10);
      expect(result.message).not.toContain('server said no');
      expect(result.message).not.toContain(SECRET);
    }
  });

  it('rejects an exchange response without a token', async () => {
    const network = fakeNetwork({
      [`POST ${SERVER}/api/share/exchange`]: () =>
        json(200, { documentId: DOC, title: 'Notes', role: 'viewer', expiresAt: null }),
    });
    expect(
      await new ConnectionService({ fetch: network.fetch }).exchangeShareLink(
        SERVER,
        GRANT,
        SECRET,
      ),
    ).toMatchObject({
      ok: false,
      code: 'missing_token',
    });
  });

  it('redeems a handoff code and rejects an answer for another document', async () => {
    const good = fakeNetwork({
      [`POST ${SERVER}/api/desktop/redeem`]: () =>
        json(200, {
          token: TOKEN,
          documentId: DOC,
          title: 'Notes',
          role: 'editor',
          expiresAt: null,
          accountId: GRANT,
        }),
    });
    expect(
      await new ConnectionService({ fetch: good.fetch }).redeemHandoff(SERVER, DOC, SECRET),
    ).toMatchObject({
      ok: true,
      session: { via: 'handoff', role: 'editor', accountId: GRANT },
    });
    expect(good.requests[0]?.body).toEqual({ documentId: DOC, code: SECRET });
    expect(good.requests[0]?.headers.origin).toBe('app://realtimedocs');
    expect(good.requests[0]?.headers.authorization).toBeUndefined();

    const swapped = fakeNetwork({
      [`POST ${SERVER}/api/desktop/redeem`]: () =>
        json(200, {
          token: TOKEN,
          documentId: GRANT,
          title: 'Other',
          role: 'admin',
          expiresAt: null,
          accountId: null,
        }),
    });
    expect(
      await new ConnectionService({ fetch: swapped.fetch }).redeemHandoff(SERVER, DOC, SECRET),
    ).toMatchObject({
      ok: false,
      code: 'document_mismatch',
    });
  });

  it('sends the bearer token only on session calls, to the session origin', async () => {
    const network = fakeNetwork({
      [`GET ${SERVER}/api/desktop/session`]: () =>
        json(200, {
          documentId: DOC,
          title: 'Renamed',
          role: 'viewer',
          expiresAt: null,
          accountId: null,
        }),
      [`POST ${SERVER}/api/desktop/logout`]: () => new Response(null, { status: 204 }),
    });
    const service = new ConnectionService({ fetch: network.fetch });
    const stored = {
      version: 1 as const,
      serverOrigin: SERVER,
      documentId: DOC,
      token: TOKEN,
      title: 'Notes',
      role: 'viewer' as const,
      expiresAt: null,
      accountId: null,
      via: 'share_link' as const,
      savedAt: '2026-11-10T10:00:00.000Z',
    };
    expect(await service.checkSession(stored)).toMatchObject({ ok: true, title: 'Renamed' });
    expect(await service.logout(stored)).toBe(true);
    expect(network.requests.map((request) => request.headers.authorization)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
    expect(
      network.requests.every((request) => request.url.startsWith(`${SERVER}/api/desktop/`)),
    ).toBe(true);
    // Bearer calls are plain native requests (exempt from the origin rule): no Origin, so no preflight.
    expect(network.requests.every((request) => request.headers.origin === undefined)).toBe(true);
  });

  it('distinguishes "session ended" from "could not check"', async () => {
    const stored = {
      version: 1 as const,
      serverOrigin: SERVER,
      documentId: DOC,
      token: TOKEN,
      title: 'Notes',
      role: 'viewer' as const,
      expiresAt: null,
      accountId: null,
      via: 'share_link' as const,
      savedAt: '2026-11-10T10:00:00.000Z',
    };
    const ended = new ConnectionService({
      fetch: fakeNetwork({
        [`GET ${SERVER}/api/desktop/session`]: () => apiError(401, 'unauthenticated'),
      }).fetch,
    });
    expect(await ended.checkSession(stored)).toMatchObject({ ok: false, ended: true });
    const offline = new ConnectionService({ fetch: fakeNetwork({}).fetch });
    expect(await offline.checkSession(stored)).toMatchObject({
      ok: false,
      ended: false,
      code: 'network_error',
    });
    const busy = new ConnectionService({
      fetch: fakeNetwork({
        [`GET ${SERVER}/api/desktop/session`]: () => apiError(503, 'server_busy'),
      }).fetch,
    });
    expect(await busy.checkSession(stored)).toMatchObject({ ok: false, ended: false });
  });
});

describe('connection controller', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rd-conn-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function setup(
    routes: Record<string, Route>,
    connection: Partial<Preferences['connection']> = { serverOrigin: SERVER },
    options: { now?: () => number; confirmTimeoutMs?: number } = {},
  ) {
    let preferences = sanitizePreferences(
      {
        ...defaultPreferences('win32'),
        connection: { ...defaultPreferences('win32').connection, ...connection },
      },
      'win32',
    ).preferences;
    const port = {
      get: () => preferences,
      update: (change: (current: Preferences) => Preferences) => {
        preferences = sanitizePreferences(change(preferences), 'win32').preferences;
        return preferences;
      },
    };
    const network = fakeNetwork(routes);
    const credentials = new CredentialStore({
      filePath: path.join(directory, 'session.bin'),
      encryption: memoryEncryption,
    });
    await credentials.init();
    const order: string[] = [];
    /** The user's answer to "use another server?"; null = the question must not be asked. */
    const answer: { value: boolean | null } = { value: null };
    const events = {
      change: vi.fn(),
      confirm: vi.fn(
        (request: ServerChangeRequest, source: RequestSource, withdrawn: AbortSignal) => {
          void request;
          void source;
          void withdrawn;
          if (answer.value === null) throw new Error('the question was asked unexpectedly');
          return Promise.resolve(answer.value);
        },
      ),
      serverChanging: vi.fn(async () => {
        // What the app does here (clearing stored data) must see the previous origin.
        order.push(`changing from ${String(port.get().connection.serverOrigin)}`);
        await Promise.resolve();
      }),
      serverChanged: vi.fn(() => {
        order.push(`changed to ${String(port.get().connection.serverOrigin)}`);
      }),
      reveal: vi.fn(),
      sessionClosed: vi.fn(),
      order,
    };
    const controller = new ConnectionController({
      service: new ConnectionService({ fetch: network.fetch }),
      credentials,
      preferences: port,
      confirmServerChange: events.confirm,
      onChange: events.change,
      onServerChanging: events.serverChanging,
      onServerChanged: events.serverChanged,
      onSessionClosed: events.sessionClosed,
      onReveal: events.reveal,
      ...(options.now ? { now: options.now } : {}),
      ...(options.confirmTimeoutMs ? { confirmTimeoutMs: options.confirmTimeoutMs } : {}),
    });
    return { controller, credentials, network, events, preferences: port, answer };
  }

  const exchangeOk: Route = () =>
    json(200, { documentId: DOC, title: 'Notes', role: 'viewer', expiresAt: null, token: TOKEN });
  const redeemOk: Route = () =>
    json(200, {
      token: TOKEN,
      documentId: DOC,
      title: 'Notes',
      role: 'editor',
      expiresAt: null,
      accountId: GRANT,
    });
  const handoff = (server = SERVER) =>
    buildDesktopHandoffUrl({ serverOrigin: server, documentId: DOC, code: SECRET });

  it('opens a pasted link for the configured server and never exposes the token in the snapshot', async () => {
    const { controller, events } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    const snapshot = controller.snapshot();
    expect(snapshot.session).toEqual({
      documentId: DOC,
      title: 'Notes',
      role: 'viewer',
      expiresAt: null,
      accountId: null,
      via: 'share_link',
      restored: false,
      sequence: 1,
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(SECRET);
    expect(controller.authContext()).toEqual({ serverOrigin: SERVER, token: TOKEN });
    expect(events.reveal).toHaveBeenCalled();
  });

  it('rejects an invalid pasted link with a clear error and no request', async () => {
    const { controller, network } = await setup({});
    await expect(controller.openShareLink('https://docs.example.com/s/nope')).rejects.toMatchObject(
      {
        code: 'invalid_link',
      },
    );
    expect(network.requests).toHaveLength(0);
  });

  it('asks before using another server, and contacts nobody until the answer is yes', async () => {
    const { controller, network, preferences, events } = await setup({
      [`GET ${OTHER}/api/meta`]: () => json(200, { ...META, publicOrigin: OTHER }),
      [`POST ${OTHER}/api/share/exchange`]: exchangeOk,
    });
    // While the question is open: nothing was sent, nothing changed, and the
    // snapshot that goes to the windows holds neither the secret nor a way to answer.
    const whileOpen: { requests: number; origin: string | null; snapshot: string }[] = [];
    events.confirm.mockImplementationOnce(() => {
      whileOpen.push({
        requests: network.requests.length,
        origin: preferences.get().connection.serverOrigin,
        snapshot: JSON.stringify(controller.snapshot()),
      });
      return Promise.resolve(true);
    });
    await controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'settings');

    expect(events.confirm).toHaveBeenCalledExactlyOnceWith(
      { kind: 'switch_server', linkOrigin: OTHER, currentOrigin: SERVER },
      'settings',
      expect.any(AbortSignal),
    );
    expect(whileOpen).toHaveLength(1);
    expect(whileOpen[0]).toMatchObject({ requests: 0, origin: SERVER });
    expect(whileOpen[0]?.snapshot).not.toContain(SECRET);
    expect(whileOpen[0]?.snapshot).toContain('"busy":"confirming"');
    expect(preferences.get().connection.serverOrigin).toBe(OTHER);
    expect(network.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${OTHER}/api/meta`,
      `POST ${OTHER}/api/share/exchange`,
    ]);
    expect(controller.snapshot().session?.documentId).toBe(DOC);
    expect(controller.snapshot().busy).toBeNull();
  });

  it('asks before using the first server as well', async () => {
    const { controller, events, answer, preferences } = await setup(
      {
        [`GET ${SERVER}/api/meta`]: () => json(200, META),
        [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      },
      { serverOrigin: null },
    );
    answer.value = true;
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET), 'panel');
    expect(events.confirm).toHaveBeenCalledExactlyOnceWith(
      { kind: 'set_server', linkOrigin: SERVER, currentOrigin: null },
      'panel',
      expect.any(AbortSignal),
    );
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);
    expect(controller.snapshot().session?.documentId).toBe(DOC);
  });

  it('changes nothing when the answer is no, and does not ask again right away', async () => {
    let now = Date.parse('2026-11-10T10:00:00.000Z');
    const { controller, network, preferences, events, answer } = await setup(
      {},
      { serverOrigin: SERVER },
      { now: () => now },
    );
    answer.value = false;
    await controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'panel');
    expect(events.confirm).toHaveBeenCalledTimes(1);
    expect(network.requests).toHaveLength(0);
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);
    expect(controller.snapshot()).toMatchObject({ session: null, busy: null });

    // A page asking again in a loop gets a refusal, not another dialog.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      now += 500;
      await expect(
        controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'panel'),
      ).rejects.toMatchObject({ code: 'declined' });
    }
    expect(events.confirm).toHaveBeenCalledTimes(1);
    // Later the user may be asked again (they pasted the link once more).
    now += 15_000;
    await controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'panel');
    expect(events.confirm).toHaveBeenCalledTimes(2);
    expect(network.requests).toHaveLength(0);
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);
  });

  it('treats a failing question as a no', async () => {
    const { controller, network, preferences, events } = await setup({});
    events.confirm.mockImplementationOnce(() => Promise.reject(new Error('no window to ask in')));
    await expect(
      controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'settings'),
    ).rejects.toThrow('no window to ask in');
    expect(network.requests).toHaveLength(0);
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);
    expect(controller.snapshot().busy).toBeNull();
  });

  it('withdraws a question nobody answers; a late yes then changes nothing', async () => {
    const { controller, network, preferences, events } = await setup(
      {
        [`GET ${OTHER}/api/meta`]: () => json(200, { ...META, publicOrigin: OTHER }),
        [`POST ${OTHER}/api/share/exchange`]: exchangeOk,
      },
      { serverOrigin: SERVER },
      { confirmTimeoutMs: 30 },
    );
    const asked: { withdrawn: AbortSignal; answer: (value: boolean) => void }[] = [];
    events.confirm.mockImplementationOnce(
      (_request, _source, withdrawn) =>
        new Promise<boolean>((resolve) => {
          asked.push({ withdrawn, answer: resolve });
        }),
    );
    await controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'settings');

    // The dialog was told to close, and the user is told what happened.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.withdrawn.aborted).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      busy: null,
      session: null,
      notice: { code: 'confirmation_expired', tone: 'info' },
    });
    expect(controller.snapshot().notice?.message).toContain('other.example');
    expect(JSON.stringify(controller.snapshot())).not.toContain(SECRET);

    // A dialog that answers "yes" after that is too late.
    asked[0]?.answer(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);
    expect(network.requests).toHaveLength(0);
    expect(controller.snapshot().session).toBeNull();
  });

  it('asks one question at a time', async () => {
    const { controller, events, network } = await setup({});
    const open: ((value: boolean) => void)[] = [];
    events.confirm.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          open.push(resolve);
        }),
    );
    const first = controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'panel');
    await vi.waitFor(() => expect(controller.snapshot().busy).toBe('confirming'));
    await expect(
      controller.openShareLink(buildShareUrl('https://third.example', GRANT, SECRET), 'panel'),
    ).rejects.toMatchObject({ code: 'confirmation_open' });
    open[0]?.(false);
    await first;
    expect(events.confirm).toHaveBeenCalledTimes(1);
    expect(network.requests).toHaveLength(0);
  });

  it('never changes the server without a way to ask (the default answer is no)', async () => {
    const network = fakeNetwork({});
    const credentials = new CredentialStore({
      filePath: path.join(directory, 'session.bin'),
      encryption: memoryEncryption,
    });
    await credentials.init();
    let preferences = sanitizePreferences(
      {
        ...defaultPreferences('win32'),
        connection: { ...defaultPreferences('win32').connection, serverOrigin: SERVER },
      },
      'win32',
    ).preferences;
    const controller = new ConnectionController({
      service: new ConnectionService({ fetch: network.fetch }),
      credentials,
      preferences: {
        get: () => preferences,
        update: (change) => {
          preferences = sanitizePreferences(change(preferences), 'win32').preferences;
          return preferences;
        },
      },
      onChange: () => undefined,
      onServerChanged: () => undefined,
      onReveal: () => undefined,
    });
    await controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'settings');
    expect(preferences.connection.serverOrigin).toBe(SERVER);
    expect(network.requests).toHaveLength(0);
  });

  it('lets nothing in the panel replace an open document or the server', async () => {
    const { controller, network, preferences, events, answer } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`POST ${SERVER}/api/desktop/logout`]: () => new Response(null, { status: 204 }),
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET), 'panel');
    const session = controller.snapshot().session;
    expect(session).not.toBeNull();
    const before = network.requests.length;
    // Even a user who would say yes is not asked.
    answer.value = true;

    // Another document on the same server, and a link for another server: both refused,
    // with no question asked and no request made.
    for (const link of [
      buildShareUrl(SERVER, 'aaaaaaaa-7425-40de-944b-e07fc1f90ae7', SECRET),
      buildShareUrl(OTHER, GRANT, SECRET),
    ]) {
      await expect(controller.openShareLink(link, 'panel')).rejects.toMatchObject({
        code: 'document_open',
      });
    }
    expect(events.confirm).not.toHaveBeenCalled();
    expect(network.requests).toHaveLength(before);
    expect(controller.snapshot().session).toEqual(session);
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);

    // The settings window, which never shows document content, may open another link.
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET), 'settings');
    expect(controller.snapshot().session?.sequence).toBeGreaterThan(session?.sequence ?? 0);
  });

  it('does not send the secret to a server that fails the RealtimeDocs check', async () => {
    const { controller, network, answer } = await setup({
      [`GET ${OTHER}/api/meta`]: () => new Response('<html>phishing</html>', { status: 200 }),
      [`POST ${OTHER}/api/share/exchange`]: exchangeOk,
    });
    answer.value = true;
    await expect(
      controller.openShareLink(buildShareUrl(OTHER, GRANT, SECRET), 'settings'),
    ).rejects.toMatchObject({
      code: 'server_check_failed',
    });
    expect(network.requests.map((request) => request.method)).toEqual(['GET']);
    expect(controller.snapshot().session).toBeNull();
    // The panel reloads for the new server, so the reason is kept as a notice.
    expect(controller.snapshot().notice).toMatchObject({
      code: 'server_check_failed',
      tone: 'danger',
    });
    expect(controller.snapshot().notice?.message).toContain('Now using other.example');
    expect(JSON.stringify(controller.snapshot())).not.toContain(SECRET);
  });

  it("closing from the panel keeps the account's unsent work; forgetting from Settings removes it", async () => {
    const { controller, events } = await setup({
      [`POST ${SERVER}/api/desktop/redeem`]: redeemOk,
      [`POST ${SERVER}/api/desktop/logout`]: () => new Response(null, { status: 204 }),
    });
    await controller.handleDeepLink(handoff());
    await controller.disconnect({ forget: false });
    expect(controller.snapshot().session).toBeNull();
    expect(events.sessionClosed).toHaveBeenCalledExactlyOnceWith({
      accountId: GRANT,
      clearLocalData: false,
    });
    events.sessionClosed.mockClear();
    await controller.handleDeepLink(handoff());
    await controller.disconnect({ forget: true });
    expect(events.sessionClosed).toHaveBeenCalledExactlyOnceWith({
      accountId: GRANT,
      clearLocalData: true,
    });
  });

  it('checks a session with the server once at a time, however often it is asked', async () => {
    const waiting: (() => void)[] = [];
    const sessionCalls = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          waiting.push(() =>
            resolve(
              json(200, {
                documentId: DOC,
                title: 'Notes',
                role: 'viewer',
                expiresAt: null,
                accountId: null,
              }),
            ),
          );
        }),
    );
    const { controller } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`GET ${SERVER}/api/desktop/session`]: sessionCalls,
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET), 'panel');
    const checks = Array.from({ length: 20 }, () => controller.revalidateSession());
    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    waiting[0]?.();
    await Promise.all(checks);
    expect(sessionCalls).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().session).not.toBeNull();
  });

  it('redeems an "Open in Desktop" link for the configured server', async () => {
    const { controller, network, events } = await setup({
      [`POST ${SERVER}/api/desktop/redeem`]: redeemOk,
    });
    await controller.handleDeepLink(handoff());
    expect(controller.snapshot().session).toMatchObject({
      documentId: DOC,
      via: 'handoff',
      role: 'editor',
    });
    expect(network.requests).toHaveLength(1);
    expect(events.reveal).toHaveBeenCalled();
  });

  it.each([
    ['another server', handoff('https://evil.example'), 'server_mismatch'],
    ['a look-alike server', handoff('https://docs.example.com.evil.example'), 'server_mismatch'],
    ['a malformed link', 'realtimedocs://open?server=x', 'invalid_link'],
    [
      'a link with an extra parameter',
      `${handoff()}&redirect=https://evil.example`,
      'invalid_link',
    ],
    ['something that is not a link', 12345, 'invalid_link'],
  ])(
    'rejects a deep link for %s with a notice and no network request at all',
    async (_name, link, code) => {
      const { controller, network, preferences } = await setup({
        [`POST ${SERVER}/api/desktop/redeem`]: redeemOk,
      });
      await controller.handleDeepLink(link);
      const snapshot = controller.snapshot();
      expect(snapshot.notice).toMatchObject({ code, tone: 'warning' });
      expect(snapshot.notice?.message).toContain('Nothing was opened');
      expect(snapshot.session).toBeNull();
      expect(network.requests).toHaveLength(0);
      expect(preferences.get().connection.serverOrigin).toBe(SERVER);
      expect(JSON.stringify(snapshot)).not.toContain(SECRET);
    },
  );

  it('never lets a deep link configure the server', async () => {
    const { controller, network, preferences } = await setup({}, { serverOrigin: null });
    await controller.handleDeepLink(handoff());
    expect(controller.snapshot().notice?.code).toBe('no_server_configured');
    expect(preferences.get().connection.serverOrigin).toBeNull();
    expect(network.requests).toHaveLength(0);
  });

  it('explains an expired or already-used code', async () => {
    const { controller } = await setup({
      [`POST ${SERVER}/api/desktop/redeem`]: () => apiError(400, 'handoff_invalid'),
    });
    await controller.handleDeepLink(handoff());
    const notice = controller.snapshot().notice;
    expect(notice).toMatchObject({ code: 'handoff_invalid', tone: 'danger' });
    expect(notice?.message).toContain('expired or was already used');
    expect(controller.snapshot().session).toBeNull();
  });

  it('throttles a flood of deep links', async () => {
    const { controller, network } = await setup({
      [`POST ${SERVER}/api/desktop/redeem`]: () => apiError(400, 'handoff_invalid'),
    });
    for (let index = 0; index < 20; index += 1) await controller.handleDeepLink(handoff());
    // Requests are counted with their follow-up diagnosis probes; redemptions are capped at five.
    const redemptions = network.requests.filter((request) =>
      request.url.endsWith('/api/desktop/redeem'),
    );
    expect(redemptions).toHaveLength(5);
    // The user is told once that links were ignored.
    expect(controller.snapshot().notice).toMatchObject({ code: 'too_many_links', tone: 'warning' });
  });

  it('accepts links again once the burst has passed', async () => {
    let now = Date.parse('2026-11-10T10:00:00.000Z');
    const { controller, network } = await setup(
      { [`POST ${SERVER}/api/desktop/redeem`]: () => apiError(400, 'handoff_invalid') },
      { serverOrigin: SERVER },
      { now: () => now },
    );
    for (let index = 0; index < 8; index += 1) await controller.handleDeepLink(handoff());
    expect(controller.snapshot().notice?.code).toBe('too_many_links');
    now += 11_000;
    await controller.handleDeepLink(handoff());
    expect(controller.snapshot().notice?.code).toBe('handoff_invalid');
    expect(
      network.requests.filter((request) => request.url.endsWith('/api/desktop/redeem')),
    ).toHaveLength(6);
  });

  it('accepts links for the server’s public address only after explicit opt-in, and still talks to the configured origin', async () => {
    const tunnel = 'http://localhost:4310';
    const { controller, network, preferences } = await setup(
      {
        [`GET ${tunnel}/api/meta`]: () => json(200, { ...META, publicOrigin: SERVER }),
        [`POST ${tunnel}/api/desktop/redeem`]: redeemOk,
      },
      { serverOrigin: tunnel },
    );
    await controller.checkServer();
    expect(controller.snapshot().server).toMatchObject({
      status: 'ok',
      publicOrigin: SERVER,
      transport: null,
    });

    await controller.handleDeepLink(handoff(SERVER));
    expect(controller.snapshot().notice?.code).toBe('server_mismatch');

    await controller.setOptions({ acceptPublicOrigin: true });
    expect(preferences.get().connection.acceptedLinkOrigin).toBe(SERVER);
    await controller.handleDeepLink(handoff(SERVER));
    expect(controller.snapshot().session?.documentId).toBe(DOC);
    // Every request went to the tunnel address; the public address was never contacted.
    expect(network.requests.every((request) => request.url.startsWith(tunnel))).toBe(true);
  });

  it('cannot be made to accept an arbitrary alias', async () => {
    const { controller, preferences } = await setup({
      [`GET ${SERVER}/api/meta`]: () => json(200, META),
    });
    await controller.checkServer();
    // The server reports its own address: nothing to accept.
    await expect(controller.setOptions({ acceptPublicOrigin: true })).rejects.toMatchObject({
      code: 'no_public_origin',
    });
    expect(preferences.get().connection.acceptedLinkOrigin).toBeNull();
  });

  it('drops an accepted alias when the server stops reporting it', async () => {
    const tunnel = 'http://localhost:4310';
    let publicOrigin = SERVER;
    const { controller, preferences } = await setup(
      { [`GET ${tunnel}/api/meta`]: () => json(200, { ...META, publicOrigin }) },
      { serverOrigin: tunnel },
    );
    await controller.checkServer();
    await controller.setOptions({ acceptPublicOrigin: true });
    publicOrigin = 'https://moved.example';
    await controller.checkServer();
    expect(preferences.get().connection.acceptedLinkOrigin).toBeNull();
  });

  it('forgets the session and tells the server when the address changes', async () => {
    const { controller, network, credentials, events, preferences } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`POST ${SERVER}/api/desktop/logout`]: () => new Response(null, { status: 204 }),
      [`GET ${OTHER}/api/meta`]: () => json(200, { ...META, publicOrigin: OTHER }),
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    await controller.setServer('other.example');
    expect(preferences.get().connection.serverOrigin).toBe(OTHER);
    expect(credentials.getToken()).toBeNull();
    expect(controller.authContext()).toEqual({ serverOrigin: OTHER, token: null });
    expect(events.serverChanged).toHaveBeenCalledTimes(1);
    const logout = network.requests.find((request) => request.url.endsWith('/api/desktop/logout'));
    expect(logout?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(controller.snapshot().server).toMatchObject({
      origin: OTHER,
      status: 'ok',
      transport: 'https',
    });
  });

  it.each([
    ['http://docs.example.com', 'insecure_public_http'],
    ['http://192.168.1.20:4310', 'insecure_lan_disabled'],
    ['not a url at all', 'invalid_address'],
    ['https://docs.example.com;script-src-elem', 'invalid_address'],
  ])('refuses to set %s as the server', async (input, code) => {
    const { controller, network, preferences } = await setup({});
    await expect(controller.setServer(input)).rejects.toMatchObject({ code });
    expect(preferences.get().connection.serverOrigin).toBe(SERVER);
    expect(network.requests).toHaveLength(0);
  });

  it('accepts a plain-HTTP LAN server only with the override, and says the traffic is unencrypted', async () => {
    const lan = 'http://192.168.1.20:4310';
    const routes = { [`GET ${lan}/api/meta`]: () => json(200, { ...META, publicOrigin: lan }) };
    const refused = await setup(routes, { serverOrigin: SERVER, allowInsecureLan: false });
    await expect(refused.controller.setServer(lan)).rejects.toMatchObject({
      code: 'insecure_lan_disabled',
    });
    expect(refused.network.requests).toHaveLength(0);

    const { controller } = await setup(routes, { serverOrigin: SERVER, allowInsecureLan: true });
    await controller.setServer(lan);
    const snapshot = controller.snapshot();
    expect(snapshot.server).toMatchObject({
      status: 'ok',
      transport: 'insecure_lan_http',
      origin: lan,
    });
    expect(snapshot.server.message).toContain('not encrypted');
    expect(snapshot.allowInsecureLan).toBe(true);
  });

  it('disconnects a plain-HTTP LAN server when the override is turned off', async () => {
    const lan = 'http://192.168.1.20:4310';
    const { controller, preferences, events } = await setup(
      {},
      { serverOrigin: lan, allowInsecureLan: true },
    );
    await controller.setOptions({ allowInsecureLan: false });
    expect(preferences.get().connection).toMatchObject({
      serverOrigin: null,
      allowInsecureLan: false,
    });
    expect(events.serverChanged).toHaveBeenCalled();
  });

  it('clears the session when the server says it has ended, and keeps it when the check merely fails', async () => {
    let answer: Route = () => apiError(503, 'server_busy');
    const { controller, credentials } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`GET ${SERVER}/api/desktop/session`]: (request) => answer(request),
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    await controller.revalidateSession();
    expect(credentials.getToken()).toBe(TOKEN);

    answer = () =>
      json(200, {
        documentId: DOC,
        title: 'Renamed',
        role: 'editor',
        expiresAt: null,
        accountId: null,
      });
    await controller.revalidateSession();
    expect(controller.snapshot().session).toMatchObject({ title: 'Renamed', role: 'editor' });

    answer = () => apiError(401, 'session_expired');
    await controller.revalidateSession();
    expect(credentials.getToken()).toBeNull();
    expect(controller.snapshot().session).toBeNull();
    expect(controller.snapshot().notice?.code).toBe('session_expired');
  });

  it('re-checks with the server when the editor reports revoked access (it does not just believe the page)', async () => {
    const sessionCalls = vi.fn(() => apiError(401, 'unauthenticated'));
    const { controller, credentials } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`GET ${SERVER}/api/desktop/session`]: sessionCalls,
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    const sequence = controller.snapshot().session?.sequence ?? -1;
    expect(sequence).toBeGreaterThan(0);
    controller.reportSession({
      sequence,
      connection: 'live',
      save: 'saved',
      role: 'viewer',
      title: 'Notes',
    });
    expect(controller.snapshot().report).toMatchObject({ connection: 'live' });
    expect(sessionCalls).not.toHaveBeenCalled();
    // A report that belongs to an earlier credential changes nothing and asks nothing.
    controller.reportSession({
      sequence: sequence - 1,
      connection: 'access_revoked',
      save: 'read_only',
      role: null,
      title: null,
    });
    expect(controller.snapshot().report).toMatchObject({ connection: 'live' });
    expect(sessionCalls).not.toHaveBeenCalled();
    controller.reportSession({
      sequence,
      connection: 'access_revoked',
      save: 'read_only',
      role: null,
      title: null,
    });
    await vi.waitFor(() => expect(credentials.getToken()).toBeNull());
    expect(sessionCalls).toHaveBeenCalledTimes(1);
  });

  it('restores an encrypted session at startup and validates it', async () => {
    const routes = {
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`GET ${SERVER}/api/meta`]: () => json(200, META),
      [`GET ${SERVER}/api/desktop/session`]: () =>
        json(200, {
          documentId: DOC,
          title: 'Notes',
          role: 'viewer',
          expiresAt: null,
          accountId: null,
        }),
    };
    const first = await setup(routes);
    await first.controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));

    const second = await setup(routes);
    await second.controller.start();
    expect(second.controller.snapshot().session).toMatchObject({ documentId: DOC, restored: true });
    expect(second.controller.snapshot().server.status).toBe('ok');
    expect(second.network.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/meta',
      '/api/desktop/session',
    ]);
  });

  it('does not restore a session after the server address was changed on disk', async () => {
    const first = await setup({ [`POST ${SERVER}/api/share/exchange`]: exchangeOk });
    await first.controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    const second = await setup(
      { [`GET ${OTHER}/api/meta`]: () => json(200, META) },
      { serverOrigin: OTHER },
    );
    await second.controller.start();
    expect(second.controller.snapshot().session).toBeNull();
    expect(second.controller.authContext().token).toBeNull();
    expect(second.network.requests.every((request) => request.url.startsWith(OTHER))).toBe(true);
  });

  it('disconnect forgets the session locally even when the server cannot be told', async () => {
    const { controller, credentials } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    await controller.disconnect();
    expect(credentials.getToken()).toBeNull();
    expect(controller.snapshot()).toMatchObject({ session: null, busy: null });
  });

  it('gives every credential its own sequence, so the panel starts a fresh editor session for each', async () => {
    const routes = {
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`POST ${SERVER}/api/desktop/redeem`]: redeemOk,
      [`POST ${SERVER}/api/desktop/logout`]: () => new Response(null, { status: 204 }),
      [`GET ${SERVER}/api/meta`]: () => json(200, META),
      [`GET ${SERVER}/api/desktop/session`]: () =>
        json(200, {
          documentId: DOC,
          title: 'Notes',
          role: 'viewer',
          expiresAt: null,
          accountId: null,
        }),
    };
    const first = await setup(routes);
    expect(first.controller.snapshot().session).toBeNull();
    await first.controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    const one = first.controller.snapshot().session?.sequence ?? 0;
    // The same document again, through another credential: a new sequence.
    await first.controller.handleDeepLink(handoff());
    const two = first.controller.snapshot().session?.sequence ?? 0;
    expect(first.controller.snapshot().session).toMatchObject({ documentId: DOC, via: 'handoff' });
    expect(two).toBeGreaterThan(one);
    // A session restored at start counts as well.
    const second = await setup(routes);
    await second.controller.start();
    expect(second.controller.snapshot().session?.sequence).toBeGreaterThan(0);
  });

  it('says how a session ended: forgotten by the user (local data goes too) or ended by the server (a draft may stay)', async () => {
    let sessionAnswer: Route = () => apiError(410, 'share_revoked');
    const { controller, events } = await setup({
      [`POST ${SERVER}/api/desktop/redeem`]: redeemOk,
      [`POST ${SERVER}/api/desktop/logout`]: () => new Response(null, { status: 204 }),
      [`GET ${SERVER}/api/desktop/session`]: (request) => sessionAnswer(request),
    });
    await controller.handleDeepLink(handoff());
    expect(controller.snapshot().session).toMatchObject({ accountId: GRANT });
    await controller.disconnect();
    expect(events.sessionClosed).toHaveBeenCalledExactlyOnceWith({
      accountId: GRANT,
      clearLocalData: true,
    });

    events.sessionClosed.mockClear();
    await controller.handleDeepLink(handoff());
    await controller.revalidateSession();
    expect(controller.snapshot().session).toBeNull();
    expect(events.sessionClosed).toHaveBeenCalledExactlyOnceWith({
      accountId: GRANT,
      clearLocalData: false,
    });

    // A check that merely fails ends nothing.
    events.sessionClosed.mockClear();
    sessionAnswer = () => apiError(503, 'server_busy');
    await controller.handleDeepLink(handoff());
    await controller.revalidateSession();
    expect(controller.snapshot().session).not.toBeNull();
    expect(events.sessionClosed).not.toHaveBeenCalled();
  });

  it('asks the server when the editor reports that the document is gone', async () => {
    const sessionCalls = vi.fn(() => apiError(404, 'not_found'));
    const { controller, credentials } = await setup({
      [`POST ${SERVER}/api/share/exchange`]: exchangeOk,
      [`GET ${SERVER}/api/desktop/session`]: sessionCalls,
    });
    await controller.openShareLink(buildShareUrl(SERVER, GRANT, SECRET));
    controller.reportSession({
      sequence: controller.snapshot().session?.sequence ?? -1,
      connection: 'document_unavailable',
      save: 'read_only',
      role: 'viewer',
      title: null,
    });
    await vi.waitFor(() => expect(credentials.getToken()).toBeNull());
    expect(sessionCalls).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().notice?.code).toBe('not_found');
  });

  it('lets the app clear what the previous server left behind before the new origin takes effect', async () => {
    const { controller, events } = await setup({
      [`GET ${OTHER}/api/meta`]: () => json(200, { ...META, publicOrigin: OTHER }),
    });
    await controller.setServer(OTHER);
    expect(events.order).toEqual([`changing from ${SERVER}`, `changed to ${OTHER}`]);
    // Setting the same server again changes nothing and clears nothing.
    await controller.setServer(OTHER);
    expect(events.serverChanging).toHaveBeenCalledTimes(1);
    expect(events.serverChanged).toHaveBeenCalledTimes(1);
  });
});
