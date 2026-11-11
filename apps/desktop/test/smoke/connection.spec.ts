import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import {
  DOC_ID,
  GRANT_ID,
  PIXEL,
  REDIRECTING_ASSET_ID,
  SECRET,
  SECRET_2,
  SERVER_A,
  SERVER_B,
  TOKEN,
  PORT_A,
  PORT_B,
  controlDialogs,
  controlSaveDialog,
  displayPicture,
  getState,
  handoffUrl,
  launchApp,
  launchSecondInstance,
  panelFacts,
  recordExternalOpens,
  screenshot,
  shareUrl,
  startFakeServer,
  waitForState,
  type FakeServer,
  type RunningApp,
} from './helpers';
import { displayDifference } from '../lib/xwd.mjs';

test.describe.configure({ mode: 'serial' });

type ControllerResult = { ok: true } | { ok: false; code: string; message: string };

/** Calls a method of the app controller through the test hook, reporting a thrown error as data. */
function callController(
  app: ElectronApplication,
  method: string,
  ...args: unknown[]
): Promise<ControllerResult> {
  return app.evaluate(
    async (_electron, [name, parameters]) => {
      const controller = (
        globalThis as unknown as {
          __rdTest: { controller: Record<string, (...values: unknown[]) => unknown> };
        }
      ).__rdTest.controller;
      try {
        await controller[name as string]?.(...(parameters as unknown[]));
        return { ok: true as const };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return {
          ok: false as const,
          code: failure.code ?? 'unknown',
          message: failure.message ?? '',
        };
      }
    },
    [method, args] as const,
  );
}

/** The panel reloads when the server changes (new Content-Security-Policy); wait until it is back. */
async function panelReady(running: RunningApp): Promise<void> {
  await running.panel.waitForSelector('[data-testid="rd-panel"][data-collapsed]', {
    timeout: 30_000,
  });
}

