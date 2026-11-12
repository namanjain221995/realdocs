/**
 * Real stack, scenarios e, i and l: what a document looks like and what leaves
 * it. The seeded sample document, exports and the print view, a phone-width
 * screen.
 */
import { readFile } from 'node:fs/promises';
import {
  admin,
  callApi,
  clickTool,
  createDocument,
  createShareLink,
  editorContent,
  expect,
  expectEditorReady,
  expectSaved,
  focusEnd,
  loadedImages,
  openDocument,
  pasteHtml,
  signIn,
  test,
  typeLine,
  unique,
} from './support/test';

const SAMPLE_TITLE = /^Welcome to RealtimeDocs/;

test('the seeded sample document renders completely, without a CSP violation or console error', async ({
  page,
  openContext,
  problems,
}) => {
  const assets: { status: number; type: string }[] = [];
  page.on('response', (response) => {
    if (/\/api\/documents\/[^/]+\/assets\/[^/?]+/.test(response.url())) {
      assets.push({ status: response.status(), type: response.headers()['content-type'] ?? '' });
    }
  });
  await signIn(page, admin);
  await page.getByRole('link', { name: SAMPLE_TITLE }).click();
  await expectEditorReady(page);
  const documentId = page.url().split('/d/')[1] ?? '';

  const render = async (content: ReturnType<typeof editorContent>): Promise<void> => {
    await expect(content.locator('h1')).toContainText('Launch notes');
    // Table with a header row.
    await expect(content.locator('table th').first()).toBeVisible();
    expect(await content.locator('table tr').count()).toBeGreaterThan(1);
    // Code with syntax highlighting.
    const code = content.locator('.rd-code code.hljs');
    await expect(code).toContainText("session.on('status'");
    await expect.poll(() => code.locator('span[class*="hljs-"]').count()).toBeGreaterThan(3);
    // Checklist, link.
    expect(await content.locator('ul[data-type="taskList"] li').count()).toBeGreaterThan(1);
    await expect(content.locator('a[href]', { hasText: 'project background' })).toHaveAttribute(
      'href',
      /^https?:\/\//,
    );
    // Mermaid diagram: rendered, no error, nothing still rendering.
    await expect(content.locator('.rd-diagram__image')).toBeVisible();
    await expect(content.getByTestId('rd-diagram-error')).toHaveCount(0);
    await expect(content.locator('.rd-diagram__status')).toHaveCount(0);
    await expect.poll(() => loadedImages(content, '.rd-diagram__image')).toBe(1);
    // Image: decoded by the browser.
    await expect(content.locator('.rd-image__img')).toHaveCount(1);
    // The page sheet is long and the image is lazy: Firefox and WebKit fetch it once it is scrolled
    // near the viewport, as a reader would.
    await content.locator('.rd-image__img').scrollIntoViewIfNeeded();
    await expect.poll(() => loadedImages(content, '.rd-image__img')).toBe(1);
  };

  const content = editorContent(page);
  await render(content);
  // The image bytes came from the document's authorized asset endpoint.
  expect(await content.locator('.rd-image__img').getAttribute('src')).toMatch(
    new RegExp(`^/api/documents/${documentId}/assets/[0-9a-f-]{36}$`),
  );
  expect(assets).toEqual([{ status: 200, type: expect.stringMatching(/^image\//) }]);

  // A view-only guest sees the same document.
  const link = await createShareLink(page, documentId);
  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await render(editorContent(guest));

  // Not one console error, page error or CSP violation, in either profile: no allowance at all.
  expect(problems.all()).toEqual([]);
});

test('display preferences change this reader’s view only', async ({ page, openContext }) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Display'));
  const link = await createShareLink(page, documentId);
  await openDocument(page, documentId);
  await typeLine(page, 'A paragraph to look at.');
  await expectSaved(page);
  const before = await page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/export?format=json`);
    return response.text();
  }, documentId);

  const guest = await (await openContext()).newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  const look = (view: typeof page) =>
    view.getByTestId('rd-editor').evaluate((root) => {
      const paragraph = root.querySelector('[data-testid="rd-editor-content"] p:last-of-type');
      const sheet = root.querySelector('.rd-editor__page');
      return {
        fontSize: paragraph ? parseFloat(getComputedStyle(paragraph).fontSize) : 0,
        width: sheet ? getComputedStyle(sheet).maxWidth : '',
        background: getComputedStyle(root).backgroundColor,
        theme: root.getAttribute('data-theme'),
      };
    });
  const sheetWidth = (view: typeof page) =>
    view
      .getByTestId('rd-editor')
      .evaluate((root) => root.querySelector('.rd-editor__page')!.getBoundingClientRect().width);
  const guestBefore = await look(guest);
  const guestSheetBefore = await sheetWidth(guest);
  const adminBefore = await look(page);
  expect(guestBefore.theme).toBeNull();

  // The guest makes the text larger, the column wider and the page light.
  await guest.getByTestId('open-display-preferences').click();
  const form = guest.getByTestId('display-preferences');
  await form.getByRole('radio', { name: 'Wide' }).click();
  await form.getByRole('radio', { name: 'Light' }).click();
  await form.getByLabel('Text size').focus();
  for (let step = 0; step < 6; step += 1) await guest.keyboard.press('ArrowRight');
  await guest.keyboard.press('Escape');

  await expect(guest.getByTestId('rd-editor')).toHaveAttribute('data-theme', 'light');
  const guestAfter = await look(guest);
  expect(guestAfter.fontSize).toBeCloseTo(guestBefore.fontSize * 1.3, 1);
  // The normal editor is a page: the reading width no longer changes its sheet ...
  expect(guestAfter.width).toBe(guestBefore.width);
  expect(await sheetWidth(guest)).toBe(guestSheetBefore);
  // ... and the choice is kept for this reader (it applies to reading mode and the desktop panel).
  await guest.getByTestId('open-display-preferences').click();
  await expect(
    guest.getByTestId('display-preferences').getByRole('radio', { name: 'Wide' }),
  ).toBeChecked();
  await guest.keyboard.press('Escape');
  expect(guestAfter.background).not.toBe(guestBefore.background);
  // The app around the document keeps its own theme.
  await expect(guest.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Nobody else sees any of it, and nothing of it is in the document.
  expect(await look(page)).toEqual(adminBefore);
  await typeLine(page, 'Typed after the guest changed their view.');
  await expectSaved(page);
  await expect(editorContent(guest)).toContainText('Typed after the guest changed their view.');
  expect(await look(page)).toEqual(adminBefore);
  const after = await page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/export?format=json`);
    return response.text();
  }, documentId);
  expect(after).not.toContain('1.3');
  expect(after.replace(/Typed after the guest changed their view\./, '')).not.toBe(before);
  expect(JSON.stringify(Object.keys(JSON.parse(after) as object))).toBe(
    JSON.stringify(Object.keys(JSON.parse(before) as object)),
  );

  // The choice stays in the guest's browser across a reload.
  await guest.reload();
  await expectEditorReady(guest);
  await expect(guest.getByTestId('rd-editor')).toHaveAttribute('data-theme', 'light');
  expect((await look(guest)).fontSize).toBeCloseTo(guestBefore.fontSize * 1.3, 1);
  expect(await sheetWidth(guest)).toBe(guestSheetBefore);
  await guest.getByTestId('open-display-preferences').click();
  await expect(
    guest.getByTestId('display-preferences').getByRole('radio', { name: 'Wide' }),
  ).toBeChecked();
});

