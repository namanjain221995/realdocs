import type { Page } from '@playwright/test';
import {
  DOC_IDS,
  expect,
  hasHorizontalOverflow,
  setSavedTheme,
  signedInAs,
  test,
  type ThemeName,
  USERS,
} from './support/test';

const WIDTHS = [1280, 820, 360] as const;
const THEMES: readonly ThemeName[] = ['dark', 'light'];

const artifact = (
  platform: 'windows' | 'macos',
  arch: 'x64' | 'arm64',
  bytes: number,
  digit: string,
) => ({
  file: `realtimedocs-${platform}-${arch}.zip`,
  platform,
  arch,
  bytes,
  sha256: digit.repeat(64),
  modifiedAt: '2026-11-10T10:00:00.000Z',
  url: `/download/realtimedocs-${platform}-${arch}.zip`,
});

test.describe('home page', () => {
  test('a signed-out visitor sees the landing page, not the sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Private presenter notes with OS-supported screen-share exclusion.',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('hero-second')).toHaveText(
      'Verify your exact meeting setup before relying on privacy mode.',
    );
    await expect(page.getByTestId('hero-caveat')).toHaveText(
      'Behavior depends on your operating system, meeting application, capture mode, and version. Verify your setup before relying on it.',
    );
    await expect(page.getByTestId('landing')).toContainText('RealtimeDocs');
    await expect(page.getByTestId('hero-download')).toHaveAttribute('href', '/#download');
  });

  test('a signed-in visitor still gets the dashboard', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/');
    await expect(page.getByTestId('document-row')).toHaveCount(5);
    await expect(page.getByTestId('landing')).toHaveCount(0);
  });

  test('"Sign in" leads to the sign-in screen, which also opens directly', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('hero-sign-in').click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  test('"Download the desktop app" scrolls to the download section', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('hero-download').click();
    await expect(page).toHaveURL('/#download');
    await expect(page.locator('#download')).toBeInViewport();
  });

  test('footer links open the bundled documents', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('navigation', { name: 'Footer' });
    for (const [href, slug] of [
      ['/docs/readme', 'readme'],
      ['/docs/windows-client', 'windows-client'],
      ['/docs/macos-client', 'macos-client'],
      ['/docs/security', 'security'],
    ] as const) {
      await expect(footer.locator(`a[href="${href}"]`)).toHaveCount(1);
      await footer.locator(`a[href="${href}"]`).click();
      await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', slug);
      await page.goBack();
      await expect(page.getByTestId('landing')).toBeVisible();
    }
    await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

test.describe('landing copy', () => {
  test('describes screen sharing honestly', async ({ page }) => {
    await page.goto('/');
    const section = page.getByTestId('presenter-section');
    await expect(section).toContainText(
      'The sure way, on every system and meeting app: share a single application window instead of your whole screen, or keep your notes on a second screen or device you don’t share.',
    );
    const text = (await section.innerText()).replace(/\s+/g, ' ');
    for (const sentence of [
      'Private mode in the desktop app asks the operating system to leave its own window out of screen capture.',
      'On Windows 10 (version 2004) and later it usually keeps the panel out of a shared screen, including an entire-screen share.',
      'On macOS, today’s meeting apps capture it anyway: keep your notes on a second display, an iPad or your phone.',
      'Nothing hides it from a phone camera.',
      'Test once with a second participant.',
    ]) {
      expect(text).toContain(sentence);
    }
    // The sure method comes first.
    expect(text.indexOf('The sure way')).toBeLessThan(text.indexOf('Private mode'));

    // The owner's exact sentences, the guide and the test center.
    await expect(page.getByTestId('presenter-caveat')).toHaveText(
      'Behavior depends on your operating system, meeting application, capture mode, and version. Verify your setup before relying on it.',
    );
    expect(text).toContain(
      'Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share a selected application, window, or browser tab and verify using another participant.',
    );
    const guide = page.getByTestId('safe-share-guide');
    await expect(guide).toContainText('Safe Share Guide');
    await expect(guide).toContainText('Keep RealtimeDocs outside the source you selected.');
    await expect(guide).toContainText('Privacy Test Center');
    await expect(guide).toContainText('never as a general promise');
  });

  test('says the app needs no special permissions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing')).toContainText(
      'asks for no microphone, camera or screen-recording permission, and needs no administrator rights for normal use',
    );
  });

  test('never promises what it cannot keep', async ({ page }) => {
    await page.goto('/');
    // textContent, so that the answers in closed questions are scanned as well.
    const text = ((await page.getByTestId('landing').textContent()) ?? '').toLowerCase();
    for (const word of [
      '100% invisible',
      'undetectable',
      'bypasses every meeting app',
      'cannot be recorded',
      'hidden from all monitoring',
      'guaranteed on macos',
      'proctoring-proof',
      'invisible',
      'guaranteed',
      'bypass',
      'hidden from every',
    ]) {
      expect(text, word).not.toContain(word);
    }
    expect(text).not.toMatch(/turn off (smartscreen|gatekeeper)|disable (smartscreen|gatekeeper)/);
  });
});

