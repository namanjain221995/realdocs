/** Real stack: the public landing page, served by the real server under its real CSP. */
import { expect, test } from './support/test';

test('the landing page loads for a signed-out visitor with no CSP violation', async ({
  page,
  problems,
}) => {
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page.getByTestId('landing')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Private presenter notes with OS-supported screen-share exclusion.',
    }),
  ).toBeVisible();
  // The server's list of builds has been read before we look at the page's problems
  // (the stack runs with DOWNLOAD_DIR unset: nothing is published).
  await expect(page.getByTestId('downloads-empty')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(problems.all().filter((entry) => entry.startsWith('csp:'))).toEqual([]);

  // Sign in is reachable, and the guides open from the footer.
  await page.getByTestId('hero-sign-in').click();
  await expect(page).toHaveURL('/login');
  await page.goto('/docs/security');
  await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', 'security');
  await page.goto('/docs/unknown-guide');
  await expect(page.getByTestId('not-found')).toBeVisible();
});
