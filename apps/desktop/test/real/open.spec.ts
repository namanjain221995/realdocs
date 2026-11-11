import fs from 'node:fs';
import path from 'node:path';
import { parseDesktopHandoffUrl } from '@realtimedocs/contracts';
import { expect, test } from '@playwright/test';
import {
  controlDialogs,
  getState,
  launchApp,
  launchSecondInstance,
  recordExternalOpens,
  waitForState,
} from '../smoke/helpers';
import {
  consoleEntries,
  createDocument,
  createShare,
  editorContent,
  headerConnection,
  headerSave,
  launchConnected,
  mainProcessToken,
  pasteShareLink,
  policyViolations,
  rendererVisibleText,
  sampleDocumentId,
  serverLogText,
  shot,
  waitLive,
} from './real-helpers';
import { SERVER_ORIGIN, adminAccount } from './stack';

// Opening a document against the real server: "Paste share link" and "Open in Desktop".

test('first run: a pasted view-only link opens the sample document read-only, with a clean console', async () => {
  const running = await launchApp();
  try {
    const opened = await recordExternalOpens(running.app);
    const documentId = await sampleDocumentId();
    const share = await createShare(documentId, 'viewer');
    const { panel } = running;

    // No server is configured yet. The link's server is never adopted silently:
    // the main process asks in its own dialog, which no page can answer. The
    // test answers in the person's place, by pressing the button that is not "Cancel".
    const dialogs = await controlDialogs(running.app);
    await dialogs.answerWith('yes');
    expect((await getState(panel)).connection).toMatchObject({
      server: { origin: null },
      session: null,
    });
    await pasteShareLink(panel, share.url);
    const state = await waitForState(
      panel,
      (current) => current.connection.session !== null,
      'the document session',
      30_000,
    );
    const asked = await dialogs.calls();
    expect(asked).toHaveLength(1);
    const { detail, ...question } = asked[0] ?? { detail: '' };
    expect(question).toEqual({
      parent: 'panel',
      type: 'question',
      message: 'Use this server?',
      buttons: ['Cancel', `Use ${new URL(SERVER_ORIGIN).host}`],
      defaultId: 0,
      cancelId: 0,
      withdrawable: true,
    });
    expect(detail).toContain(`The link belongs to:\n${SERVER_ORIGIN}\n`);
    expect(detail).not.toContain(share.url.split('#')[1] ?? 'missing');
    expect(state.connection.server.origin).toBe(SERVER_ORIGIN);
    expect(state.connection.session).toMatchObject({
      documentId,
      role: 'viewer',
      via: 'share_link',
      accountId: null,
    });
    // The panel reloaded for the new server's policy; the editor then connects.
    await waitLive(panel);

    // Header: title, live, view only, and nothing about saving for a reader.
    await expect(panel.locator('[data-testid="rd-panel-title"]')).toContainText(
      'sample launch notes',
    );
    await expect(headerConnection(panel)).toHaveText('Live');
    await expect(panel.locator('[data-testid="rd-header-access"]')).toHaveText('View only');
    await expect(headerSave(panel)).toHaveCount(0);

    // The document: heading, table, highlighted code, diagram, image, link.
    const content = editorContent(panel);
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute(
      'data-editable',
      'false',
    );
    expect(await content.evaluate((element) => (element as HTMLElement).isContentEditable)).toBe(
      false,
    );
    await expect(content.locator('h1')).toHaveText('Launch notes: RealtimeDocs demo');
    await expect(content.locator('table tr')).toHaveCount(4);
    await expect(content.locator('.rd-code code.hljs span[class^="hljs-"]').first()).toBeVisible();
    const diagram = content.locator('img.rd-diagram__image');
    await expect(diagram).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect
      .poll(() => diagram.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(100);
    const image = content.locator('img.rd-image__img');
    const source = (await image.getAttribute('src')) ?? '';
    expect(source.startsWith(`${SERVER_ORIGIN}/api/documents/${documentId}/assets/`)).toBe(true);
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(100);
    // That address is the authorised asset endpoint: without the session it serves nothing.
    expect((await fetch(source)).status).toBe(401);

    // Reading only: typing changes nothing.
    const before = await content.innerText();
    await content.locator('h1').click();
    await panel.keyboard.type('this must not appear');
    await panel.waitForTimeout(500);
    expect(await content.innerText()).toBe(before);

    // A link goes to the validated external path of the main process, and nowhere else.
    await content.locator('a[href^="https://example.com/"]').click();
    await expect.poll(opened).toEqual(['https://example.com/realtimedocs/background']);
    expect(running.app.windows()).toHaveLength(1);
    expect(panel.url()).toBe('app://realtimedocs/panel.html');

    // The secret of the link is not kept in the page once it was used.
    expect(await rendererVisibleText(panel)).not.toContain(share.url.split('#')[1] ?? 'missing');

    await panel.locator('.rd-editor__scroll').evaluate((scroller) => scroller.scrollTo(0, 0));
    await shot(panel, 'sample-view-only-top');
    await content.locator('table').scrollIntoViewIfNeeded();
    await shot(panel, 'sample-view-only-table');
    await diagram.scrollIntoViewIfNeeded();
    await shot(panel, 'sample-view-only-diagram');
    await image.scrollIntoViewIfNeeded();
    await shot(panel, 'sample-view-only-image');

    // Not one refused policy action, console error or console warning in the whole flow.
    expect(await policyViolations(running.app)).toEqual([]);
    expect(await consoleEntries(running.app)).toEqual([]);
  } finally {
    await running.close();
  }
});

test("first run: saying no to the question about the link's server sends nothing and changes nothing", async () => {
  const running = await launchApp();
  try {
    const { panel } = running;
    const share = await createShare(await sampleDocumentId(), 'viewer');
    const secret = share.url.split('#')[1] ?? 'missing';
    const dialogs = await controlDialogs(running.app);
    await dialogs.answerWith('no');
    const logBefore = serverLogText().length;

    await pasteShareLink(panel, share.url);
    await expect.poll(async () => (await dialogs.calls()).length).toBe(1);
    const state = await waitForState(
      panel,
      (current) => current.connection.busy === null,
      'the answer',
    );
    expect(state.connection).toMatchObject({
      server: { origin: null, status: 'unset' },
      session: null,
    });
    await expect(panel.locator('[data-testid="rd-empty-no-server"]')).toBeVisible();

    // Asking again at once does not bring the question back.
    await pasteShareLink(panel, share.url);
    await expect(panel.locator('[data-testid="rd-paste-form"]')).toContainText(
      'You chose not to use',
    );
    expect(await dialogs.calls()).toHaveLength(1);

    // The real server heard nothing from this app: no check, no exchange.
    await panel.waitForTimeout(500);
    const since = serverLogText().slice(logBefore);
    expect(since).not.toContain('/api/share/exchange');
    expect(since).not.toContain('/api/meta');
    // The key of the link is not in the app's log, and the app stored no session.
    expect(running.stderr.join('')).not.toContain(secret);
    expect(await mainProcessToken(running.app)).toBeNull();
    expect(fs.existsSync(path.join(running.userData, 'session.bin'))).toBe(false);
  } finally {
    await running.close();
  }
});

test('"Open in Desktop": a handoff from the signed-in browser session is redeemed once and nothing secret is logged', async () => {
  const running = await launchConnected();
  try {
    const { panel } = running;
    const admin = await adminAccount();
    const documentId = await createDocument('Handoff target', ['Opened from the browser.']);

    // What the web app does when "Open in Desktop" is chosen.
    const handoff = await admin.api.desktop.createHandoff(documentId);
    expect(parseDesktopHandoffUrl(handoff.url)).toEqual({
      serverOrigin: SERVER_ORIGIN,
      documentId,
      code: handoff.code,
    });

    // What the operating system does with the link on Linux: start the app again with it.
    expect(await launchSecondInstance(running.userData, [handoff.url])).toBe(0);
    const state = await waitForState(
      panel,
      (current) => current.connection.session?.documentId === documentId,
      'the redeemed session',
      30_000,
    );
    expect(state.connection.session).toMatchObject({ via: 'handoff', role: 'editor' });
    expect(state.connection.session?.accountId).toMatch(/^[0-9a-f-]{36}$/);
    await waitLive(panel);
    await expect(editorContent(panel)).toContainText('Opened from the browser.');
    // An administrator's desktop session edits; it never manages.
    await expect(panel.locator('[data-testid="rd-header-access"]')).toHaveText('Can edit');
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute(
      'data-editable',
      'true',
    );
    const sequence = state.connection.session?.sequence;
    await shot(panel, 'handoff-editor');

    // The code is single-use: the same link delivered again fails cleanly and changes nothing.
    expect(await launchSecondInstance(running.userData, [handoff.url])).toBe(0);
    const after = await waitForState(
      panel,
      (current) => current.connection.notice?.code === 'handoff_invalid',
      'the refusal of the reused code',
      30_000,
    );
    expect(after.connection.session).toMatchObject({ documentId, sequence });
    await expect(panel.locator('[data-testid="rd-notice"]')).toContainText('already used');
    await expect(headerConnection(panel)).toHaveAttribute('data-state', 'live');
    await shot(panel, 'handoff-reused-code');

    // The long-lived token exists in the main process only.
    const token = await mainProcessToken(running.app);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const visible = await rendererVisibleText(panel);
    expect(visible.includes(token ?? 'missing')).toBe(false);
    expect(visible.includes(handoff.code)).toBe(false);
    // Neither the code nor the token is in the app's log, the server's log, or on disk in the profile.
    for (const secret of [handoff.code, token ?? 'missing']) {
      expect(running.stderr.join('').includes(secret)).toBe(false);
      expect(serverLogText().includes(secret)).toBe(false);
    }
    const profileFiles = fs
      .readdirSync(running.userData, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
    for (const file of profileFiles) {
      // Chromium's own databases can be large; a token would be a short ASCII run anywhere in them.
      expect(fs.readFileSync(file).includes(token ?? 'missing'), file).toBe(false);
    }
  } finally {
    await running.close();
  }
});