test.describe('server, "Open in Desktop" and credential handling', () => {
  let running: RunningApp;
  let serverA: FakeServer;
  let serverB: FakeServer;

  test.beforeAll(async () => {
    serverA = await startFakeServer(PORT_A, SERVER_B);
    serverB = await startFakeServer(PORT_B);
    running = await launchApp();
  });

  test.afterAll(async () => {
    await running.close();
    await serverA.close();
    await serverB.close();
  });

  test('setting the server checks /api/meta from the main process as the desktop origin', async () => {
    expect(await callController(running.app, 'setServer', 'https://127.0.0.1:1')).toEqual({
      ok: true,
    });
    // Nothing listens there: the check must fail closed.
    await waitForState(
      running.panel,
      (state) => state.connection.server.status === 'unreachable',
      'unreachable server',
    );

    expect(await callController(running.app, 'setServer', `127.0.0.1:${PORT_A}`)).toEqual({
      ok: true,
    });
    const state = await waitForState(
      running.panel,
      (current) => current.connection.server.status === 'ok',
      'server ok',
    );
    expect(state.connection.server).toMatchObject({
      origin: SERVER_A,
      transport: 'loopback_http',
      serverVersion: '0.1.0-smoke',
      publicOrigin: SERVER_A,
    });
    // The check is a plain native request: one GET, no Origin (so no cross-origin
    // preflight and no dependence on the server's cross-origin settings), no credentials.
    const metaRequests = serverA.requests.filter((request) => request.path === '/api/meta');
    expect(metaRequests.map((request) => request.method)).toEqual(['GET']);
    expect(metaRequests[0]?.headers.origin).toBeUndefined();
    expect(metaRequests[0]?.headers.authorization).toBeUndefined();
    expect(metaRequests[0]?.headers.cookie).toBeUndefined();

    // The panel was reloaded with a policy that names exactly this server.
    await panelReady(running);
    const policy = await running.app.evaluate(async ({ session }) => {
      const response = await session
        .fromPartition('persist:realtimedocs')
        .fetch('app://realtimedocs/panel.html');
      await response.arrayBuffer();
      return response.headers.get('content-security-policy');
    });
    expect(policy).toContain(`connect-src ${SERVER_A} ws://127.0.0.1:${PORT_A};`);
    expect(policy).toContain(`img-src 'self' data: blob: ${SERVER_A};`);
    expect(policy).not.toContain(String(PORT_B));
  });

  test('a deep link delivered by a second instance is redeemed with the configured server', async () => {
    serverA.clear();
    const exitCode = await launchSecondInstance(running.userData, [handoffUrl(SERVER_A)]);
    expect(exitCode).toBe(0);

    const state = await waitForState(
      running.panel,
      (current) => current.connection.session !== null,
      'document session',
    );
    expect(state.connection.session).toEqual({
      documentId: DOC_ID,
      title: 'Handoff document',
      role: 'editor',
      expiresAt: null,
      accountId: GRANT_ID,
      via: 'handoff',
      restored: false,
      sequence: 1,
    });

    // The redemption identifies as the desktop origin, so Chromium sends a
    // cross-origin preflight first; neither request carries credentials, and
    // the code travels only in the POST body.
    const redeemRequests = serverA.requests.filter(
      (request) => request.path === '/api/desktop/redeem',
    );
    expect(redeemRequests.map((request) => request.method)).toEqual(['OPTIONS', 'POST']);
    const [preflight, redeem] = redeemRequests;
    expect(preflight?.headers.origin).toBe('app://realtimedocs');
    expect(preflight?.headers['access-control-request-method']).toBe('POST');
    expect(String(preflight?.headers['access-control-request-headers'])).toContain('content-type');
    expect(preflight?.body).toBe('');
    expect(JSON.parse(redeem?.body ?? '{}')).toEqual({ documentId: DOC_ID, code: SECRET });
    expect(redeem?.headers.origin).toBe('app://realtimedocs');
    expect(redeem?.headers.authorization).toBeUndefined();
    expect(redeemRequests.every((request) => request.headers.cookie === undefined)).toBe(true);
    // Only the configured server was contacted.
    expect(serverB.requests).toHaveLength(0);

    // The panel shows the document and its access, and is visible.
    await expect(running.panel.locator('[data-testid="rd-panel-title"]')).toHaveText(
      'Handoff document',
    );
    await expect(running.panel.locator('[data-testid="rd-header-access"]')).toHaveText('Can edit');
    await expect(running.panel.locator('[data-testid="rd-document"]')).toBeVisible();
    await expect(running.panel.locator('[data-testid="rd-editor"]')).toBeVisible();
    expect((await panelFacts(running.app)).visible).toBe(true);

    // The editor asks for a collaboration ticket through the shared API client:
    // a cross-origin request from the packaged page, to which the main process
    // attached the token (and to its preflight nothing). This stand-in server
    // has no collaboration endpoint and answers "busy", so the editor keeps
    // trying; a live document is covered by the real-stack suite.
    const ticketPath = `/api/documents/${DOC_ID}/collab-ticket`;
    await expect
      .poll(
        () =>
          serverA.requests.filter(
            (request) => request.path === ticketPath && request.method === 'POST',
          ).length,
      )
      .toBeGreaterThan(0);
    const ticketRequests = serverA.requests.filter((request) => request.path === ticketPath);
    for (const request of ticketRequests) {
      expect(request.headers.origin).toBe('app://realtimedocs');
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBe(
        request.method === 'POST' ? `Bearer ${TOKEN}` : undefined,
      );
    }
    await expect(running.panel.locator('[data-testid="rd-header-connection"]')).toHaveAttribute(
      'data-state',
      /^(connecting|reconnecting)$/,
    );
    // Not connected, so nothing may claim to be saved.
    await expect(running.panel.locator('[data-testid="rd-header-save"]')).toHaveCount(0);
    await screenshot(running.panel, 'panel-document-connecting');
  });

  test('the session token never reaches the renderer', async () => {
    const exposure = await running.panel.evaluate(async (token) => {
      const state = await window.rdDesktop?.getState();
      const storage: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) ?? '';
        storage.push(key, localStorage.getItem(key) ?? '');
      }
      return {
        inState: JSON.stringify(state).includes(token),
        inCookies: document.cookie,
        inStorage: storage.join('\n').includes(token),
        inDom: document.documentElement.outerHTML.includes(token),
      };
    }, TOKEN);
    expect(exposure).toEqual({ inState: false, inCookies: '', inStorage: false, inDom: false });
    // Nor does it reach the log.
    expect(running.stderr.join('')).not.toContain(TOKEN);
    expect(running.stderr.join('')).not.toContain(SECRET);
  });

  test('the bearer token is attached only to API requests for the configured origin', async () => {
    serverA.clear();
    serverB.clear();
    const results = await running.panel.evaluate(
      async ([serverOrigin, foreignOrigin, documentId, assetId, port]) => {
        const get = async (url: string) => {
          try {
            const response = await fetch(url, { credentials: 'omit' });
            return (await response.json()) as { path: string; hadAuthorization: boolean };
          } catch {
            return 'blocked' as const;
          }
        };
        const image = await new Promise<boolean>((resolve) => {
          const element = new Image();
          element.onload = () => resolve(true);
          element.onerror = () => resolve(false);
          element.src = `${serverOrigin}/api/documents/${documentId}/assets/${assetId}`;
        });
        const socket = await new Promise<string>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`);
          ws.onopen = () => resolve('open');
          ws.onerror = () => resolve('error');
          setTimeout(() => resolve('timeout'), 4000);
        });
        // The kind of request the editor makes: a JSON POST (collaboration ticket, uploads).
        const post = await fetch(`${serverOrigin}/api/echo`, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json', 'x-rd-csrf': '1' },
          body: '{}',
        }).then(
          async (response) =>
            (await response.json()) as { path: string; hadAuthorization: boolean },
          () => 'blocked' as const,
        );
        return {
          post,
          api: await get(`${serverOrigin}/api/echo`),
          nonApi: await get(`${serverOrigin}/public/echo`),
          redirectedSameOrigin: await get(`${serverOrigin}/api/redirect-same-origin`),
          redirectedToApi: await get(`${serverOrigin}/api/redirect-api`),
          redirectedForeign: await get(`${serverOrigin}/api/redirect-foreign`),
          foreign: await get(`${foreignOrigin}/api/echo`),
          image,
          socket,
        };
      },
      [SERVER_A, SERVER_B, DOC_ID, GRANT_ID, PORT_A] as const,
    );

    // What the page learns: only whether its request was authorised.
    expect(results.post).toEqual({ path: '/api/echo', hadAuthorization: true });
    expect(results.api).toEqual({ path: '/api/echo', hadAuthorization: true });
    expect(results.nonApi).toEqual({ path: '/public/echo', hadAuthorization: false });
    // The header attached for the first hop does not travel with the redirect.
    expect(results.redirectedSameOrigin).toEqual({ path: '/public/echo', hadAuthorization: false });
    // Nor is it attached again after a redirect, even when the redirect stays
    // inside the API of the same server.
    expect(results.redirectedToApi).toEqual({ path: '/api/echo', hadAuthorization: false });
    // Another origin is unreachable from the page at all (Content-Security-Policy).
    expect(results.redirectedForeign).toBe('blocked');
    expect(results.foreign).toBe('blocked');
    expect(results.image).toBe(true);
    expect(results.socket).toBe('open');

    // What the servers actually received.
    const seen = (path: string, upgrade = false) =>
      serverA.requests.filter(
        (request) =>
          request.path === path && request.upgrade === upgrade && request.method !== 'OPTIONS',
      );
    expect(
      seen('/api/echo').map((request) => `${request.method} ${request.headers.authorization}`),
    ).toEqual([`POST Bearer ${TOKEN}`, `GET Bearer ${TOKEN}`, 'GET undefined']);
    // The first hop of the API-to-API redirect was authorised; its second hop is
    // the third entry above, without the token.
    expect(seen('/api/redirect-api')[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // Chromium's cross-origin preflight for the JSON POST also passes through the
    // header listener. The app never attaches the token to it, and the preflight
    // does not name an Authorization header either (it is computed from what the
    // page set), so the server does not need to allow-list that header for the
    // desktop origin.
    const preflight = serverA.requests.find(
      (request) => request.method === 'OPTIONS' && request.path === '/api/echo',
    );
    expect(preflight).toBeDefined();
    expect(preflight?.headers.authorization).toBeUndefined();
    expect(String(preflight?.headers['access-control-request-headers'])).not.toContain(
      'authorization',
    );
    expect(String(preflight?.headers['access-control-request-headers'])).toContain('content-type');
    expect(seen('/api/redirect-same-origin')[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen('/public/echo').length).toBe(2);
    expect(
      seen('/public/echo').every((request) => request.headers.authorization === undefined),
    ).toBe(true);
    expect(seen(`/api/documents/${DOC_ID}/assets/${GRANT_ID}`)[0]?.headers.authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    const upgrade = seen('/collab', true)[0];
    expect(upgrade).toBeDefined();
    expect(upgrade?.headers.authorization).toBeUndefined();
    expect(upgrade?.headers.origin).toBe('app://realtimedocs');
    // No cookies anywhere, and nothing at all reached the other server.
    expect(serverA.requests.every((request) => request.headers.cookie === undefined)).toBe(true);
    expect(serverB.requests).toHaveLength(0);
  });

  test('a reused code, a foreign server and a malformed link each give a clear notice and no access', async () => {
    // Reused single-use code.
    serverA.clear();
    await launchSecondInstance(running.userData, [handoffUrl(SERVER_A)]);
    let state = await waitForState(
      running.panel,
      (current) => current.connection.notice?.code === 'handoff_invalid',
      'reused code notice',
    );
    expect(state.connection.notice?.message).toContain('expired or was already used');
    await expect(running.panel.locator('[data-testid="rd-notice"]')).toContainText(
      'expired or was already used',
    );
    // The document that was already open stays open.
    expect(state.connection.session?.documentId).toBe(DOC_ID);
    await screenshot(running.panel, 'panel-notice');

    // A link for another server: rejected without contacting that server.
    serverA.clear();
    serverB.clear();
    await launchSecondInstance(running.userData, [handoffUrl(SERVER_B, SECRET_2)]);
    state = await waitForState(
      running.panel,
      (current) => current.connection.notice?.code === 'server_mismatch',
      'mismatch notice',
    );
    expect(state.connection.notice?.message).toContain(`127.0.0.1:${PORT_B}`);
    expect(state.connection.notice?.message).toContain('Nothing was opened');
    expect(state.connection.server.origin).toBe(SERVER_A);
    expect(serverB.requests).toHaveLength(0);
    expect(
      serverA.requests.filter((request) => request.path === '/api/desktop/redeem'),
    ).toHaveLength(0);

    // A malformed link that tries to smuggle a parameter (the full malformed
    // corpus is covered by the unit tests; this proves the path from a real
    // second process).
    await callController(running.app, 'dismissNotice', state.connection.notice?.id ?? '');
    await launchSecondInstance(running.userData, [
      `${handoffUrl(SERVER_A)}&next=https://evil.example`,
    ]);
    state = await waitForState(
      running.panel,
      (current) => current.connection.notice?.code === 'invalid_link',
      'invalid link notice',
    );
    expect(state.connection.notice?.message).toContain('Nothing was opened');
    expect(state.connection.server.origin).toBe(SERVER_A);
    expect(
      serverA.requests.filter((request) => request.path === '/api/desktop/redeem'),
    ).toHaveLength(0);
    expect(serverB.requests).toHaveLength(0);
    // The notices never repeat a code or secret.
    expect(JSON.stringify(state.connection)).not.toContain(SECRET_2);
    expect(running.stderr.join('')).not.toContain(SECRET_2);
  });

  test('a burst of deep links is capped, and the user is told', async () => {
    // Four links have been delivered in the last seconds; the limit is five per ten seconds.
    serverA.clear();
    await launchSecondInstance(running.userData, ['realtimedocs://open?server=nonsense']);
    await launchSecondInstance(running.userData, [handoffUrl(SERVER_A)]);
    await launchSecondInstance(running.userData, [handoffUrl(SERVER_A)]);
    const state = await waitForState(
      running.panel,
      (current) => current.connection.notice?.code === 'too_many_links',
      'burst notice',
    );
    expect(state.connection.notice?.message).toContain('ignored');
    // The dropped links caused no request.
    expect(
      serverA.requests.filter((request) => request.path === '/api/desktop/redeem'),
    ).toHaveLength(0);
    expect(running.stderr.join('')).toContain('deep_link.throttled');
    await callController(running.app, 'dismissNotice', state.connection.notice?.id ?? '');
  });

  test('starting the app again shows the panel and returns it to interactive mode', async () => {
    await running.panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true));
    await waitForState(running.panel, (state) => state.panel.clickThrough, 'click-through on');
    expect(await launchSecondInstance(running.userData, [])).toBe(0);
    await waitForState(
      running.panel,
      (state) => !state.panel.clickThrough,
      'click-through off after relaunch',
    );

    await callController(running.app, 'triggerShortcut', 'toggleVisibility');
    await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);
    expect(await launchSecondInstance(running.userData, [])).toBe(0);
    await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
  });

  test('pasting a share link: invalid input is explained, a link for the configured server opens', async () => {
    // Close the document first.
    serverA.clear();
    expect(await running.panel.evaluate(() => window.rdDesktop?.connection.disconnect())).toEqual({
      ok: true,
      data: null,
    });
    await waitForState(running.panel, (state) => state.connection.session === null, 'disconnected');
    // Bearer calls from the main process are plain native requests: no Origin, hence no preflight.
    const logoutRequests = serverA.requests.filter(
      (request) => request.path === '/api/desktop/logout',
    );
    expect(logoutRequests.map((request) => request.method)).toEqual(['POST']);
    expect(logoutRequests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(logoutRequests[0]?.headers.origin).toBeUndefined();
    await expect(running.panel.locator('[data-testid="rd-empty-no-document"]')).toBeVisible();

    // Not a share link: explained in place, nothing is sent.
    serverA.clear();
    await running.panel.fill('[data-testid="rd-paste-input"]', 'https://example.com/some/page');
    await running.panel.click('[data-testid="rd-paste-submit"]');
    await expect(running.panel.locator('[data-testid="rd-paste-form"]')).toContainText(
      'does not look like a RealtimeDocs share link',
    );
    expect(serverA.requests).toHaveLength(0);

    // A link for the configured server opens directly.
    await running.panel.fill('[data-testid="rd-paste-input"]', shareUrl(SERVER_A));
    await running.panel.click('[data-testid="rd-paste-submit"]');
    const state = await waitForState(
      running.panel,
      (current) => current.connection.session !== null,
      'share session',
    );
    expect(state.connection.session).toMatchObject({
      via: 'share_link',
      role: 'viewer',
      accountId: null,
      title: 'Smoke test notes',
    });
    const exchange = serverA.requests.find(
      (request) => request.path === '/api/share/exchange' && request.method === 'POST',
    );
    expect(JSON.parse(exchange?.body ?? '{}')).toEqual({
      grantId: GRANT_ID,
      secret: SECRET,
      mode: 'bearer',
    });
    expect(exchange?.headers.origin).toBe('app://realtimedocs');
    await expect(running.panel.locator('[data-testid="rd-header-access"]')).toHaveText('View only');
  });

  test('a page in the panel can neither change the server, nor replace the open document, nor answer for the user', async () => {
    // The share-link document from the previous test is open: the situation in
    // which the panel is showing content written by other people.
    const before = await getState(running.panel);
    expect(before.connection.session?.via).toBe('share_link');
    const dialogs = await controlDialogs(running.app);
    // If a question were asked, it would be answered with yes. None may be asked.
    await dialogs.answerWith('yes');
    serverA.clear();
    serverB.clear();

    const attempts = await running.panel.evaluate(
      async ([otherServerLink, sameServerLink]) => {
        const bridge = window.rdDesktop;
        if (!bridge) throw new Error('bridge missing');
        const connection = bridge.connection as unknown as Record<string, unknown>;
        return {
          // Everything the page can call about the connection.
          connectionMethods: Object.keys(connection).sort(),
          otherServer: await bridge.connection.openShareLink(otherServerLink),
          sameServer: await bridge.connection.openShareLink(sameServerLink),
          // A burst, as a script would send it.
          burst: await Promise.all(
            Array.from({ length: 10 }, () => bridge.connection.openShareLink(otherServerLink)),
          ),
        };
      },
      [shareUrl(SERVER_B), shareUrl(SERVER_A)] as const,
    );

    // What the bridge offers about the connection. It is one object for every
    // window; there is nothing in it that answers a question.
    expect(attempts.connectionMethods).toEqual(
      [
        'check',
        'disconnect',
        'dismissNotice',
        'openShareLink',
        'reportSession',
        'revalidate',
        'setOptions',
        'setServer',
      ].sort(),
    );
    const refused = { ok: false, error: { code: 'document_open' } };
    expect(attempts.otherServer).toMatchObject(refused);
    expect(attempts.sameServer).toMatchObject(refused);
    expect(attempts.burst.every((result) => !result.ok)).toBe(true);

    // Nothing was asked, nothing was sent anywhere, nothing changed.
    expect(await dialogs.calls()).toEqual([]);
    expect(serverB.requests).toHaveLength(0);
    expect(serverA.requests.filter((request) => request.path === '/api/share/exchange')).toEqual(
      [],
    );
    const after = await getState(running.panel);
    expect(after.connection.server.origin).toBe(SERVER_A);
    expect(after.connection.session).toEqual(before.connection.session);
    expect(after.connection.busy).toBeNull();

    // The actions that belong to the settings window are refused for this one
    // by the main process, whatever the page sends.
    const settingsOnly = await running.panel.evaluate(
      async (otherServer) => ({
        setServer: await window.rdDesktop?.connection.setServer(otherServer),
        setOptions: await window.rdDesktop?.connection.setOptions({ allowInsecureLan: true }),
        check: await window.rdDesktop?.connection.check(),
      }),
      SERVER_B,
    );
    const forbidden = { ok: false, error: { code: 'forbidden_window' } };
    expect(settingsOnly.setServer).toMatchObject(forbidden);
    expect(settingsOnly.setOptions).toMatchObject(forbidden);
    expect(settingsOnly.check).toMatchObject(forbidden);
    expect((await getState(running.panel)).connection).toMatchObject({
      allowInsecureLan: false,
      server: { origin: SERVER_A },
    });
    expect(serverB.requests).toHaveLength(0);

    // Links handed to the operating system. While nobody could be clicking in
    // the document (click-through, collapsed, hidden), none at all.
    const opened = await recordExternalOpens(running.app);
    const openFromPage = (url: string) =>
      running.panel.evaluate((target) => window.rdDesktop?.openExternal(target), url);
    // Refused before the main process even looks at the link: nothing in the
    // panel can be clicked in these states (`decidePanelRequest`).
    const refusedWith = (code: string) => ({ ok: false, error: { code } });

    await running.panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true));
    await waitForState(running.panel, (state) => state.panel.clickThrough, 'click-through on');
    expect(await openFromPage('https://example.com/while-click-through')).toMatchObject(
      refusedWith('click_through'),
    );
    // `window.open` takes the same path in the main process.
    await running.panel.evaluate(() => {
      window.open('https://example.com/window-open-while-click-through', '_blank');
    });
    await running.panel.evaluate(() => window.rdDesktop?.window.setClickThrough(false));
    await waitForState(running.panel, (state) => !state.panel.clickThrough, 'click-through off');

    await running.panel.evaluate(() => window.rdDesktop?.window.action('collapse'));
    await waitForState(running.panel, (state) => state.panel.collapsed, 'collapsed');
    expect(await openFromPage('https://example.com/while-collapsed')).toMatchObject(
      refusedWith('panel_collapsed'),
    );
    await running.panel.evaluate(() => window.rdDesktop?.window.action('expand'));
    await waitForState(running.panel, (state) => !state.panel.collapsed, 'expanded');

    await running.panel.evaluate(() => window.rdDesktop?.window.action('hide'));
    await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(false);
    expect(await openFromPage('https://example.com/while-hidden')).toMatchObject(
      refusedWith('panel_hidden'),
    );
    // Brought back by the user (the tray), not by the page.
    await running.app.evaluate(() => {
      (
        globalThis as unknown as {
          __rdTest: { controller: { triggerMenuAction(action: string): void } };
        }
      ).__rdTest.controller.triggerMenuAction('show-panel');
    });
    await expect.poll(async () => (await panelFacts(running.app)).visible).toBe(true);
    expect(await opened()).toEqual([]);
    // `window.open` by script: refused for want of a click or key press, or
    // (when an earlier step's click was recent) because nothing could be clicked.
    expect(running.stderr.join('')).toMatch(/external\.refused_(no_input|not_interactive)/);

    // Visible and interactive: a script in a loop gets one link through, not fifty.
    const links = await running.panel.evaluate(() =>
      Promise.all(
        Array.from({ length: 50 }, (_unused, index) =>
          window.rdDesktop?.openExternal(`https://example.com/page-${index}`),
        ),
      ),
    );
    expect(links.filter((result) => result?.ok)).toHaveLength(1);
    expect(
      links.filter((result) => result && !result.ok && result.error.code === 'rate_limited'),
    ).toHaveLength(49);
    expect(await opened()).toEqual(['https://example.com/page-0']);
    await dialogs.answerWith('real');
  });

  test('a link for another server is asked about in a dialog of the main process; only a yes there switches', async () => {
    const dialogs = await controlDialogs(running.app);
    const askedBefore = (await dialogs.calls()).length;
    // Three servers the user is asked about. A "no" is remembered per server
    // for a few seconds, so each question below is about another one; only
    // SERVER_B, the one that gets a "yes", has to exist.
    const otherName = `http://localhost:${PORT_B}`;
    const thirdServer = 'https://docs.example.test';

    // Close the document: the panel offers its paste field again.
    await running.panel.evaluate(() => window.rdDesktop?.connection.disconnect());
    await waitForState(running.panel, (state) => state.connection.session === null, 'closed');
    await expect(running.panel.locator('[data-testid="rd-paste-input"]')).toBeVisible();
    serverA.clear();
    serverB.clear();

    // 1. The real dialog. Nothing in a test can press its buttons, so it is
    //    closed the way Escape closes it.
    await dialogs.answerWith('real');
    const displayBefore = displayPicture('display-before-question');
    await running.panel.fill('[data-testid="rd-paste-input"]', shareUrl(otherName));
    await running.panel.click('[data-testid="rd-paste-submit"]');
    let state = await waitForState(
      running.panel,
      (current) => current.connection.busy === 'confirming',
      'the question to be open',
    );
    const asked = (await dialogs.calls()).slice(askedBefore);
    expect(asked).toHaveLength(1);
    const { detail, ...question } = asked[0] ?? { detail: '' };
    expect(question).toEqual({
      parent: 'panel',
      type: 'question',
      message: 'This link is for a different server',
      // The safe answer comes first and is the default; Escape gives it too.
      buttons: ['Cancel', `Switch to localhost:${PORT_B}`],
      defaultId: 0,
      cancelId: 0,
      withdrawable: true,
    });
    // Both servers are named by their full origin, exactly as they are used.
    expect(detail).toContain(`The link belongs to:\n${otherName}\n`);
    expect(detail).toContain(`This app is connected to:\n${SERVER_A}\n`);
    // While the question is open: the secret is held by the main process only,
    // no server has heard of it, and the panel can only say where to look.
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(state.connection.server.origin).toBe(SERVER_A);
    expect(serverA.requests).toHaveLength(0);
    expect(serverB.requests).toHaveLength(0);
    await expect(running.panel.locator('[data-testid="rd-empty-confirming"]')).toBeVisible();
    await expect(running.panel.locator('[data-testid="rd-paste-input"]')).toHaveCount(0);
    // The page cannot answer, and cannot ask a second question on top.
    const meanwhile = await running.panel.evaluate(
      (link) => window.rdDesktop?.connection.openShareLink(link),
      shareUrl(SERVER_B),
    );
    expect(meanwhile).toMatchObject({ ok: false, error: { code: 'confirmation_open' } });
    expect((await dialogs.calls()).slice(askedBefore)).toHaveLength(1);

    // A picture of the whole display, dialog included (a page screenshot cannot show it).
    await running.panel.waitForTimeout(600);
    const displayOpen = displayPicture('display-server-question');
    if (displayBefore && displayOpen) {
      const difference = displayDifference(displayBefore, displayOpen);
      test.info().annotations.push({
        type: 'native dialog',
        description: `display changed in ${difference.changed} pixels, within ${JSON.stringify(difference.box)}`,
      });
      // A dialog window with two buttons and several lines of text is far more
      // than the few lines of text that changed inside the panel.
      expect(difference.changed).toBeGreaterThan(20_000);
    }
    await screenshot(running.panel, 'panel-answer-in-dialog');

    expect(await dialogs.cancelOpen()).toBe(1);
    state = await waitForState(
      running.panel,
      (current) => current.connection.busy === null,
      'the question to be closed',
    );
    expect(state.connection.server.origin).toBe(SERVER_A);
    expect(state.connection.session).toBeNull();
    expect(serverA.requests).toHaveLength(0);
    expect(serverB.requests).toHaveLength(0);
    await expect(running.panel.locator('[data-testid="rd-paste-input"]')).toBeVisible();

    // 2. Asking again right away is refused without a dialog.
    await running.panel.fill('[data-testid="rd-paste-input"]', shareUrl(otherName));
    await running.panel.click('[data-testid="rd-paste-submit"]');
    await expect(running.panel.locator('[data-testid="rd-paste-form"]')).toContainText(
      `You chose not to use localhost:${PORT_B} a moment ago`,
    );
    expect((await dialogs.calls()).slice(askedBefore)).toHaveLength(1);
    expect(serverB.requests).toHaveLength(0);

    // 3. A "no" from the settings window, with a document open in the panel.
    await running.panel.fill('[data-testid="rd-paste-input"]', shareUrl(SERVER_A));
    await running.panel.click('[data-testid="rd-paste-submit"]');
    await waitForState(running.panel, (current) => current.connection.session !== null, 'reopened');
    await running.panel.evaluate(() =>
      window.rdDesktop?.window.action('open-settings', { tab: 'connection' }),
    );
    await expect
      .poll(() => running.app.windows().some((page) => page.url().includes('/settings.html')))
      .toBe(true);
    const settings = running.app.windows().find((page) => page.url().includes('/settings.html'));
    if (!settings) throw new Error('settings window did not open');
    await settings.waitForSelector('[data-testid="rd-settings-paste-input"]');
    serverA.clear();
    serverB.clear();
    await dialogs.answerWith('no');
    await settings.fill('[data-testid="rd-settings-paste-input"]', shareUrl(thirdServer));
    await settings.click('[data-testid="rd-settings-paste-submit"]');
    await expect.poll(async () => (await dialogs.calls()).length - askedBefore).toBe(2);
    const second = (await dialogs.calls()).at(-1);
    expect(second).toMatchObject({
      parent: 'settings',
      buttons: ['Cancel', 'Switch to docs.example.test'],
      defaultId: 0,
      cancelId: 0,
    });
    expect(second?.detail).toContain(`The link belongs to:\n${thirdServer}\n`);
    state = await waitForState(
      running.panel,
      (current) => current.connection.busy === null,
      'declined',
    );
    expect(state.connection.server.origin).toBe(SERVER_A);
    expect(state.connection.session?.via).toBe('share_link');
    expect(serverB.requests).toHaveLength(0);
    expect(serverA.requests.some((request) => request.path === '/api/desktop/logout')).toBe(false);

    // 4. A "yes": the app switches servers, ends the old session and opens the
    //    document there.
    await dialogs.answerWith('yes');
    await settings.fill('[data-testid="rd-settings-paste-input"]', shareUrl(SERVER_B));
    await settings.click('[data-testid="rd-settings-paste-submit"]');
    await waitForState(
      running.panel,
      (current) =>
        current.connection.server.origin === SERVER_B && current.connection.session !== null,
      'switched server',
    );
    expect((await dialogs.calls()).length - askedBefore).toBe(3);
    expect((await dialogs.calls()).at(-1)).toMatchObject({
      parent: 'settings',
      buttons: ['Cancel', `Switch to 127.0.0.1:${PORT_B}`],
    });
    // Main process first: check the new server, then exchange the secret there
    // (and only there). Anything after that is the editor in the panel reading
    // the server's limits and asking for a collaboration ticket (which this
    // stand-in server never grants).
    const toB = serverB.requests.map((request) => `${request.method} ${request.path}`);
    expect(toB.slice(0, 3)).toEqual([
      'GET /api/meta',
      'OPTIONS /api/share/exchange',
      'POST /api/share/exchange',
    ]);
    const ticket = `/api/documents/${DOC_ID}/collab-ticket`;
    expect(
      toB
        .slice(3)
        .every(
          (entry) =>
            entry === 'GET /api/desktop/session' ||
            entry === 'GET /api/meta' ||
            entry === `OPTIONS ${ticket}` ||
            entry === `POST ${ticket}`,
        ),
      `requests to the new server: ${toB.join(', ')}`,
    ).toBe(true);
    // The secret was never sent to the server the app was connected to before.
    expect(serverA.requests.some((request) => request.path === '/api/share/exchange')).toBe(false);
    expect(serverA.requests.some((request) => request.path === '/api/desktop/logout')).toBe(true);
    await panelReady(running);
    // Neither the questions nor the answers put a secret in the log.
    expect(running.stderr.join('')).toContain('server_change.asked');
    expect(running.stderr.join('')).not.toContain(SECRET);
    await dialogs.answerWith('real');
  });
});

