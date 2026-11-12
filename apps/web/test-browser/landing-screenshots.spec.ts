/**
 * Pictures of the landing page at three widths and both themes, for visual review.
 * Chromium only; images go to `.stage/screenshots/landing-<width>-<theme>.png` (whole page),
 * `landing-top-…` (first screen) and `landing-demo-…` (the demonstration on its Presenter scene).
 */
import type { Page } from '@playwright/test';
import { expect, setSavedTheme, test } from './support/test';

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 800 },
  { width: 375, height: 760 },
] as const;

/** Scroll the whole page once so every scroll-reveal has run before the picture is taken. */
async function revealEverything(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

for (const theme of ['dark', 'light'] as const) {
  for (const { width, height } of WIDTHS) {
    test(`landing at ${width}px (${theme})`, async ({ page, api }) => {
      await setSavedTheme(page, theme);
      await page.setViewportSize({ width, height });
      api.desktopReleases = {
        channel: 'stable',
        releases: [
          {
            version: '0.1.0',
            channel: 'stable',
            publishedAt: '2026-11-12T10:00:00.000Z',
            notes: '',
            minimumSupportedVersion: null,
            current: true,
            artifacts: [
              {
                platform: 'windows',
                arch: 'x64',
                format: 'exe',
                fileName: 'RealtimeDocs-0.1.0-windows-x64.exe',
                sizeBytes: 84_300_000,
                sha256: '3f2a9c'.repeat(10) + 'abcd',
                minimumOsVersion: 'Windows 10 (2004) or later',
                signatureStatus: 'unsigned',
                downloadUrl: '/download/releases/stable/0.1.0/RealtimeDocs-0.1.0-windows-x64.exe',
              },
            ],
          },
        ],
      };
      api.signupEnabled = true;
      await page.goto('/');
      await expect(page.getByTestId('hero-download-link')).toBeVisible();
      await page.screenshot({ path: `.stage/screenshots/landing-top-${width}-${theme}.png` });
      const demo = page.getByTestId('product-demo');
      await demo.scrollIntoViewIfNeeded();
      await expect(demo).toBeVisible();
      await page.getByTestId('demo-play').click();
      await demo.getByRole('button', { name: 'Presenter' }).click();
      await page.waitForTimeout(1600);
      await demo.screenshot({ path: `.stage/screenshots/landing-demo-${width}-${theme}.png` });
      await revealEverything(page);
      await page.screenshot({
        path: `.stage/screenshots/landing-${width}-${theme}.png`,
        fullPage: true,
      });
      expect(api.unhandled).toEqual([]);
    });
  }
}
