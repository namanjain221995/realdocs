/**
 * Real stack: the download section (`GET /api/downloads`, `GET /download/:file`) and sign-up
 * (`ALLOW_SIGNUP`), against the real server.
 *
 * The server is restarted with `DOWNLOAD_DIR` unset, then pointing at a scratch folder with one
 * dummy file and a `release.json`, and with sign-up on and off, so these run with the outage
 * specs: their own projects, one worker, after everything else.
 */
import { createHash } from 'node:crypto';
import { expect, publishDownload, resetDownloads, setSignup, test, unique } from './support/test';

test.describe.configure({ mode: 'serial' });
// The Playwright desktop devices present themselves as Windows or macOS; this spec needs a Linux
// visitor so that the only published build (Windows) is for another platform.
test.use({
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

const FILE = 'realtimedocs-windows-x64.zip';
const OTHERS = [
  'realtimedocs-windows-arm64.zip',
  'realtimedocs-macos-arm64.zip',
  'realtimedocs-macos-x64.zip',
];

test.afterAll(async () => {
  await resetDownloads();
  await setSignup(false);
});

test('with DOWNLOAD_DIR unset nothing is listed and the page says the release is not published', async ({
  page,
}) => {
  await resetDownloads();
  const listed = await page.request.get('/api/downloads');
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual({ release: null, artifacts: [] });

  await page.goto('/');
  await expect(page.getByTestId('downloads-empty')).toContainText(
    'Release not published — build the desktop app locally (see the Windows, macOS and Linux guides)',
  );
  await expect(page.getByTestId('download-build')).toHaveCount(0);
  await expect(page.getByTestId('download-link')).toHaveCount(0);
  for (const file of [FILE, ...OTHERS]) {
    expect((await page.request.head(`/download/${file}`)).status(), file).toBe(404);
  }
});

test('with one dummy build published, only that build is listed, with version, size and SHA-256', async ({
  page,
}) => {
  await publishDownload(FILE, 2048, { version: '0.0.1-test', signed: false });
  const expectedHash = createHash('sha256').update(Buffer.alloc(2048, 0x5a)).digest('hex');

  await page.goto('/');
  // The test browser is Linux and only a Windows build exists: no dead link, and the manual list has it.
  await expect(page.getByTestId('download-unavailable')).toContainText(
    'No release published for Linux',
  );
  await page.getByTestId('download-choose-other').click();
  await expect(page.getByTestId('download-build')).toHaveCount(1);
  const row = page.locator(`[data-file="${FILE}"]`);
  const link = row.getByTestId('download-link-row');
  await expect(link).toHaveAttribute('href', `/download/${FILE}`);
  await expect(row).toContainText('2 KB');
  await expect(row).toContainText(expectedHash);
  await expect(page.getByTestId('release-version')).toHaveText('Version 0.0.1-test');
  await expect(row).toContainText('Unsigned build');
  for (const name of ['Windows arm64', 'Apple Silicon', 'Intel']) {
    await expect(page.locator('#download')).not.toContainText(name);
  }

  // The link really downloads the file, and it is the one that was hashed.
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe(FILE);
  const response = await page.request.get(`/download/${FILE}`);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.length).toBe(2048);
  expect(createHash('sha256').update(body).digest('hex')).toBe(expectedHash);
  for (const name of OTHERS) {
    expect((await page.request.head(`/download/${name}`)).status(), name).toBe(404);
  }
});

test('a release stated to be signed has no unsigned notice', async ({ page }) => {
  await publishDownload(FILE, 1024, { version: '1.0.0', signed: true });
  await page.goto('/');
  await page.getByTestId('download-choose-other').click();
  await expect(page.getByTestId('download-build')).toHaveCount(1);
  await expect(page.getByTestId('download-build')).toContainText('Signed build.');
  await expect(page.getByTestId('download-build')).not.toContainText('Unsigned');
});

test('sign-up is off by default, and works when the operator turns it on', async ({ page }) => {
  await setSignup(false);
  await page.goto('/');
  await expect(page.getByTestId('hero-sign-in')).toBeVisible();
  await expect(page.getByTestId('hero-sign-up')).toHaveCount(0);
  await page.goto('/signup');
  await expect(page.getByTestId('signup-off')).toContainText(
    'Sign-up is turned off on this server.',
  );
  const refused = await page.request.post('/api/auth/signup', {
    data: { email: 'x@example.com', displayName: 'X', password: 'violet-harbor-lantern-42' },
    headers: { 'x-rd-csrf': '1' },
  });
  expect(refused.status()).toBe(403);

  await setSignup(true);
  await page.goto('/');
  await expect(page.getByTestId('hero-sign-up')).toBeVisible();
  await page.getByTestId('hero-sign-up').click();
  await expect(page).toHaveURL('/signup');
  const email = `${unique('nora').replace(/\s+/g, '.')}@example.com`;
  await page.getByLabel('Name').fill('Nora Quill');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
});