test.describe('attachment downloads', () => {
  let serverA: FakeServer;
  let serverB: FakeServer;

  test.beforeAll(async () => {
    serverA = await startFakeServer(PORT_A, SERVER_B);
    serverB = await startFakeServer(PORT_B);
  });

  test.afterAll(async () => {
    await serverA.close();
    await serverB.close();
  });

  test('the main process fetches an attachment itself: token on that one request, no redirect followed, saved where the person chooses', async () => {
    const running = await launchApp();
    const target = path.join(os.tmpdir(), `rd-smoke-download-${Date.now()}.bin`);
    try {
      const { app, panel } = running;
      expect(await callController(app, 'setServer', SERVER_A)).toEqual({ ok: true });
      await panelReady(running);
      expect(await callController(app, 'openShareLink', shareUrl(SERVER_A), 'settings')).toEqual({
        ok: true,
      });
      await waitForState(panel, (state) => state.connection.session !== null, 'document session');

      const saveDialog = await controlSaveDialog(app);
      const logged = (event: string) =>
        running.stderr.join('').split(`"event":"${event}"`).length - 1;
      // The panel is sent to an address, as a click on a link does. (After a
      // navigation the app refused, Playwright's locators wait for ever; the
      // page is read with plain evaluations from here on.)
      // The reader clicks the link: a real key press (input the operating system
      // delivers) right before the page follows it. `withInput: false` is a page
      // navigating there by script alone.
      const follow = async (url: string, withInput = true) => {
        if (withInput) await panel.keyboard.press('Shift');
        await panel.evaluate((address) => {
          window.location.href = address;
        }, url);
      };
      const pageText = () => panel.evaluate(() => document.body.innerText);
      const asset = (id: string) => `${SERVER_A}/api/documents/${DOC_ID}/assets/${id}?download=1`;

      // 1. The download link of an attachment of the open document.
      serverA.clear();
      serverB.clear();
      await saveDialog.answerWith(target);
      await follow(asset(GRANT_ID));
      await expect.poll(() => logged('attachment.download_saved')).toBe(1);
      expect(fs.readFileSync(target).equals(PIXEL)).toBe(true);
      const request = serverA.requests.find(
        (entry) => entry.path === `/api/documents/${DOC_ID}/assets/${GRANT_ID}`,
      );
      // The token was on the request, and nothing else that identifies the person or the page.
      expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(request?.headers.cookie).toBeUndefined();
      expect(request?.headers.origin).toBeUndefined();
      expect(request?.headers.referer).toBeUndefined();
      // The dialog belonged to the panel and proposed a plain file name in a
      // real folder, although the server's header named a path.
      const [asked] = await saveDialog.calls();
      expect(asked).toMatchObject({
        parent: 'panel',
        title: 'Save attachment',
        // Private mode is on (the default): the dialog, drawn by the operating
        // system outside the protected window, proposes a neutral name.
        defaultName: 'attachment',
      });
      expect(path.isAbsolute(asked?.defaultFolder ?? '')).toBe(true);
      expect(asked?.defaultFolder).not.toMatch(/\.\.|\.ssh/);
      expect(panel.url()).toBe('app://realtimedocs/panel.html');
      await expect.poll(pageText).toContain('Attachment saved');
      // The page is told that it worked, not where the file went.
      expect(await pageText()).not.toContain(path.basename(target));
      expect(logged('navigation.blocked')).toBe(0);

      // 2. A server that answers the asset request with a redirect to another
      //    server (the real one never redirects). The redirect is not followed:
      //    the other server hears nothing, nothing is saved, the person is told.
      serverA.clear();
      fs.rmSync(target, { force: true });
      await follow(asset(REDIRECTING_ASSET_ID));
      await expect.poll(() => logged('attachment.download_failed')).toBe(1);
      expect(
        serverA.requests.find((entry) => entry.path.endsWith(REDIRECTING_ASSET_ID))?.headers
          .authorization,
      ).toBe(`Bearer ${TOKEN}`);
      await panel.waitForTimeout(500);
      expect(serverB.requests).toEqual([]);
      expect(fs.existsSync(target)).toBe(false);
      expect(await saveDialog.calls()).toHaveLength(1);
      await expect.poll(pageText).toContain('The attachment could not be downloaded');

      // 3. The person cancels the dialog: nothing is written.
      await saveDialog.answerWith(null);
      await follow(asset(GRANT_ID));
      await expect.poll(() => logged('attachment.download_cancelled')).toBe(1);
      expect(fs.existsSync(target)).toBe(false);
      expect(await saveDialog.calls()).toHaveLength(2);

      // 4. One download at a time: clicks while the dialog is open add no dialog.
      await saveDialog.hold();
      await follow(asset(GRANT_ID));
      await expect.poll(async () => (await saveDialog.calls()).length).toBe(3);
      await follow(asset(GRANT_ID));
      await follow(asset(GRANT_ID));
      await panel.waitForTimeout(400);
      expect(await saveDialog.calls()).toHaveLength(3);
      await saveDialog.release(target);
      await expect.poll(() => logged('attachment.download_saved')).toBe(2);
      expect(fs.readFileSync(target).equals(PIXEL)).toBe(true);
      fs.rmSync(target, { force: true });
      await saveDialog.answerWith(target);

      // 4b. A page that goes there by script, with no click or key press for a
      //     few seconds, starts no download and no dialog.
      await panel.waitForTimeout(5200);
      await follow(asset(GRANT_ID), false);
      await expect.poll(() => logged('attachment.refused_not_interactive')).toBe(1);
      expect(await saveDialog.calls()).toHaveLength(3);

      // 5. While nobody could be clicking in the document, the link starts nothing.
      await panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true));
      await waitForState(panel, (state) => state.panel.clickThrough, 'click-through on');
      await follow(asset(GRANT_ID));
      await expect.poll(() => logged('attachment.refused_not_interactive')).toBe(2);
      await panel.evaluate(() => window.rdDesktop?.window.setClickThrough(false));
      await waitForState(panel, (state) => !state.panel.clickThrough, 'click-through off');
      expect(logged('navigation.blocked')).toBe(2);

      // 6. Other addresses the panel is sent to are refused as navigations and start nothing.
      for (const address of [
        `${SERVER_A}/api/documents/${DOC_ID}/assets/${GRANT_ID}`,
        `${SERVER_A}/api/documents/${GRANT_ID}/assets/${GRANT_ID}?download=1`,
        `${SERVER_B}/api/documents/${DOC_ID}/assets/${GRANT_ID}?download=1`,
        `${asset(GRANT_ID)}&next=1`,
      ]) {
        await follow(address);
      }
      await expect.poll(() => logged('navigation.blocked')).toBe(6);
      expect(panel.url()).toBe('app://realtimedocs/panel.html');

      // 7. Chromium itself never downloads anything, whoever asks: a file made
      //    up by a page, or an address handed to the session directly.
      await panel.evaluate(() => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob(['made up by a page'], { type: 'text/plain' }));
        link.download = 'invoice.txt';
        document.body.append(link);
        link.click();
        link.remove();
      });
      await expect.poll(() => logged('download.blocked')).toBe(1);
      await app.evaluate(({ session }, url) => {
        session.fromPartition('persist:realtimedocs').downloadURL(url);
      }, asset(GRANT_ID));
      await expect.poll(() => logged('download.blocked')).toBe(2);

      expect(fs.existsSync(target)).toBe(false);
      expect(await saveDialog.calls()).toHaveLength(3);
      expect(logged('attachment.download_saved')).toBe(2);
      // Nothing about the file is in the log: not its name, not where it went.
      const log = running.stderr.join('');
      expect(log).not.toContain('authorized_keys');
      expect(log).not.toContain(path.basename(target));
      expect(log).not.toContain(TOKEN);
    } finally {
      await running.close();
      fs.rmSync(target, { force: true });
    }
  });
});

