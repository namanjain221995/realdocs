import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { getState, panelFacts, waitForState } from '../smoke/helpers';
import {
  callController,
  consoleEntries,
  createDocument,
  createShare,
  editorContent,
  focusFacts,
  focusWindow,
  headerConnection,
  headerSave,
  launchConnected,
  openShare,
  pageByKind,
  policyViolations,
  remoteEditor,
  shot,
  typeAtEnd,
  waitLive,
} from './real-helpers';
import { adminAccount, serverControl } from './stack';

// A live document in the panel: changes from another client, typing in the
// panel, and what a remote change is NOT allowed to do to the window.

/**
 * Counts calls of the window methods that would show, raise, focus, move or
 * resize the panel. Whatever the app's own state says, a remote edit must not
 * lead to a single one of them.
 */
async function watchPanelWindow(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('/panel.html'),
    );
    if (!panel) throw new Error('panel window not found');
    const calls: string[] = [];
    (globalThis as { __panelCalls?: string[] }).__panelCalls = calls;
    const target = panel as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of [
      'show',
      'showInactive',
      'focus',
      'moveTop',
      'restore',
      'setBounds',
      'setSize',
      'setPosition',
      'setAlwaysOnTop',
      'setIgnoreMouseEvents',
      'flashFrame',
    ]) {
      const original = target[name];
      if (typeof original !== 'function') continue;
      target[name] = (...args: unknown[]) => {
        calls.push(name);
        return original.apply(panel, args);
      };
    }
  });
  return () =>
    app.evaluate(() => [...((globalThis as { __panelCalls?: string[] }).__panelCalls ?? [])]);
}

/** A value set in the page before a remote change; it is gone if the page was reloaded. */
async function markPage(panel: Page): Promise<() => Promise<boolean>> {
  await panel.evaluate(() => {
    (globalThis as { __notReloaded?: boolean }).__notReloaded = true;
  });
  return () =>
    panel.evaluate(() => (globalThis as { __notReloaded?: boolean }).__notReloaded === true);
}

test('a remote edit appears without a reload and does not focus, show, raise, move or resize the panel', async () => {
  const documentId = await createDocument('Remote edit check', ['The first line.']);
  const share = await createShare(documentId, 'viewer');
  const remote = await remoteEditor(documentId);
  const running = await launchConnected();
  try {
    const { app, panel } = running;
    await openShare(running, share);
    await expect(editorContent(panel)).toContainText('The first line.');

    // Another window has the keyboard, as when the user types somewhere else.
    await panel.evaluate(() => window.rdDesktop?.window.action('open-settings'));
    const settings = await pageByKind(app, 'settings');
    await settings.waitForSelector('[data-testid="rd-settings"]');
    await focusWindow(app, 'settings');
    await expect.poll(async () => (await focusFacts(app)).focused).toBe('settings');

    const stillSamePage = await markPage(panel);
    const windowCalls = await watchPanelWindow(app);
    const before = await focusFacts(app);
    expect(before).toMatchObject({ focused: 'settings', panelFocused: false, panelVisible: true });

    remote.appendParagraph('Typed by another client.');
    await remote.saved();
    await expect(editorContent(panel)).toContainText('Typed by another client.');
    // A second one, to be sure nothing is deferred to the next change.
    remote.appendParagraph('And a second remote line.');
    await remote.saved();
    await expect(editorContent(panel)).toContainText('And a second remote line.');
    await panel.waitForTimeout(600);

    expect(await stillSamePage()).toBe(true);
    expect(await focusFacts(app)).toEqual(before);
    expect(await windowCalls()).toEqual([]);
    await expect(headerConnection(panel)).toHaveAttribute('data-state', 'live');

    // Control: this environment does report a focus change, and the watcher does
    // see window calls, when they happen on purpose.
    await focusWindow(app, 'panel');
    await expect.poll(async () => (await focusFacts(app)).focused).toBe('panel');
    expect(await windowCalls()).toContain('focus');
    await shot(panel, 'remote-edit-arrived');
  } finally {
    remote.destroy();
    await running.close();
  }
});