test.describe('downloads', () => {
  test('lists only the published builds, with version, size and SHA-256', async ({ page, api }) => {
    api.downloads = {
      release: { version: '0.1.0', notes: 'First public build.', signed: false },
      artifacts: [
        artifact('macos', 'arm64', 91_234_567, 'b'),
        artifact('windows', 'x64', 84_300_000, 'a'),
      ],
    };
    await page.goto('/');
    const rows = page.getByTestId('download-build');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('release-version')).toHaveText('Version 0.1.0');
    await expect(page.getByTestId('release-notes')).toHaveText('First public build.');

    // Stable order: Windows before macOS, whatever order the server answered in.
    await expect(rows.nth(0)).toContainText('Windows x64');
    await expect(rows.nth(1)).toContainText('macOS Apple Silicon (arm64)');
    const windows = page.locator('[data-file="realtimedocs-windows-x64.zip"]');
    await expect(windows.getByTestId('download-link')).toHaveAttribute(
      'href',
      '/download/realtimedocs-windows-x64.zip',
    );
    await expect(windows).toContainText('84.3 MB');
    await expect(windows.getByTestId('download-sha256')).toHaveText('a'.repeat(64));
    await expect(
      page.locator('[data-file="realtimedocs-macos-arm64.zip"]').getByTestId('download-link'),
    ).toContainText('91.2 MB');

    // Nothing that is not published is listed, and nothing is invented.
    await expect(page.locator('#download')).not.toContainText('Windows arm64');
    await expect(page.locator('#download')).not.toContainText('Intel');
    await expect(page.getByText('Not published yet')).toHaveCount(0);
    expect(await page.locator('#download a[href^="/download/"]').count()).toBe(2);
  });

  test('says the release is not published when the list is empty', async ({ page }) => {
    await page.goto('/');
    const empty = page.getByTestId('downloads-empty');
    await expect(empty).toContainText(
      'Release not published — build the desktop app locally (see the Windows and macOS guides)',
    );
    await expect(empty.getByRole('link', { name: 'Windows' })).toHaveAttribute(
      'href',
      '/docs/windows-client',
    );
    await expect(empty.getByRole('link', { name: 'macOS' })).toHaveAttribute(
      'href',
      '/docs/macos-client',
    );
    await expect(page.getByTestId('download-build')).toHaveCount(0);
    await expect(page.locator('#download a[href^="/download/"]')).toHaveCount(0);
  });

  test('shows the unsigned notice unless the release is stated to be signed', async ({
    page,
    api,
  }) => {
    api.downloads = {
      release: { version: '1.0.0', notes: null, signed: true },
      artifacts: [artifact('windows', 'x64', 1000, 'c')],
    };
    await page.goto('/');
    await expect(page.getByTestId('download-build')).toHaveCount(1);
    await expect(page.getByTestId('unsigned-notice')).toHaveCount(0);
  });

  test('names the unsigned-app warnings, links the guides and never says to turn protection off', async ({
    page,
    api,
  }) => {
    api.downloads = {
      release: { version: '0.1.0', notes: null, signed: null },
      artifacts: [artifact('windows', 'x64', 1000, 'c')],
    };
    await page.goto('/');
    const notice = page.getByTestId('unsigned-notice');
    await expect(notice).toContainText('SmartScreen');
    await expect(notice).toContainText('Gatekeeper');
    await expect(notice).toContainText('Leave those protections switched on');
    await expect(notice.getByRole('link', { name: 'Windows guide' })).toHaveAttribute(
      'href',
      '/docs/windows-client',
    );
    await expect(notice.getByRole('link', { name: 'macOS guide' })).toHaveAttribute(
      'href',
      '/docs/macos-client',
    );
    const section = page.locator('#download');
    await expect(section).toContainText('No install? Open your share link in any modern browser.');
    await expect(section).toContainText('Or just use it in your browser');
    await section.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/login');
  });

  test('with no release.json the unsigned notice still shows', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('unsigned-notice')).toBeVisible();
  });
});