test('links in a document open in a new tab without an opener or a referrer; mail links open in place', async ({
  page,
  openContext,
  problems,
}) => {
  // Browsers without a mail program report that they cannot follow a mailto: link.
  problems.allow(/mailto|scheme|registered handler|protocol/i);
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Links'));
  const link = await createShareLink(page, documentId);
  await openDocument(page, documentId);
  await pasteHtml(
    page,
    '<p>Read the <a href="https://example.com/realtimedocs/background?x=1">background</a>, ' +
      'write to <a href="mailto:press@example.com">the press desk</a>, ' +
      'not <a href="javascript:alert(1)">this</a>.</p>',
  );
  const content = editorContent(page);
  await expect(content.locator('a[href^="https://example.com/"]')).toHaveText('background');
  // A script address never becomes a link.
  await expect(content.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(content).toContainText('not this.');
  await expectSaved(page);

  const guestContext = await openContext();
  // No request leaves this machine: the outside page is answered here.
  const outside: { url: string; referer: string }[] = [];
  await guestContext.route('https://example.com/**', async (route) => {
    const request = route.request();
    // No header at all, or (WebKit) an empty one: either way nothing is said.
    outside.push({ url: request.url(), referer: (await request.allHeaders()).referer ?? '' });
    await route.fulfill({ contentType: 'text/html', body: '<title>Outside</title><p>Outside</p>' });
  });
  const guest = await guestContext.newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  const guestContent = editorContent(guest);

  // A reader's plain click opens a web link in a new tab.
  const [opened] = await Promise.all([
    guestContext.waitForEvent('page'),
    guestContent.locator('a[href^="https://example.com/"]').click(),
  ]);
  await opened.waitForLoadState();
  expect(opened.url()).toBe('https://example.com/realtimedocs/background?x=1');
  // The new tab cannot reach back into the document, and was not told where it came from.
  expect(await opened.evaluate(() => window.opener === null)).toBe(true);
  expect(await opened.evaluate(() => document.referrer)).toBe('');
  expect(outside).toEqual([
    { url: 'https://example.com/realtimedocs/background?x=1', referer: '' },
  ]);
  await opened.close();
  await expect(guest).toHaveURL(new RegExp(`/d/${documentId}$`));

  // A mail link is handed to the system in place: no empty tab is left behind.
  const pages = guestContext.pages().length;
  await guestContent.locator('a[href^="mailto:"]').click();
  await guest.waitForTimeout(1_000);
  expect(guestContext.pages().length).toBe(pages);
  await expect(guest).toHaveURL(new RegExp(`/d/${documentId}$`));
  await expect(guestContent).toContainText('the press desk');
});

test('Open in Desktop gets a one-time handoff from the server and hands it to the system', async ({
  page,
  browserName,
  problems,
}) => {
  // No desktop app is installed in the test browsers; each says so in its own words.
  problems.allow(/realtimedocs|scheme|protocol|Not allowed to launch/i);
  const addresses: string[] = [];
  page.on('request', (request) => addresses.push(request.url()));
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Handoff'));
  await openDocument(page, documentId);

  // What the server answers: a realtimedocs:// link for this document and this server.
  const handoff = await callApi<{ url: string; expiresAt: string }>(
    page,
    'POST',
    `/api/documents/${documentId}/desktop-handoff`,
  );
  expect(handoff.status).toBeLessThan(300);
  const target = new URL(handoff.body.url);
  expect(target.protocol).toBe('realtimedocs:');
  expect(target.searchParams.get('doc')).toBe(documentId);
  const code = target.searchParams.get('code') ?? '';
  expect(code.length).toBeGreaterThan(20);

  await page.getByTestId('open-in-desktop').click();
  const dialog = page.getByTestId('desktop-dialog');
  await expect(dialog.getByTestId('desktop-server-address')).toHaveValue(
    target.searchParams.get('server') ?? '',
  );
  if (browserName === 'firefox') {
    // Firefox replaces the page with an error when nothing handles the link,
    // so the app explains first and leaves the second click to the person.
    await expect(dialog.getByTestId('desktop-launch')).toHaveText('Open desktop app');
  } else {
    // The app accepted the server's answer and followed it; the document stays on screen.
    await expect(dialog.getByTestId('desktop-launched')).toContainText(
      'asked to open RealtimeDocs Desktop',
    );
    await expect(dialog.getByTestId('desktop-failed')).toHaveCount(0);
  }
  await expect(page.getByTestId('document-title')).toBeVisible();
  // No handoff code in the address bar, in any web request or on the page.
  expect(page.url()).not.toContain('code=');
  expect(addresses.filter((url) => url.startsWith('http') && url.includes(code))).toEqual([]);
  await expect(page.locator('body')).not.toContainText(code);
});

test('exports download under the document’s name and the print view shows the document', async ({
  page,
  context,
  browserName,
}) => {
  await signIn(page, admin);
  const marker = unique('Exported sentence');
  const documentId = await createDocument(page, 'Roadmap: Überblick 2027');
  await openDocument(page, documentId);
  await typeLine(page, marker);
  await clickTool(page, 'Bold');
  await page.keyboard.type(' bold tail');
  await expectSaved(page);

  const download = async (item: string) => {
    await page.getByTestId('open-export').click();
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(item).click(),
    ]);
    const path = await file.path();
    return { name: file.suggestedFilename(), bytes: await readFile(path) };
  };

  // The server names the file after the title ("Roadmap_ Überblick 2027"). WebKit
  // writes the spaces of a suggested name as underscores; the name is the same otherwise.
  const named = (name: string): string =>
    browserName === 'webkit' ? name.replace(/ /g, '_') : name;

  const text = await download('export-txt');
  expect(text.name).toBe(named('Roadmap_ Überblick 2027.txt'));
  expect(text.bytes.toString('utf8')).toContain(`${marker} bold tail`);

  const markdown = await download('export-md');
  expect(markdown.name).toBe(named('Roadmap_ Überblick 2027.md'));
  expect(markdown.bytes.toString('utf8')).toContain(`${marker} **bold tail**`);

  const archive = await download('export-md-zip');
  expect(archive.name).toBe(named('Roadmap_ Überblick 2027.zip'));
  // A zip archive: local file header signature, and the Markdown file inside.
  expect(archive.bytes.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
  expect(archive.bytes.includes(Buffer.from('document.md'))).toBe(true);

  // The print view opens in a new tab and shows the document on a light sheet.
  await page.getByTestId('open-export').click();
  const [print] = await Promise.all([
    context.waitForEvent('page'),
    page.getByTestId('export-print').click(),
  ]);
  await expect(print).toHaveURL(new RegExp(`/d/${documentId}/print$`));
  const sheet = print.getByTestId('print-body');
  await expect(sheet.getByTestId('rd-static-content')).toContainText(`${marker} bold tail`);
  await expect(sheet.locator('strong')).toHaveText('bold tail');
  await expect(print.locator('.print-title')).toHaveText('Roadmap: Überblick 2027');
  await expect(print.getByTestId('print-button')).toBeEnabled();
  // Printed, only the sheet is left: toolbar and instructions are not part of the PDF.
  await print.emulateMedia({ media: 'print' });
  await expect(print.getByTestId('print-toolbar')).toBeHidden();
  await expect(print.getByTestId('print-help')).toBeHidden();
  await expect(sheet).toBeVisible();
});