test('hidden, collapsed and click-through panels stay as they are through remote edits, stay connected, and can be brought back', async () => {
  const documentId = await createDocument('State check', ['Start.']);
  const share = await createShare(documentId, 'viewer');
  const remote = await remoteEditor(documentId);
  const running = await launchConnected();
  try {
    const { app, panel } = running;
    await openShare(running, share);
    const stillSamePage = await markPage(panel);
    const expandedHeight = (await panelFacts(app)).bounds.height;

    // ── Collapsed ──
    await panel.click('[data-testid="rd-collapse-button"]');
    await waitForState(panel, (state) => state.panel.collapsed, 'collapsed');
    await expect.poll(async () => (await panelFacts(app)).bounds.height).toBe(44);
    let windowCalls = await watchPanelWindow(app);
    remote.appendParagraph('Arrived while collapsed.');
    await remote.saved();
    await panel.waitForTimeout(1200);
    expect((await getState(panel)).panel.collapsed).toBe(true);
    expect((await panelFacts(app)).bounds.height).toBe(44);
    expect(await windowCalls()).toEqual([]);
    // Still connected: the header keeps reporting, and the text is there when the panel opens.
    await expect(headerConnection(panel)).toHaveAttribute('data-state', 'live');
    await panel.click('[data-testid="rd-collapse-button"]');
    await waitForState(panel, (state) => !state.panel.collapsed, 'expanded');
    await expect.poll(async () => (await panelFacts(app)).bounds.height).toBe(expandedHeight);
    await expect(editorContent(panel)).toContainText('Arrived while collapsed.');

    // ── Hidden ──
    await panel.evaluate(() => window.rdDesktop?.window.action('hide'));
    await expect.poll(async () => (await panelFacts(app)).visible).toBe(false);
    windowCalls = await watchPanelWindow(app);
    remote.appendParagraph('Arrived while hidden.');
    await remote.saved();
    await panel.waitForTimeout(1200);
    expect((await panelFacts(app)).visible).toBe(false);
    expect(await windowCalls()).toEqual([]);
    // Recovery path 1: the tray / menu-bar item.
    expect(await callController(app, 'triggerMenuAction', 'toggle-visibility')).toEqual({
      ok: true,
    });
    await expect.poll(async () => (await panelFacts(app)).visible).toBe(true);
    await expect(editorContent(panel)).toContainText('Arrived while hidden.');
    await expect(headerConnection(panel)).toHaveAttribute('data-state', 'live');

    // ── Click-through ──
    await panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true));
    await waitForState(panel, (state) => state.panel.clickThrough, 'click-through on');
    windowCalls = await watchPanelWindow(app);
    remote.appendParagraph('Arrived during click-through.');
    await remote.saved();
    await expect(editorContent(panel)).toContainText('Arrived during click-through.');
    await panel.waitForTimeout(600);
    expect((await getState(panel)).panel.clickThrough).toBe(true);
    expect(await windowCalls()).toEqual([]);
    await shot(panel, 'click-through-with-remote-edit');
    // Recovery path 2: the global shortcut's handler.
    expect(await callController(app, 'triggerShortcut', 'returnToInteractive')).toEqual({
      ok: true,
    });
    await waitForState(panel, (state) => !state.panel.clickThrough, 'interactive again');
    // And the tray item "Return to interactive mode".
    await panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true));
    await waitForState(panel, (state) => state.panel.clickThrough, 'click-through on again');
    expect(await callController(app, 'triggerMenuAction', 'return-to-interactive')).toEqual({
      ok: true,
    });
    await waitForState(panel, (state) => !state.panel.clickThrough, 'interactive via the tray');

    // One page from start to end: none of this reloaded the document.
    expect(await stillSamePage()).toBe(true);
    expect(await policyViolations(app)).toEqual([]);
  } finally {
    remote.destroy();
    await running.close();
  }
});