test.describe('compatibility matrix', () => {
  test('every cell says "Not tested" while there are no verified results', async ({ page }) => {
    await page.goto('/');
    const matrix = page.getByTestId('compatibility-matrix');
    await expect(matrix.getByRole('table')).toHaveCount(2);
    const cells = matrix.getByTestId('matrix-cell');
    // Two platforms, six meeting apps, four capture modes.
    await expect(cells).toHaveCount(2 * 6 * 4);
    for (const cell of await cells.all()) await expect(cell).toHaveText('Not tested');
    await expect(matrix.locator('[data-verified]')).toHaveCount(0);
    for (const name of [
      'Zoom',
      'Microsoft Teams',
      'Google Meet',
      'Webex',
      'Lark',
      'Amazon Chime',
    ]) {
      await expect(matrix.getByRole('rowheader', { name }).first()).toBeVisible();
    }
    for (const name of ['Tab', 'Window', 'Application', 'Entire display']) {
      await expect(matrix.getByRole('columnheader', { name }).first()).toBeVisible();
    }
    const text = await matrix.innerText();
    expect(text).not.toMatch(/[✓✔☑]|\bworks\b/i);
  });
});

test.describe('sign-up', () => {
  test('is not offered on the landing page unless the server enables it', async ({ page, api }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-sign-in')).toBeVisible();
    await expect(page.getByTestId('hero-sign-up')).toHaveCount(0);
    await expect(page.getByTestId('top-sign-up')).toHaveCount(0);
    await expect(page.getByTestId('start-sign-up')).toHaveCount(0);
    await expect(page.getByTestId('get-started')).toContainText(
      'Invitation links come from your administrator',
    );

    api.signupEnabled = true;
    await page.goto('/');
    await expect(page.getByTestId('hero-sign-up')).toBeVisible();
    await expect(page.getByTestId('top-sign-up')).toBeVisible();
    await expect(page.getByTestId('start-sign-up')).toBeVisible();
    await page.getByTestId('hero-sign-up').click();
    await expect(page).toHaveURL('/signup');
  });

  test('/signup says sign-up is off when the server has it off', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByTestId('signup-off')).toContainText(
      'Sign-up is turned off on this server.',
    );
    await expect(page.getByLabel('Email')).toHaveCount(0);
  });

  test('creates an account, signs in and opens the documents', async ({ page, api }) => {
    api.signupEnabled = true;
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Nora Quill');
    await page.getByLabel('Email').fill('nora.quill@example.com');
    await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
    await expect(page.getByTestId('password-strength')).toBeVisible();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
    expect(api.callsTo('POST', /^\/api\/auth\/signup$/)[0]?.body).toEqual({
      email: 'nora.quill@example.com',
      displayName: 'Nora Quill',
      password: 'violet-harbor-lantern-42',
    });
  });

  test('checks the fields before sending anything', async ({ page, api }) => {
    api.signupEnabled = true;
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter the name other people will see.')).toBeVisible();
    await page.getByLabel('Name').fill('Nora');
    await page.getByLabel('Email').fill('nora');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter a complete email address.')).toBeVisible();
    await page.getByLabel('Email').fill('nora@example.com');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/Use at least \d+ characters/)).toBeVisible();
    expect(api.callsTo('POST', /^\/api\/auth\/signup$/)).toHaveLength(0);
  });

  test('a 403 means sign-up is turned off on this server', async ({ page, api }) => {
    api.signupEnabled = true;
    api.failNext('POST', /^\/api\/auth\/signup$/, 'forbidden');
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Nora Quill');
    await page.getByLabel('Email').fill('nora.quill@example.com');
    await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('signup-error')).toContainText(
      'Sign-up is turned off on this server.',
    );
  });

  test('an existing address and a rate limit get their own messages', async ({ page, api }) => {
    api.signupEnabled = true;
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Asha Again');
    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('signup-error')).toContainText('already exists');
    api.failNext('POST', /^\/api\/auth\/signup$/, 'rate_limited', { retryAfterSeconds: 30 });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('signup-error')).toContainText('Too many attempts');
    await expect(page.getByRole('button', { name: /Sign up available in/ })).toBeDisabled();
  });

  test('the sign-in screen points to sign-up only when it is on', async ({ page, api }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'sign up' })).toHaveCount(0);
    api.signupEnabled = true;
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'sign up' })).toHaveAttribute('href', '/signup');
  });
});