test('the print view of the sample document renders its table, code, image and diagram', async ({
  page,
}) => {
  await signIn(page, admin);
  const list = await callApi<{ documents: { id: string; title: string }[] }>(
    page,
    'GET',
    '/api/documents?view=active',
  );
  const sample = list.body.documents.find((document) => SAMPLE_TITLE.test(document.title));
  expect(sample, 'the seeded sample document').toBeTruthy();
  await page.goto(`/d/${sample?.id}/print`);
  const sheet = page.getByTestId('print-body');
  await expect(sheet.locator('h1').first()).toContainText('Launch notes');
  await expect(sheet.locator('table th').first()).toBeVisible();
  await expect
    .poll(() => sheet.locator('code.hljs span[class*="hljs-"]').count())
    .toBeGreaterThan(3);
  // "Print" is offered once everything is on the sheet, including what is far below the fold:
  // the image and the diagram are loaded without anyone scrolling to them.
  await expect(page.getByTestId('print-button')).toBeEnabled();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await loadedImages(sheet, '.rd-image__img')).toBe(1);
  expect(await loadedImages(sheet, '.rd-diagram__image')).toBe(1);
  await expect(sheet.getByTestId('rd-diagram-error')).toHaveCount(0);
  // The document sits on the white sheet, not on a tinted page of its own.
  expect(
    await sheet
      .getByTestId('rd-static-document')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
});

