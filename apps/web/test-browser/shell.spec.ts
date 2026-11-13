import {
  allowConsoleErrors,
  DOC_IDS,
  expect,
  hasHorizontalOverflow,
  signedInAs,
  test,
  USERS,
} from './support/test';

/** The policy the backend sends with the app; the preview server must send exactly this. */
const REQUIRED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:";

test.describe('page delivery', () => {
  test('is served with the production content security policy and passes it', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    const response = await page.goto('/documents');
    expect(response?.headers()['content-security-policy']).toBe(REQUIRED_CSP);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.getByTestId('document-row')).toHaveCount(5);
    // (Any violation fails the test through the harness.)

    // The document itself contains no inline script and asks for no referrer.
    const html = (await response?.text()) ?? '';
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inlineScripts).toEqual([]);
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });

  test('loads fonts and scripts from its own origin only', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    const origins = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http')) origins.add(url.origin);
    });
    await page.goto(`/d/${DOC_IDS.launch}?panel=share`);
    await expect(page.getByTestId('share-row').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect([...origins]).toEqual([new URL(page.url()).origin]);
    // The kit's typeface really loaded (self-hosted), rather than a fallback.
    expect(
      await page.evaluate(() => document.fonts.check('13px "Atkinson Hyperlegible Next Variable"')),
    ).toBe(true);
  });

  test('downloads the editor code only when a document is opened', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    await page.goto('/documents');
    await expect(page.getByTestId('document-row')).toHaveCount(5);
    expect(scripts.filter((path) => /EditorMount|DocumentPage/.test(path))).toEqual([]);

    await page.getByRole('link', { name: 'Q4 launch plan' }).click();
    await expect(page.getByTestId('editor-mount')).toBeVisible();
    expect(scripts.some((path) => /EditorMount/.test(path))).toBe(true);
    // The panels are separate again and still not loaded.
    expect(scripts.filter((path) => /SharingPanel|SnapshotsPanel/.test(path))).toEqual([]);
  });

  test('shows a message, not a blank page, when the session cannot be loaded', async ({
    page,
    api,
  }) => {
    api.abortNext('GET', /^\/api\/auth\/session$/, 3);
    await page.goto('/');
    const error = page.getByTestId('session-error');
    await expect(error).toContainText('The server is not responding');
    await error.getByRole('button', { name: 'Try again' }).click();
    // Not signed in: the sign-in page, and nothing of the product page.
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('landing')).toHaveCount(0);
  });
});