test.describe('development override for plain HTTP on a private network', () => {
  // "rd-lan.test" resolves to this machine but, unlike localhost, is an
  // ordinary (not potentially trustworthy) plain-HTTP origin for Chromium.
  const LAN_ORIGIN = `http://rd-lan.test:${PORT_A}`;
  const RESOLVER = '--host-resolver-rules=MAP rd-lan.test 127.0.0.1';
  let server: FakeServer;

  test.beforeAll(async () => {
    server = await startFakeServer(PORT_A);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('is off by default; when turned on, the plain-HTTP server is usable for API, images and the live socket', async () => {
    const running = await launchApp({ args: [RESOLVER] });
    try {
      // Off by default: the address is refused before any request is made.
      expect(await callController(running.app, 'setServer', LAN_ORIGIN)).toMatchObject({
        ok: false,
        code: 'insecure_lan_disabled',
      });
      expect(server.requests).toHaveLength(0);
      expect((await getState(running.panel)).connection.server.origin).toBeNull();

      // A public plain-HTTP address is refused even with the override.
      expect(
        await callController(running.app, 'setConnectionOptions', { allowInsecureLan: true }),
      ).toEqual({ ok: true });
      expect(
        await callController(running.app, 'setServer', 'http://docs.example.com'),
      ).toMatchObject({
        ok: false,
        code: 'insecure_public_http',
      });

      // With the override the address is accepted and labelled as unencrypted.
      expect(await callController(running.app, 'setServer', LAN_ORIGIN)).toEqual({ ok: true });
      const state = await waitForState(
        running.panel,
        (current) => current.connection.server.status === 'ok',
        'lan server ok',
      );
      expect(state.connection.server.transport).toBe('insecure_lan_http');
      expect(state.connection.server.message).toContain('not encrypted');
      await panelReady(running);

      // The packaged page (a secure context) can use it right away: Chromium
      // does not apply mixed-content blocking to the app's own scheme, so no
      // process-level switch and no restart are involved.
      server.clear();
      const reach = await running.panel.evaluate(
        async ([origin, port, documentId, assetId]) => {
          const api = await fetch(`${origin}/api/echo`, { credentials: 'omit' }).then(
            (response) => (response.ok ? 'ok' : `status ${response.status}`),
            () => 'blocked',
          );
          const image = await new Promise<string>((resolve) => {
            const element = new Image();
            element.onload = () => resolve('ok');
            element.onerror = () => resolve('blocked');
            element.src = `${origin}/api/documents/${documentId}/assets/${assetId}`;
          });
          const socket = await new Promise<string>((resolve) => {
            const ws = new WebSocket(`ws://rd-lan.test:${port}/collab`);
            ws.onopen = () => resolve('ok');
            ws.onerror = () => resolve('blocked');
            setTimeout(() => resolve('timeout'), 4000);
          });
          return { api, image, socket, secureContext: window.isSecureContext };
        },
        [LAN_ORIGIN, PORT_A, DOC_ID, GRANT_ID] as const,
      );
      expect(reach).toEqual({ api: 'ok', image: 'ok', socket: 'ok', secureContext: true });
      expect(server.requests.some((request) => request.upgrade && request.path === '/collab')).toBe(
        true,
      );

      // Turning the override off disconnects the plain-HTTP server at once.
      expect(
        await callController(running.app, 'setConnectionOptions', { allowInsecureLan: false }),
      ).toEqual({ ok: true });
      const after = await waitForState(
        running.panel,
        (current) => current.connection.server.origin === null,
        'server cleared',
      );
      expect(after.connection.allowInsecureLan).toBe(false);
    } finally {
      await running.close();
    }
  });
});
