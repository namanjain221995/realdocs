/**
 * Pictures of the real editor in the real app, for visual review: desktop,
 * tablet and phone widths in both themes. Chromium only (the other projects
 * leave this file out, see `playwright.real.config.ts`). Images go to
 * `.stage/screenshots-real/` (not committed). On the way it checks that no
 * screen scrolls sideways.
 */
import type { Page } from '@playwright/test';
import {
  admin,
  callApi,
  createDocument,
  createShareLink,
  editorContent,
  expect,
  expectEditorReady,
  expectSaved,
  loadedImages,
  openDocument,
  signIn,
  test,
  typeLine,
  unique,
} from './support/test';

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'phone', width: 360, height: 740 },
] as const;
const THEMES = ['dark', 'light'] as const;
const OUT = '.stage/screenshots-real';

async function capture(page: Page, name: string, fullPage = false): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${name}: horizontal overflow of the page`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage, animations: 'disabled' });
}

async function scrollDocument(page: Page, top: number): Promise<void> {
  await page.locator('.rd-editor__scroll').evaluate((element, y) => element.scrollTo(0, y), top);
  await page.waitForTimeout(250);
}

for (const theme of THEMES) {
  for (const size of WIDTHS) {
    test.describe(`${theme}, ${size.name}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      test(`screens at ${size.width}px in the ${theme} theme`, async ({
        page,
        context,
        openContext,
      }) => {
        test.setTimeout(120_000);
        const tag = `${theme}-${size.name}`;
        const useTheme = (value: string) => {
          try {
            window.localStorage.setItem('rd.theme', value);
          } catch {
            // Storage is not available on this page.
          }
        };
        await context.addInitScript(useTheme, theme);

        await page.goto('/login');
        await expect(page.getByTestId('forgot-password-hint')).toBeVisible();
        await capture(page, `${tag}-login`);

        await signIn(page, admin);
        const list = await callApi<{ documents: { id: string; title: string }[] }>(
          page,
          'GET',
          '/api/documents?view=active',
        );
        const sample = list.body.documents.find((document) =>
          document.title.startsWith('Welcome to RealtimeDocs'),
        );
        if (!sample) throw new Error('The seeded sample document is missing.');

        // The sample document, as the administrator: top, table and diagram, image and code.
        await openDocument(page, sample.id);
        const content = editorContent(page);
        await expect.poll(() => loadedImages(content, '.rd-diagram__image')).toBe(1);
        await capture(page, `${tag}-editor-top`);
        await content.locator('table').scrollIntoViewIfNeeded();
        await scrollDocument(page, 760);
        await capture(page, `${tag}-editor-table-diagram`);
        await content.locator('.rd-code').scrollIntoViewIfNeeded();
        await expect.poll(() => loadedImages(content, '.rd-image__img')).toBe(1);
        await capture(page, `${tag}-editor-image-code`);
        await scrollDocument(page, 0);

        // Side panels with real data.
        await page.getByTestId('open-sharing').click();
        await expect(page.getByTestId('live-section')).toBeVisible();
        await capture(page, `${tag}-panel-share`);
        await page.keyboard.press('Escape');
        if (size.name === 'phone') await page.getByTestId('document-more').click();
        await page.getByTestId('open-snapshots').click();
        await expect(page.getByTestId('snapshots-panel')).toBeVisible();
        await capture(page, `${tag}-panel-snapshots`);
        await page.keyboard.press('Escape');

        // A document of our own: typing, a guest watching, then the guest's access revoked.
        const documentId = await createDocument(page, unique('Screens'));
        const link = await createShareLink(page, documentId, { label: 'Review' });
        await openDocument(page, documentId);
        await typeLine(page, 'A paragraph written for the picture.');
        await expectSaved(page);

        const guestContext = await openContext();
        await guestContext.addInitScript(useTheme, theme);
        const guest = await guestContext.newPage();
        await guest.setViewportSize({ width: size.width, height: size.height });
        await guest.goto(link.path);
        await expectEditorReady(guest);
        await expect(editorContent(guest)).toContainText('A paragraph written for the picture.');
        await capture(guest, `${tag}-guest-viewer`);
        await capture(page, `${tag}-editor-with-guest`);

        const revoked = await callApi(
          page,
          'POST',
          `/api/documents/${documentId}/shares/${link.id}/revoke`,
        );
        expect(revoked.status).toBe(200);
        await expect(guest.getByTestId('access-ended')).toBeVisible();
        await capture(guest, `${tag}-guest-access-revoked`);

        // Print view of the sample document.
        await page.goto(`/d/${sample.id}/print`);
        await expect(page.getByTestId('print-button')).toBeEnabled();
        await capture(page, `${tag}-print`, true);

        // Settings, with the sessions section.
        await page.goto('/settings');
        await expect(page.getByTestId('sign-out-everywhere-else')).toBeVisible();
        await capture(page, `${tag}-settings`, true);
      });
    });
  }
}