test.describe('when part of the app cannot be loaded', () => {
  test('shows a reload screen instead of a broken page', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    allowConsoleErrors(
      page,
      /dynamically imported module|Importing a module script failed|module script/i,
    );
    await page.goto('/documents');
    await expect(page.getByTestId('document-row')).toHaveCount(5);
    // The settings screen's code is gone, as after a deployment that replaced it.
    await page.route(/\/assets\/SettingsPage-.*\.js$/, (route) => route.abort());
    await page.getByRole('button', { name: 'Account menu for Asha Rao' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const crash = page.getByTestId('crash-screen');
    await expect(crash).toContainText('This page could not be loaded');
    await expect(crash.getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});

test.describe('navigation and accessibility', () => {
  test('puts the navigation in the account menu on a phone', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/settings');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Account menu for Asha Rao' }).click();
    const menu = page.getByRole('menu');
    for (const item of ['Documents', 'People', 'Settings', 'Sign out']) {
      await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
    }
    // The theme can be changed from here without closing the menu.
    await menu.getByRole('menuitemcheckbox', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Documents' }).click();
    await expect(page).toHaveURL('/documents');
  });

  test('has a 404 page for accounts and for visitors', async ({ page, api }) => {
    await page.goto('/nowhere/at/all');
    const anonymous = page.getByTestId('not-found');
    await expect(anonymous).toContainText('Page not found');
    await expect(anonymous.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveTitle('Page not found – RealtimeDocs');

    signedInAs(api, USERS.asha);
    await page.goto('/nowhere/at/all');
    await expect(
      page.getByTestId('not-found').getByRole('link', { name: 'Go to documents' }),
    ).toBeVisible();
    // Signed-in visitors keep the navigation.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('offers a skip link as the first stop, which moves focus to the content', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/documents');
    await expect(page.getByTestId('document-row')).toHaveCount(5);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    // Using it leaves the address alone.
    await expect(page).toHaveURL('/documents');
  });

  test('moves focus to the new page and updates the title on navigation', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/documents');
    await expect(page).toHaveTitle('Documents – RealtimeDocs');
    await page.getByRole('link', { name: 'People' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    await expect(page).toHaveTitle('People: Accounts – RealtimeDocs');
    await expect(page.locator('#main')).toBeFocused();
    await expect(page.getByRole('link', { name: 'People' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The new title is announced to screen readers.
    await expect(page.getByRole('status').filter({ hasText: 'People: Accounts' })).toBeAttached();

    // Changing only the query string (a tab) does not steal focus.
    await page.getByRole('tab', { name: 'Invitations' }).click();
    await expect(page.getByRole('tab', { name: 'Invitations' })).toBeFocused();
  });

  test('can be driven from the keyboard: tabs, row menu and dialog', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/documents');
    await expect(page.getByTestId('document-row')).toHaveCount(5);

    await page.getByRole('tab', { name: 'Active' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Recent' })).toBeFocused();
    await expect(page).toHaveURL('/documents?view=recent');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Active' })).toBeFocused();
    await expect(page).toHaveURL('/documents');
    // Keys pressed faster than the address can follow still end where the last one points.
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Recent' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL('/documents?view=recent');
    await page.keyboard.press('Home');
    await expect(page).toHaveURL('/documents');

    await page.getByTestId('row-actions').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Open' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Rename document' });
    await expect(dialog.getByLabel('Title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus is not lost when the dialog closes.
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  });

  test('labels every form control on the sign-in and settings screens', async ({ page, api }) => {
    const unlabelled = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('input, select, textarea, button')]
          .filter((element) => element.getClientRects().length > 0)
          // Fields hidden from everyone (a username hint for password managers) need no label.
          .filter((element) => element.getAttribute('aria-hidden') !== 'true')
          .filter((element) => {
            const labelled =
              element.getAttribute('aria-label') ||
              element.getAttribute('aria-labelledby') ||
              (element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement
                ? element.labels?.length
                : (element.textContent ?? '').trim());
            return !labelled;
          })
          .map((element) => element.outerHTML.slice(0, 120)),
      );
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(await unlabelled()).toEqual([]);

    signedInAs(api, USERS.asha);
    await page.goto('/settings');
    await expect(page.getByTestId('drafts-empty')).toBeVisible();
    expect(await unlabelled()).toEqual([]);

    await page.goto(`/d/${DOC_IDS.launch}?panel=share`);
    await expect(page.getByTestId('share-row').first()).toBeVisible();
    expect(await unlabelled()).toEqual([]);
  });

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const durations = await page.evaluate(() =>
      [document.querySelector('.app-brand__caret'), document.querySelector('.auth-title')].map(
        (element, index) =>
          element
            ? getComputedStyle(element, index === 1 ? '::after' : null).animationDuration
            : 'missing',
      ),
    );
    // The kit collapses every animation to a single near-instant frame.
    for (const duration of durations) expect(Number.parseFloat(duration)).toBeLessThan(0.01);
  });

  test('applies the saved theme before the app starts', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('rd.theme', 'light'));
    // Hold the app bundle back: the theme must already be right without it.
    let releaseApp: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseApp = resolve;
    });
    await page.route(/\/assets\/index-.*\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/login', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    releaseApp();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('layout', () => {
  const widths = [1280, 820, 360];

  for (const width of widths) {
    test(`does not scroll sideways at ${width}px`, async ({ page, api }) => {
      signedInAs(api, USERS.asha);
      await page.setViewportSize({ width, height: 800 });
      for (const path of [
        '/documents',
        '/documents?view=trash',
        `/d/${DOC_IDS.allHands}`,
        `/d/${DOC_IDS.launch}?panel=share`,
        `/d/${DOC_IDS.launch}?panel=snapshots`,
        `/d/${DOC_IDS.launch}/print`,
        '/settings',
        '/admin/users',
        '/admin/users?tab=invitations',
        '/admin/users?tab=audit',
      ]) {
        await page.goto(path);
        await expect(page.locator('#main')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await hasHorizontalOverflow(page), `${path} at ${width}px`).toBe(false);
      }
    });
  }

  test('keeps a very long title inside the header on a phone', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/d/${DOC_IDS.allHands}`);
    const title = page.getByTestId('document-title');
    await expect(title).toBeVisible();
    const box = await title.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(360);
    // The controls next to it are still on screen.
    await expect(page.getByTestId('open-sharing')).toBeInViewport();
    await expect(page.getByTestId('document-more')).toBeInViewport();
  });
});