test('printing the document screen itself prints the whole document, light, without the app around it', async ({
  page,
  context,
  browserName,
}) => {
  // The dark theme is the hard case: paper must come out light all the same.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('rd.theme', 'dark');
    } catch {
      // Storage is not available on this page.
    }
  });
  await signIn(page, admin);
  await page.getByRole('link', { name: SAMPLE_TITLE }).click();
  await expectEditorReady(page);
  const content = editorContent(page);
  await expect.poll(() => loadedImages(content, '.rd-diagram__image')).toBe(1);

  await page.emulateMedia({ media: 'print' });
  for (const chrome of ['document-header', 'rd-toolbar', 'capture-status']) {
    await expect(page.getByTestId(chrome)).toBeHidden();
  }
  await expect(content.locator('h1')).toBeVisible();
  const layout = await page.evaluate(() => {
    const scroll = document.querySelector('.rd-editor__scroll') as HTMLElement;
    const blocks = document.querySelectorAll('[data-testid="rd-editor-content"] > *');
    const last = blocks[blocks.length - 1] as HTMLElement;
    return {
      scrollsInside: scroll.scrollHeight - scroll.clientHeight > 1,
      pageHeight: document.documentElement.scrollHeight,
      lastBlockEnd: Math.round(last.getBoundingClientRect().bottom + window.scrollY),
      viewport: window.innerHeight,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      pageBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
  // Nothing is left inside a scrolling box: the page is as long as the document.
  expect(layout.scrollsInside).toBe(false);
  expect(layout.pageHeight).toBeGreaterThan(layout.viewport);
  expect(layout.lastBlockEnd).toBeLessThanOrEqual(layout.pageHeight);
  expect(layout.colorScheme).toBe('light');
  expect(layout.pageBackground).toBe('rgb(255, 255, 255)');

  if (browserName === 'chromium') {
    // Chromium can write the PDF a person would save: more than one page, so nothing was cut off.
    const pdf = await page.pdf({ printBackground: true });
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(2);
  }
});

test.describe('at phone width (360px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the toolbar is usable, the page never scrolls sideways, wide blocks scroll inside themselves', async ({
    page,
  }) => {
    await signIn(page, admin);
    const documentId = await createDocument(page, unique('Narrow'));
    await openDocument(page, documentId);

    const pageOverflow = (): Promise<number> =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);

    // The toolbar is one row that scrolls sideways inside itself; every tool can be reached.
    const toolbar = page.getByTestId('rd-toolbar');
    await expect(toolbar).toBeVisible();
    const bar = await toolbar.boundingBox();
    expect(bar?.width).toBeLessThanOrEqual(360);

    await editorContent(page).click();
    await page.keyboard.type('Typed on a phone, ');
    await clickTool(page, 'Bold');
    await page.keyboard.type('bold');
    await clickTool(page, 'Bold');
    await expect(editorContent(page).locator('p strong')).toHaveText('bold');
    // A tool at the far end of the bar: scrolled into view and used.
    await clickTool(page, 'Quote');
    await expect(editorContent(page).locator('blockquote')).toContainText('Typed on a phone');
    await clickTool(page, 'Quote');

    // A table and a line of code far wider than the screen.
    const cells = (tag: string): string =>
      Array.from({ length: 9 }, (_, index) => `<${tag}>Column number ${index + 1}</${tag}>`).join(
        '',
      );
    await pasteHtml(
      page,
      `<table><tbody><tr>${cells('th')}</tr><tr>${cells('td')}</tr></tbody></table>` +
        `<pre><code>const veryLongLine = '${'wide '.repeat(60)}';</code></pre><p>After the blocks.</p>`,
    );
    const content = editorContent(page);
    await expect(content.locator('table td')).toHaveCount(9);
    await expect(content.locator('.rd-code')).toHaveCount(1);
    await expectSaved(page);

    const scrollsInside = (selector: string) =>
      content.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          wider: element.scrollWidth > element.clientWidth + 1,
          scrollable: style.overflowX === 'auto' || style.overflowX === 'scroll',
          withinScreen: box.left >= 0 && box.right <= window.innerWidth + 0.5,
        };
      });
    expect(await scrollsInside('.tableWrapper')).toEqual({
      wider: true,
      scrollable: true,
      withinScreen: true,
    });
    expect(await scrollsInside('.rd-code__pre')).toEqual({
      wider: true,
      scrollable: true,
      withinScreen: true,
    });
    expect(await pageOverflow()).toBeLessThanOrEqual(0);

    // The header's actions still work: the sharing panel opens as a full-screen sheet.
    await page.getByTestId('open-sharing').click();
    const panel = page.getByTestId('sharing-panel');
    await expect(panel).toHaveAttribute('data-mode', 'sheet');
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // And the sample document, with everything in it, does not overflow either.
    await page.getByTestId('back-to-documents').click();
    await page.getByRole('link', { name: SAMPLE_TITLE }).click();
    await expectEditorReady(page);
    await expect(editorContent(page).locator('.rd-diagram__image')).toBeVisible();
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    await focusEnd(page);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
  });
});