test.describe('faq and facts', () => {
  test('answers whether participants can see the notes, honestly', async ({ page }) => {
    await page.goto('/');
    const first = page.getByTestId('faq').locator('details').first();
    await expect(first.locator('summary')).toHaveText('Can meeting participants see my notes?');
    await first.locator('summary').click();
    const text = (await first.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('operating system, meeting application, version and sharing mode');
    expect(text).toContain('Windows 10 (version 2004 and later) and Windows 11');
    expect(text).toContain('whole-display capture may include it');
    expect(text).toContain('verify with a second participant');
  });

  test('has privacy, security and limitations sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('privacy')).toContainText(
      'no microphone, camera or screen-recording permission',
    );
    await expect(page.getByTestId('privacy')).toContainText('stay on your computer');
    await expect(page.getByTestId('security')).toContainText('hash');
    await expect(page.getByTestId('security')).toContainText('view-only by default');
    await expect(page.getByTestId('security')).toContainText('disconnects');
    await expect(page.getByTestId('limitations')).toContainText('has not been verified');
    await expect(page.getByTestId('limitations')).toContainText('phone camera');
  });

  test('shows the five-step workflow', async ({ page }) => {
    await page.goto('/');
    const steps = page.getByTestId('workflow').locator('li');
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toContainText('Create');
    await expect(steps.nth(1)).toContainText('Share');
    await expect(steps.nth(2)).toContainText('Paste the link');
    await expect(steps.nth(3)).toContainText('Open Presenter Mode');
    await expect(steps.nth(4)).toContainText('Verify the meeting setup');
  });
});

test.describe('layout and motion', () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`the landing page does not scroll sideways at ${width}px (${theme})`, async ({
        page,
      }) => {
        await setSavedTheme(page, theme);
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/');
        await expect(page.getByTestId('landing')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await hasHorizontalOverflow(page)).toBe(false);
        // The hero keeps the 16px gutter at phone width.
        if (width === 360) {
          const left = await page
            .getByRole('heading', { level: 1 })
            .evaluate((element) => element.getBoundingClientRect().left);
          expect(left).toBeGreaterThanOrEqual(16);
        }
      });

      test(`the documents do not scroll sideways at ${width}px (${theme})`, async ({ page }) => {
        await setSavedTheme(page, theme);
        await page.setViewportSize({ width, height: 800 });
        for (const slug of ['readme', 'windows-client', 'macos-client', 'security']) {
          await page.goto(`/docs/${slug}`);
          await expect(page.getByTestId('docs-article')).toBeVisible();
          expect(await hasHorizontalOverflow(page), slug).toBe(false);
        }
      });
    }
  }

  test('the hero picture animates by default and is still when motion is reduced', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const line = page.locator('.land-line').first();
    await expect(line).toBeVisible();
    expect(await line.evaluate((el) => getComputedStyle(el).animationName)).toBe('land-type');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const selector of ['.land-line', '.land-caret', '.land-panel', '.land-hero__copy']) {
      const names = await page
        .locator(selector)
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names), selector).toEqual(new Set(['none']));
    }
    // Static: every line is fully shown.
    const clip = await line.evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip === 'none' || clip === 'inset(0px)').toBe(true);
  });
});

