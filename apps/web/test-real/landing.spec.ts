/**
 * Real stack: what a visitor gets, and the product page for a signed-in account, served by the
 * real server under its real CSP.
 */
import { admin, expect, signIn, test } from './support/test';

test('a visitor gets the sign-in page and nothing else, with no CSP violation', async ({
  page,
  problems,
}) => {
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByTestId('login-scene')).toBeAttached();
  for (const path of ['/product', '/download', '/docs', '/guides/security']) {
    await page.goto(path);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await expect(page.getByTestId('landing')).toHaveCount(0);
    await expect(page.getByTestId('docs-article')).toHaveCount(0);
  }
  // The description of the API is refused by the server itself, not merely hidden.
  expect((await page.request.get('/api/openapi.json')).status()).toBe(401);
  await page.evaluate(() => document.fonts.ready);
  expect(problems.all().filter((entry) => entry.startsWith('csp:'))).toEqual([]);
});

test('the product page loads for a signed-in account with no CSP violation', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await page.goto('/product');
  await expect(page.getByTestId('landing')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Collaborative documents with a private presenter panel.',
    }),
  ).toBeVisible();
  // The server's list of builds has been read before we look at the page's problems
  // (the stack runs with DOWNLOAD_DIR unset: nothing is published).
  await expect(page.getByTestId('downloads-empty')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(problems.all().filter((entry) => entry.startsWith('csp:'))).toEqual([]);

  // The header says who is signed in; documents, the guides and the developer portal open.
  await expect(page.getByTestId('nav-account')).toBeVisible();
  expect((await page.request.get('/api/openapi.json')).status()).toBe(200);
  await page.goto('/docs');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.goto('/guides/security');
  await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', 'security');
  await page.goto('/guides/unknown-guide');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await page.goto('/product');
  await page.getByTestId('hero-open-documents').click();
  await expect(page).toHaveURL('/documents');
});