test('edit link: typing in the panel reaches the other client, and Saved means stored (it survives a killed server)', async () => {
  const documentId = await createDocument('Editing check', ['Written before the test.']);
  const share = await createShare(documentId, 'editor');
  const remote = await remoteEditor(documentId);
  const running = await launchConnected();
  try {
    const { panel } = running;
    await openShare(running, share);
    await expect(panel.locator('[data-testid="rd-header-access"]')).toHaveText('Can edit');
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute(
      'data-editable',
      'true',
    );
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved');

    // Every save state the header shows from now on, with the moment it appeared.
    await panel.evaluate(() => {
      const seen: string[] = [];
      (globalThis as { __saveStates?: string[] }).__saveStates = seen;
      const read = () =>
        document.querySelector('[data-testid="rd-header-save"]')?.getAttribute('data-state') ??
        'none';
      let last = read();
      new MutationObserver(() => {
        const next = read();
        if (next !== last) {
          last = next;
          seen.push(next);
        }
      }).observe(document.querySelector('[data-testid="rd-panel-header"]') ?? document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });

    await typeAtEnd(panel, ' Typed in the desktop panel.');
    await remote.waitForText('Typed in the desktop panel.');
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved');
    await expect(headerSave(panel)).toHaveText('Saved');
    const states = await panel.evaluate(
      () => (globalThis as { __saveStates?: string[] }).__saveStates ?? [],
    );
    // While the change was on its way the header said so; "saved" came after it.
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toBe('saving');
    expect(states.at(-1)).toBe('saved');
    await shot(panel, 'typed-and-saved');

    // "Saved" was shown, so the change is in the database: kill the server
    // without any shutdown, start it, and read the stored document.
    await serverControl.kill();
    await serverControl.start();
    const admin = await adminAccount();
    const stored = await admin.api.documents.exportText(documentId, 'txt');
    expect(stored).toContain('Typed in the desktop panel.');
    // The panel finds its way back by itself.
    await waitLive(panel, 90_000);
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved');
  } finally {
    remote.destroy();
    await running.close();
  }
});

test('view link: typing changes nothing, and changing the appearance never changes the document', async () => {
  const documentId = await createDocument('Read-only check', ['Only for reading.']);
  const share = await createShare(documentId, 'viewer');
  const remote = await remoteEditor(documentId);
  const running = await launchConnected();
  try {
    const { app, panel } = running;
    await openShare(running, share);
    const content = editorContent(panel);
    const before = remote.text();
    const shown = await content.innerText();

    await content.click();
    await panel.keyboard.press('Control+End');
    await panel.keyboard.type('not allowed');
    await panel.keyboard.press('Backspace');
    await panel.keyboard.press('Control+a');
    await panel.keyboard.press('Delete');
    await panel.keyboard.press('Control+b');
    await panel.waitForTimeout(1000);
    expect(await content.innerText()).toBe(shown);
    expect(remote.text()).toBe(before);
    await expect(headerSave(panel)).toHaveCount(0);
    await expect(panel.locator('[data-testid="rd-toolbar"]')).toHaveCount(0);

    // Reader preferences are local: opacity, text size, width, text colour, readability aid.
    const update = (appearance: Record<string, unknown>) =>
      panel.evaluate(
        (patch) => window.rdDesktop?.preferences.update({ appearance: patch as never }),
        appearance,
      );
    await update({ backgroundAlpha: 0.3, fontScale: 1.4, readingWidth: 'narrow' });
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute(
      'data-reading-width',
      'narrow',
    );
    await update({ readability: 'scrim' });
    await shot(panel, 'live-low-alpha-scrim');
    await update({ readability: 'outline', foreground: 'dark' });
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute('data-theme', 'light');
    await shot(panel, 'live-dark-text-outline');
    // The document surface itself is transparent: the panel's own surface shows through.
    expect(
      await panel
        .locator('[data-testid="rd-editor"]')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
    // Text is opaque whatever the surface opacity.
    expect(
      await content
        .locator('p')
        .first()
        .evaluate((element) => getComputedStyle(element).opacity),
    ).toBe('1');
    await update({
      backgroundAlpha: 0.86,
      fontScale: 1,
      readingWidth: 'normal',
      readability: 'off',
      foreground: 'light',
    });
    await panel.waitForTimeout(500);
    expect(remote.text()).toBe(before);
    expect(await policyViolations(app)).toEqual([]);
    expect(await consoleEntries(app)).toEqual([]);
  } finally {
    remote.destroy();
    await running.close();
  }
});

test('Follow Latest: off by default, follows when on, pauses on scroll and selection, and edits above never move the reader', async () => {
  const lines = Array.from(
    { length: 70 },
    (_unused, index) =>
      `Paragraph ${index + 1}: enough text to take a line or two in the panel, so the document is much taller than the window.`,
  );
  const documentId = await createDocument('Follow check', lines);
  const share = await createShare(documentId, 'viewer');
  const remote = await remoteEditor(documentId);
  const running = await launchConnected();
  try {
    const { panel } = running;
    await openShare(running, share);
    const content = editorContent(panel);
    await expect(content).toContainText('Paragraph 70:');
    const scroller = panel.locator('.rd-editor__scroll');
    const scrollTop = () => scroller.evaluate((element) => Math.round(element.scrollTop));
    /** Where a paragraph sits relative to the visible part of the document, in pixels. */
    const place = (text: string) =>
      panel.evaluate((needle) => {
        const scrollElement = document.querySelector('.rd-editor__scroll');
        const paragraph = [
          ...document.querySelectorAll('[data-testid="rd-editor-content"] p'),
        ].find((element) => element.textContent?.includes(needle));
        if (!scrollElement || !paragraph) return null;
        const view = scrollElement.getBoundingClientRect();
        const box = paragraph.getBoundingClientRect();
        return {
          top: Math.round(box.top - view.top),
          visible: box.bottom > view.top && box.top < view.bottom,
        };
      }, text);
    const follow = panel.locator('[data-testid="rd-follow-latest"]');

    // Off by default: a change at the end leaves the reader at the top.
    expect((await getState(panel)).behaviour.followLatest).toBe(false);
    await expect(follow).toHaveAttribute('data-state', 'off');
    remote.appendParagraph('Appended while Follow Latest was off.');
    await remote.saved();
    await expect(content).toContainText('Appended while Follow Latest was off.');
    await panel.waitForTimeout(600);
    expect(await scrollTop()).toBe(0);

    // On, from the panel's header control: the next change is brought into view.
    await panel.click('[data-testid="rd-follow-toggle"]');
    await waitForState(panel, (state) => state.behaviour.followLatest, 'follow latest on');
    await expect(follow).toHaveAttribute('data-state', 'on');
    remote.appendParagraph('Latest change A.');
    await remote.saved();
    await expect.poll(async () => (await place('Latest change A.'))?.visible).toBe(true);
    await shot(panel, 'follow-latest-on');

    // The reader scrolls back: following pauses, and the next change does not move them.
    const box = await scroller.boundingBox();
    if (!box) throw new Error('no scroll area');
    await panel.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const bottom = await scrollTop();
    for (let step = 0; step < 6; step += 1) {
      await panel.mouse.wheel(0, -300);
      await panel.waitForTimeout(120);
    }
    await expect(follow).toHaveAttribute('data-state', 'paused');
    await expect.poll(async () => bottom - (await scrollTop())).toBeGreaterThan(900);
    await panel.waitForTimeout(400);
    const paused = await scrollTop();
    remote.appendParagraph('Latest change B.');
    await remote.saved();
    await expect(content).toContainText('Latest change B.');
    await expect(panel.locator('[data-testid="rd-jump-latest"]')).toBeVisible();
    await panel.waitForTimeout(600);
    expect(Math.abs((await scrollTop()) - paused)).toBeLessThanOrEqual(2);
    expect((await place('Latest change B.'))?.visible).toBe(false);
    await shot(panel, 'follow-latest-paused');

    // "Jump to latest" brings them to the change and resumes.
    await panel.click('[data-testid="rd-jump-latest"]');
    await expect.poll(async () => (await place('Latest change B.'))?.visible).toBe(true);
    await expect(follow).toHaveAttribute('data-state', 'on');

    // Selecting text pauses as well.
    await panel.mouse.wheel(0, -500);
    await expect(follow).toHaveAttribute('data-state', 'paused');
    await panel.click('[data-testid="rd-follow-latest"]'); // resume
    await expect(follow).toHaveAttribute('data-state', 'on');
    await content.locator('p', { hasText: 'Latest change B.' }).dblclick();
    await expect
      .poll(() => panel.evaluate(() => (window.getSelection()?.toString() ?? '').length))
      .toBeGreaterThan(0);
    await expect(follow).toHaveAttribute('data-state', 'paused');
    const selecting = await scrollTop();
    remote.appendParagraph('Latest change C.');
    await remote.saved();
    await expect(content).toContainText('Latest change C.');
    await expect(panel.locator('[data-testid="rd-jump-latest"]')).toBeVisible();
    await panel.waitForTimeout(600);
    expect(Math.abs((await scrollTop()) - selecting)).toBeLessThanOrEqual(2);

    // Changes above the viewport never move the reader, with following off…
    await panel.click('[data-testid="rd-follow-toggle"]');
    await waitForState(panel, (state) => !state.behaviour.followLatest, 'follow latest off');
    await content.locator('p', { hasText: 'Paragraph 35:' }).scrollIntoViewIfNeeded();
    await panel.waitForTimeout(400);
    const anchor = await place('Paragraph 35:');
    expect(anchor?.visible).toBe(true);
    for (let index = 0; index < 5; index += 1) {
      remote.insertParagraph(0, `Inserted at the very top, number ${index + 1}.`);
    }
    await remote.saved();
    await expect(content).toContainText('Inserted at the very top, number 5.');
    await panel.waitForTimeout(600);
    const moved = await place('Paragraph 35:');
    expect(Math.abs((moved?.top ?? 9999) - (anchor?.top ?? 0))).toBeLessThanOrEqual(2);
    await shot(panel, 'edits-above-did-not-move-reader');
  } finally {
    remote.destroy();
    await running.close();
  }
});
