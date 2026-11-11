import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DESKTOP_ROOT, controlDialogs, launchApp } from '../smoke/helpers';
import {
  createShare,
  editorContent,
  pasteShareLink,
  sampleDocumentId,
  shot,
  waitLive,
} from './real-helpers';
import { SERVER_ORIGIN } from './stack';

// The PRODUCTION bundle (the one that gets packaged: minified, code-split, no
// test hook) started unpackaged, so the page can be inspected. Everything is
// done through the user interface, except the answer to the main process's
// "use this server?" dialog, which Playwright gives inside the main process
// (nothing can press a native button here). What the app itself noticed is
// read from its log. The packaged build is checked separately, from the
// outside (test/packaged), because a packaged build accepts no debugger.
const PRODUCTION_APP = path.join(DESKTOP_ROOT, '.stage', 'app');

test('production bundle: the sample document with its diagram, image and highlighted code, with no policy violation', async () => {
  expect(
    fs.existsSync(path.join(PRODUCTION_APP, 'main', 'main.cjs')),
    'the production build exists (scripts/real-stack.mjs builds it)',
  ).toBe(true);
  const running = await launchApp({ appDirectory: PRODUCTION_APP });
  try {
    const { panel } = running;
    const documentId = await sampleDocumentId();
    const share = await createShare(documentId, 'viewer');

    // No test hook in this build.
    expect(
      await running.app.evaluate(
        () => (globalThis as { __rdTest?: unknown }).__rdTest === undefined,
      ),
    ).toBe(true);

    // The first server is asked about in the main process's dialog, and the
    // page offers nothing to answer it with.
    const dialogs = await controlDialogs(running.app);
    await dialogs.answerWith('yes');
    await pasteShareLink(panel, share.url);
    await waitLive(panel);
    expect(await dialogs.calls()).toMatchObject([
      { parent: 'panel', message: 'Use this server?', buttons: ['Cancel', 'Use 127.0.0.1:4440'] },
    ]);
    await expect(panel.locator('[data-testid^="rd-pending"]')).toHaveCount(0);

    const content = editorContent(panel);
    await expect(content.locator('h1')).toHaveText('Launch notes: RealtimeDocs demo');
    // Syntax highlighting and the diagram renderer are separate chunks, loaded on demand.
    await expect(content.locator('.rd-code code.hljs span[class^="hljs-"]').first()).toBeVisible();
    const diagram = content.locator('img.rd-diagram__image');
    await expect(diagram).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect
      .poll(() => diagram.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(100);
    const image = content.locator('img.rd-image__img');
    expect(
      ((await image.getAttribute('src')) ?? '').startsWith(
        `${SERVER_ORIGIN}/api/documents/${documentId}/assets/`,
      ),
    ).toBe(true);
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(100);
    await diagram.scrollIntoViewIfNeeded();
    await shot(panel, 'production-bundle-diagram');

    // Every script the page loaded came from the app's own origin (the lazily
    // loaded chunks included: the diagram and the highlighting above prove they ran).
    const scripts = await panel.evaluate(() => [
      ...new Set(
        [
          ...performance.getEntriesByType('resource').map((entry) => entry.name),
          ...[...document.querySelectorAll('script[src], link[rel="modulepreload"]')].map(
            (element) => (element as HTMLScriptElement).src || (element as HTMLLinkElement).href,
          ),
        ].filter((name) => /\.js(\?|$)/.test(name)),
      ),
    ]);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((name) => !name.startsWith('app://realtimedocs/'))).toEqual([]);
    console.log(`production bundle: scripts seen by the page: ${scripts.length}`);

    // The app logs refused policy actions and renderer console errors itself.
    await panel.waitForTimeout(500);
    const log = running.stderr.join('');
    expect(log).toContain('"event":"app.started"');
    for (const event of [
      'renderer.policy_violation',
      'renderer.console',
      'panel.load_failed',
      'panel.renderer_gone',
    ]) {
      expect(log.includes(`"event":"${event}"`), event).toBe(false);
    }
  } finally {
    await running.close();
  }
});
