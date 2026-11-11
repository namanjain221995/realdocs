/**
 * Scenario 20, browser half. The deployment was created by `run.mjs` from the README's steps; this
 * spec does what README step 5 and "Normal use" describe: open the address, sign in with the
 * generated password, open the sample, create a document of one's own, type, see "Saved", reload.
 */
import { expect, test } from '@playwright/test';

const email = process.env.RD_FRESH_EMAIL ?? '';
const password = process.env.RD_FRESH_PASSWORD ?? '';

test('a fresh deployment reaches a first working document', async ({ page }) => {
  expect(email && password, 'RD_FRESH_EMAIL and RD_FRESH_PASSWORD are set by run.mjs').toBeTruthy();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource|status of 40[134]/i.test(message.text())
    ) {
      problems.push(`console: ${message.text()}`);
    }
  });

  // Step 5: the address, the sign-in, the sample.
  await page.goto('/');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await page
    .getByRole('link', { name: /Welcome to RealtimeDocs/ })
    .first()
    .click();
  const editor = page.getByTestId('rd-editor-content');
  await expect(page.getByTestId('rd-editor')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('rd-status-connection')).toHaveAttribute('data-state', 'live');
  await expect(editor).toContainText('Launch notes: RealtimeDocs demo');
  await expect(editor).toContainText('End of sample.');

  // A document of one's own: create, type, Saved, reload.
  await page.goto('/');
  await page
    .getByRole('button', { name: /new document/i })
    .first()
    .click();
  await expect(page.getByTestId('rd-editor')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('rd-status-connection')).toHaveAttribute('data-state', 'live');
  await editor.click();
  await page.keyboard.type('My first document on a fresh installation.');
  await expect(page.getByTestId('rd-status-save')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect(editor).toContainText('My first document on a fresh installation.');

  // The server's own export agrees.
  const documentId = /\/d\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  const exported = await page.evaluate(
    async (id) => (await fetch(`/api/documents/${id}/export?format=txt`)).text(),
    documentId,
  );
  expect(exported).toContain('My first document on a fresh installation.');
  expect(problems).toEqual([]);
});