test.describe('documents', () => {
  const PAGES = [
    ['readme', 'README', /RealtimeDocs/],
    ['windows-client', 'windows-client.md', /Windows/],
    ['macos-client', 'MACOS-CLIENT', /macOS/],
    ['security', 'Security.md', /ecurity/],
  ] as const;

  for (const [slug, spelling, heading] of PAGES) {
    test(`/docs/${slug} renders, also spelled ${spelling}`, async ({ page }) => {
      for (const name of [slug, spelling]) {
        await page.goto(`/docs/${name}`);
        const article = page.getByTestId('docs-article');
        await expect(article).toHaveAttribute('data-doc', slug);
        await expect(article.getByRole('heading', { level: 1 }).first()).toContainText(heading);
        expect(await article.locator('p, li').count()).toBeGreaterThan(5);
      }
    });
  }

  test('puts nothing but text and plain elements on the page', async ({ page }) => {
    for (const slug of ['readme', 'windows-client', 'macos-client', 'security']) {
      await page.goto(`/docs/${slug}`);
      const article = page.getByTestId('docs-article');
      await expect(article).toBeVisible();
      expect(
        await article.locator('script, iframe, style, img, object, embed, form').count(),
        slug,
      ).toBe(0);
      // Links are either routes of this app, anchors on the page or web addresses in a new tab.
      const hrefs = await article.locator('a').evaluateAll((els) =>
        els.map((el) => ({
          href: el.getAttribute('href') ?? '',
          target: el.getAttribute('target'),
          rel: el.getAttribute('rel'),
        })),
      );
      for (const link of hrefs) {
        expect(link.href, slug).not.toMatch(/^(javascript|data|vbscript):/i);
        if (/^https?:/.test(link.href)) {
          expect(link.target).toBe('_blank');
          expect(link.rel).toContain('noopener');
        }
      }
    }
  });

  test('links between the documents stay in the app', async ({ page }) => {
    await page.goto('/docs/readme');
    await page
      .getByTestId('docs-article')
      .locator('a[href="/docs/windows-client"]')
      .first()
      .click();
    await expect(page).toHaveURL('/docs/windows-client');
    await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', 'windows-client');
  });

  test('an unknown name gets the not-found screen', async ({ page }) => {
    for (const name of ['nope', 'readme.txt', 'docs', 'security.md.md']) {
      await page.goto(`/docs/${name}`);
      await expect(page.getByTestId('not-found')).toBeVisible();
    }
  });
});

/* ------------------------------------------------------------ reading mode */

/** A Screen Wake Lock stand-in that records what the page asks of it. */
async function installWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Fake extends EventTarget {
      released: boolean;
    }
    const state = { requests: 0, releases: 0, sentinels: [] as Fake[], visible: true };
    (window as unknown as { __wl: typeof state }).__wl = state;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (state.visible ? 'visible' : 'hidden'),
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: (type: string) => {
          if (type !== 'screen') return Promise.reject(new Error('screen only'));
          state.requests += 1;
          const sentinel = new EventTarget() as Fake;
          sentinel.released = false;
          (sentinel as unknown as { release: () => Promise<void> }).release = () => {
            if (!sentinel.released) {
              sentinel.released = true;
              state.releases += 1;
              sentinel.dispatchEvent(new Event('release'));
            }
            return Promise.resolve();
          };
          state.sentinels.push(sentinel);
          return Promise.resolve(sentinel);
        },
      },
    });
  });
}

const wakeLockState = (page: Page) =>
  page.evaluate(() => {
    const state = (
      window as unknown as {
        __wl: { requests: number; releases: number; sentinels: { released: boolean }[] };
      }
    ).__wl;
    return {
      requests: state.requests,
      releases: state.releases,
      held: state.sentinels.filter((sentinel) => !sentinel.released).length,
    };
  });

async function turnReadingModeOn(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 640) {
    await page.getByTestId('document-more').click();
    await page.getByTestId('open-display-preferences').click();
  } else {
    await page.getByTestId('open-display-preferences').click();
  }
  await page.getByTestId('reading-mode-toggle').click();
}

