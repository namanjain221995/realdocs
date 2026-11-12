/**
 * Automated accessibility checks with axe-core (`@axe-core/playwright`) on the public pages and
 * the main signed-in screens, in both themes, plus keyboard checks on the landing page. Only
 * serious and critical findings fail; the others are listed in the failure message too.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  DOC_IDS,
  expect,
  INVITATION_IDS,
  SECRETS,
  setSavedTheme,
  signedInAs,
  test,
  type ThemeName,
  USERS,
} from './support/test';

// The landing page offers the build of the detected platform; these specs publish a Linux build.
test.use({
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
});

async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    blocking.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
    })),
    `axe: serious or critical violations on ${label}`,
  ).toEqual([]);
}

for (const theme of ['dark', 'light'] as const satisfies readonly ThemeName[]) {
  test.describe(`accessibility (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      await setSavedTheme(page, theme);
    });

    test('landing page', async ({ page, api }) => {
      // Colours are measured in the settled state, not half-way through the entrance animation.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      api.signupEnabled = true;
      api.desktopReleases = {
        channel: 'stable',
        releases: [
          {
            version: '1.0.0',
            channel: 'stable',
            publishedAt: '2026-11-12T10:00:00.000Z',
            notes: 'First build.',
            minimumSupportedVersion: null,
            current: true,
            artifacts: [
              {
                platform: 'linux',
                arch: 'x64',
                format: 'tar.gz',
                fileName: 'RealtimeDocs-1.0.0-linux-x64.tar.gz',
                sizeBytes: 84_300_000,
                sha256: 'a'.repeat(64),
                minimumOsVersion: 'Desktop Linux',
                signatureStatus: 'unsigned',
                downloadUrl: '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz',
              },
            ],
          },
        ],
      };
      await page.goto('/');
      await expect(page.getByTestId('download-link')).toBeVisible();
      await audit(page, 'landing');
      // Open every question so that its text is audited too.
      for (const summary of await page.locator('.land-faq__item summary').all()) {
        await summary.click();
      }
      await audit(page, 'landing with the questions open');
    });

    test('sign-in', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await audit(page, 'login');
    });

    test('sign-up', async ({ page, api }) => {
      api.signupEnabled = true;
      await page.goto('/signup');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign up' })).toBeVisible();
      await audit(page, 'signup');
    });

    test('sign-up turned off', async ({ page }) => {
      await page.goto('/signup');
      await expect(page.getByTestId('signup-off')).toBeVisible();
      await audit(page, 'signup (off)');
    });

    test('invitation', async ({ page }) => {
      await page.goto(`/invite/${INVITATION_IDS.pending}#${SECRETS.invite}`);
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
      await audit(page, 'invitation');
    });

    test('documents (dashboard)', async ({ page, api }) => {
      signedInAs(api, USERS.asha);
      await page.goto('/');
      await expect(page.getByTestId('document-row')).toHaveCount(5);
      await audit(page, 'dashboard');
    });

    test('document viewer', async ({ page, api }) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}`);
      await expect(page.getByTestId('document-header')).toBeVisible();
      await audit(page, 'document viewer');
    });

    test('guide pages', async ({ page }) => {
      await page.goto('/guides/security');
      await expect(page.getByTestId('docs-article')).toBeVisible();
      await audit(page, 'docs');
    });
  });
}

test.describe('keyboard', () => {
  test('the landing page can be used without a mouse', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    // The first stop is the skip link; the main actions follow in reading order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    const names: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press('Tab');
      names.push(
        await page.evaluate(
          () =>
            document.activeElement?.textContent?.trim() || document.activeElement?.tagName || '',
        ),
      );
    }
    expect(names).toContain('Sign in');
    expect(names.some((name) => name.startsWith('Download'))).toBe(true);
    // Every focused control shows a visible focus indicator.
    const outlined = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="hero-sign-in"]') as HTMLElement;
      element.focus();
      const style = getComputedStyle(element);
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    });
    expect(outlined).toBe(true);

    // A question opens and closes from the keyboard.
    const first = page.locator('.land-faq__item').first();
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('open', '');
    await expect(first).toContainText('phone camera');
    await page.keyboard.press('Enter');
    await expect(first).not.toHaveAttribute('open', '');

    // The matrix scrolls from the keyboard: its scroll areas are tab stops.
    await expect(
      page.getByRole('region', { name: 'Windows compatibility results' }),
    ).toHaveAttribute('tabindex', '0');
  });
});
