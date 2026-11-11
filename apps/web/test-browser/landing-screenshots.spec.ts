/**
 * Pictures of the landing page and a document page at three widths and both
 * themes, for visual review. Chromium only; images go to `.stage/screenshots/`.
 */
import { expect, setSavedTheme, test } from './support/test';

const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 820, height: 1100 },
  { width: 360, height: 740 },
] as const;

for (const theme of ['dark', 'light'] as const) {
  for (const { width, height } of WIDTHS) {
    test(`landing and docs at ${width}px (${theme})`, async ({ page, api }) => {
      await setSavedTheme(page, theme);
      await page.setViewportSize({ width, height });
      api.downloads = {
        release: { version: '0.1.0', notes: null, signed: false },
        artifacts: [
          {
            file: 'realtimedocs-windows-x64.zip',
            platform: 'windows',
            arch: 'x64',
            bytes: 84_300_000,
            sha256: '3f2a9c'.repeat(10) + 'abcd',
            modifiedAt: '2026-11-10T10:00:00.000Z',
            url: '/download/realtimedocs-windows-x64.zip',
          },
        ],
      };
      api.signupEnabled = true;
      await page.goto('/');
      await expect(page.getByTestId('download-link')).toBeVisible();
      await page.waitForTimeout(4800);
      await page.screenshot({
        path: `.stage/screenshots/landing-${width}-${theme}.png`,
        fullPage: true,
      });
      await page.screenshot({ path: `.stage/screenshots/landing-top-${width}-${theme}.png` });

      await page.goto('/docs/windows-client');
      await expect(page.getByTestId('docs-article')).toBeVisible();
      await page.screenshot({ path: `.stage/screenshots/docs-${width}-${theme}.png` });
      expect(api.unhandled).toEqual([]);
    });
  }
}