test.describe('reading mode', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.asha);
  });

  test('is in the display menu, shows large text with minimal chrome, and is remembered', async ({
    page,
  }) => {
    await installWakeLock(page);
    await page.goto(`/d/${DOC_IDS.launch}`);
    await expect(page.getByTestId('document-header')).toBeVisible();
    await expect(page.getByTestId('reading-bar')).toHaveCount(0);

    await turnReadingModeOn(page);
    const workspace = page.getByTestId('document-workspace');
    await expect(workspace).toHaveAttribute('data-reading', 'true');
    await expect(workspace).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('reading-bar')).toBeVisible();
    await expect(page.getByTestId('document-header')).toHaveCount(0);
    await expect(page.getByTestId('open-sharing')).toHaveCount(0);
    await expect(page.getByTestId('reading-scale')).toHaveText('140%');

    // The text size is adjustable and saved on this device.
    await page.getByTestId('reading-larger').click();
    await expect(page.getByTestId('reading-scale')).toHaveText('150%');
    const saved = await page.evaluate(() => window.localStorage.getItem('rd.reading.v1'));
    expect(JSON.parse(saved ?? 'null')).toEqual({ enabled: true, fontScale: 1.5, light: false });

    await page.reload();
    await expect(page.getByTestId('reading-bar')).toBeVisible();
    await expect(page.getByTestId('reading-scale')).toHaveText('150%');

    await page.getByTestId('reading-theme').click();
    await expect(page.getByTestId('document-workspace')).toHaveAttribute('data-theme', 'light');

    await page.getByTestId('reading-exit').click();
    await expect(page.getByTestId('document-header')).toBeVisible();
    await expect(page.getByTestId('reading-bar')).toHaveCount(0);
  });

  test('works on a phone and does not scroll sideways', async ({ page }) => {
    await installWakeLock(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/d/${DOC_IDS.launch}`);
    await turnReadingModeOn(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('reading-bar')).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    for (const id of ['reading-exit', 'reading-smaller', 'reading-larger', 'reading-theme']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect((box?.x ?? -1) + (box?.width ?? 0), id).toBeLessThanOrEqual(360);
      expect(box?.x ?? -1, id).toBeGreaterThanOrEqual(0);
    }
  });

  test('keeps the screen awake: acquires, re-acquires when visible again, releases', async ({
    page,
  }) => {
    await installWakeLock(page);
    await page.goto(`/d/${DOC_IDS.launch}`);
    expect(await wakeLockState(page)).toEqual({ requests: 0, releases: 0, held: 0 });

    await turnReadingModeOn(page);
    await expect(page.getByTestId('wake-lock-note')).toHaveText('Screen kept awake');
    expect(await wakeLockState(page)).toEqual({ requests: 1, releases: 0, held: 1 });

    // The browser drops the lock when the page is hidden, and the page asks again on return.
    await page.evaluate(() => {
      const state = (
        window as unknown as {
          __wl: { visible: boolean; sentinels: { release: () => Promise<void> }[] };
        }
      ).__wl;
      state.visible = false;
      document.dispatchEvent(new Event('visibilitychange'));
      // What the browser does to the lock of a hidden page.
      for (const sentinel of state.sentinels) void sentinel.release();
    });
    await page.evaluate(() => {
      (window as unknown as { __wl: { visible: boolean } }).__wl.visible = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await wakeLockState(page)).requests).toBe(2);
    await expect(page.getByTestId('wake-lock-note')).toHaveText('Screen kept awake');

    // Turning reading mode off releases the lock.
    await page.getByTestId('reading-exit').click();
    await expect.poll(async () => (await wakeLockState(page)).held).toBe(0);
    await expect(page.getByTestId('wake-lock-note')).toHaveCount(0);
  });

  test('releases the lock when the reader leaves the page', async ({ page }) => {
    await installWakeLock(page);
    await page.goto(`/d/${DOC_IDS.launch}`);
    await turnReadingModeOn(page);
    await expect(page.getByTestId('wake-lock-note')).toHaveText('Screen kept awake');
    await page.getByTestId('document-workspace').getByTestId('back-to-documents').click();
    await expect(page.getByTestId('document-row').first()).toBeVisible();
    expect((await wakeLockState(page)).held).toBe(0);
  });

  test('says so when the browser cannot keep the screen awake', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    });
    await page.goto(`/d/${DOC_IDS.launch}`);
    await turnReadingModeOn(page);
    await expect(page.getByTestId('wake-lock-note')).toHaveText('Your screen may sleep');
    // Reading mode itself still works.
    await expect(page.getByTestId('reading-bar')).toBeVisible();
  });
});
