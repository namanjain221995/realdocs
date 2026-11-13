/**
 * Acceptance scenario 17 on the REAL stack: the landing page, sign-in, invitation, dashboard,
 * editor (with the real editor, the real sample document, table, code, diagram and image),
 * view-only viewer and the account pages are checked for accessibility with axe-core
 * (WCAG 2.0/2.1 A and AA rules; serious and critical findings fail, the rest is listed in the
 * test annotations) in the light and dark colour schemes, and for horizontal overflow at
 * 360, 768 and 1280 px.
 *
 * The mocked-API suite (`apps/web/test-browser/a11y.spec.ts`) audits the pages around the editor
 * but its editor never connects; this spec adds what that suite cannot see: the editor and the
 * viewer with content. Automated rules find only part of the problems. Screen readers and real
 * touch devices are NOT covered (see docs/testing.md).
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  admin,
  callApi,
  createShareLink,
  editorContent,
  expect,
  expectEditorReady,
  signIn,
  stack,
  test,
  useSavedTheme,
} from '../support/test';

type Scheme = 'light' | 'dark';

async function audit(page: Page, label: string): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const describe = (violation: (typeof results.violations)[number]) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
  });
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking.map(describe), `axe: serious or critical violations on ${label}`).toEqual([]);
  return results.violations.map((violation) => `${label}: ${violation.id} (${violation.impact})`);
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function sampleId(page: Page): Promise<string> {
  const { body } = await callApi<{ documents: { id: string; title: string }[] }>(
    page,
    'GET',
    '/api/documents',
  );
  const sample = body.documents.find((document) =>
    document.title.startsWith('Welcome to RealtimeDocs'),
  );
  expect(sample).toBeTruthy();
  return sample!.id;
}

/** The sample's image and diagram have drawn before the page is judged. */
async function settle(page: Page): Promise<void> {
  // Images are loaded lazily: bring each into view so that it is fetched in every browser.
  for (const image of await editorContent(page).locator('img.rd-image__img').all()) {
    await image.scrollIntoViewIfNeeded();
  }
  await expect
    .poll(() =>
      editorContent(page)
        .locator('img.rd-image__img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)),
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500); // the Mermaid diagram renders asynchronously
}

for (const scheme of ['light', 'dark'] as const satisfies readonly Scheme[]) {
  test.describe(`${scheme} scheme`, () => {
    // Colours are measured in the settled state, not half-way through an entrance animation
    // (the same rule as the mocked-API suite); the saved theme follows the scheme.
    test.use({ colorScheme: scheme, reducedMotion: 'reduce' });
    test.beforeEach(async ({ context }) => {
      await useSavedTheme(context, scheme);
    });

    test('public pages: sign-in (the start page for a visitor), invitation', async ({
      page,
    }, testInfo) => {
      const findings: string[] = [];
      // A visitor is sent to sign in: the product page is for signed-in accounts.
      await page.goto('/');
      await expect(page).toHaveURL('/login');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);

      await page.goto('/login');
      await expect(page.getByLabel('Email')).toBeVisible();
      findings.push(...(await audit(page, 'sign-in')));

      // A real invitation (created through the API by the administrator in a second profile).
      const adminContext = await page
        .context()
        .browser()!
        .newContext({ baseURL: stack.baseUrl, colorScheme: scheme, reducedMotion: 'reduce' });
      try {
        const adminPage = await adminContext.newPage();
        await signIn(adminPage, admin);
        const invitation = await callApi<{ url: string }>(adminPage, 'POST', '/api/invitations', {
          email: `a11y.${Math.random().toString(36).slice(2, 8)}@realtimedocs.test`,
          role: 'member',
        });
        expect(invitation.status).toBeLessThan(300);
        const url = new URL(invitation.body.url, stack.baseUrl);
        await page.goto(`${url.pathname}${url.search}${url.hash}`);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Create your account' }),
        ).toBeVisible();
        findings.push(...(await audit(page, 'invitation')));
      } finally {
        await adminContext.close();
      }
      testInfo.annotations.push({
        type: `axe (${scheme}), not blocking`,
        description: findings.join('; ') || 'none',
      });
    });

    test('signed in: dashboard, product page, editor with content, viewer, settings, accounts', async ({
      page,
      openContext,
    }, testInfo) => {
      test.setTimeout(120_000);
      const findings: string[] = [];
      await signIn(page, admin);
      findings.push(...(await audit(page, 'dashboard')));

      // The product page is for signed-in accounts.
      await page.goto('/product');
      await expect(page.getByTestId('landing')).toBeVisible();
      findings.push(...(await audit(page, 'landing')));
      await page.goto('/documents');

      const id = await sampleId(page);
      await page.goto(`/d/${id}`);
      await expectEditorReady(page);
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      findings.push(...(await audit(page, 'editor (sample document)')));

      const share = await createShareLink(page, id, { role: 'viewer' });
      const guest = await (await openContext()).newPage();
      await guest.goto(share.path);
      await expectEditorReady(guest);
      await settle(guest);
      findings.push(...(await audit(guest, 'viewer (view-only link)')));

      await page.goto('/settings');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      findings.push(...(await audit(page, 'settings')));
      await page.goto('/admin/users');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      findings.push(...(await audit(page, 'accounts')));
      testInfo.annotations.push({
        type: `axe (${scheme}), not blocking`,
        description: findings.join('; ') || 'none',
      });
    });
  });
}

for (const width of [360, 768, 1280]) {
  test(`no page scrolls sideways at ${width}px`, async ({ page, openContext }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    const measured: Record<string, number> = {};
    const measure = async (label: string, target: Page, settleFirst = false) => {
      if (settleFirst) await settle(target);
      measured[label] = await overflow(target);
    };

    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await measure('sign-in', page);

    await signIn(page, admin);
    await measure('dashboard', page);
    await page.goto('/product');
    await expect(page.getByTestId('landing')).toBeVisible();
    await measure('landing', page);
    const id = await sampleId(page);
    await page.goto(`/d/${id}`);
    await expectEditorReady(page);
    await measure('editor', page, true);

    const share = await createShareLink(page, id, { role: 'viewer' });
    const guest = await (await openContext()).newPage();
    await guest.setViewportSize({ width, height: 800 });
    await guest.goto(share.path);
    await expectEditorReady(guest);
    await measure('viewer', guest, true);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await measure('settings', page);

    // Allow one pixel of rounding; wide blocks (tables, code) must scroll inside themselves.
    const offenders = Object.entries(measured).filter(([, extra]) => extra > 1);
    expect(
      offenders,
      `pages wider than the ${width}px window: ${JSON.stringify(measured)}`,
    ).toEqual([]);
  });
}
