import AxeBuilder from '@axe-core/playwright';
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
const LANDING_WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;
const REQUIRED_SENTENCE =
  'OS-assisted capture exclusion. Verify your exact meeting and capture setup before relying on it.';
const UA = {
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macos:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
} as const;
const THEMES: readonly ThemeName[] = ['dark', 'light'];

// Downloads are offered per detected platform; unless a test says otherwise this is a Linux browser.
test.use({ userAgent: UA.linux });

const DIGEST = (digit: string) => digit.repeat(64);

const file = (
  platform: 'windows' | 'macos' | 'linux',
  arch: 'x64' | 'arm64' | 'universal',
  format: 'zip' | 'exe' | 'dmg' | 'appimage' | 'tar.gz',
  sizeBytes: number,
  digit: string,
  signatureStatus: 'signed' | 'unsigned' | 'notarized' | 'dev-signed' = 'unsigned',
) => {
  const fileName = `RealtimeDocs-1.0.0-${platform}-${arch}.${format === 'appimage' ? 'AppImage' : format}`;
  return {
    platform,
    arch,
    format,
    fileName,
    sizeBytes,
    sha256: DIGEST(digit),
    minimumOsVersion: `${platform} test requirement`,
    signatureStatus,
    downloadUrl: `/download/releases/stable/1.0.0/${fileName}`,
  };
};

const releaseOf = (artifacts: ReturnType<typeof file>[], version = '1.0.0') => ({
  channel: 'stable' as const,
  releases: [
    {
      version,
      channel: 'stable' as const,
      publishedAt: '2026-11-12T10:00:00.000Z',
      notes: '- First public build.',
      minimumSupportedVersion: null,
      current: true,
      artifacts,
    },
  ],
});

test.describe('home page', () => {
  test('a signed-out visitor sees the landing page, not the sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Collaborative documents with a private presenter panel.',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('hero-caveat')).toHaveText(REQUIRED_SENTENCE);
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
      ['/guides/readme', 'readme'],
      ['/guides/windows-client', 'windows-client'],
      ['/guides/macos-client', 'macos-client'],
      ['/guides/security', 'security'],
    ] as const) {
      await expect(footer.locator(`a[href="${href}"]`)).toHaveCount(1);
      await footer.locator(`a[href="${href}"]`).click();
      await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', slug);
      await page.goBack();
      await expect(page.getByTestId('landing')).toBeVisible();
    }
    await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  test('/docs is the developer portal and old guide links under /docs redirect to /guides', async ({
    page,
  }) => {
    await page.goto('/docs');
    await expect(page.getByTestId('developers-page')).toHaveAttribute('data-section', 'overview');
    await page.goto('/docs/webhooks');
    await expect(page.getByTestId('developers-page')).toHaveAttribute('data-section', 'webhooks');
    await page.goto('/docs/security');
    await expect(page).toHaveURL('/guides/security');
    await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', 'security');
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
    expect(text.indexOf('The sure way')).toBeLessThan(text.indexOf('On Windows 10 (version 2004)'));

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
      '100%',
      'proctoring',
      'proctor',
      'undetect',
      'invisib',
    ]) {
      expect(text, word).not.toContain(word);
    }
    expect(text).not.toMatch(/turn off (smartscreen|gatekeeper)|disable (smartscreen|gatekeeper)/);
  });
});

test.describe('downloads', () => {
  test('offers the build for the detected platform with version, size, SHA-256 and signature', async ({
    page,
    api,
  }) => {
    api.desktopReleases = releaseOf([
      file('windows', 'x64', 'zip', 84_300_000, 'a'),
      file('linux', 'x64', 'tar.gz', 91_234_567, 'b'),
      file('macos', 'arm64', 'zip', 70_000_000, 'c'),
    ]);
    await page.goto('/');
    // The test browser reports Linux.
    const primary = page.getByTestId('download-primary');
    await expect(primary).toHaveAttribute('data-platform', 'linux');
    await expect(page.getByTestId('release-version')).toHaveText('Version 1.0.0');
    const link = primary.getByTestId('download-link');
    await expect(link).toHaveText('Download for Linux');
    await expect(link).toHaveAttribute(
      'href',
      '/download/releases/stable/1.0.0/RealtimeDocs-1.0.0-linux-x64.tar.gz',
    );
    await expect(primary).toContainText('91.2 MB');
    await expect(primary.getByTestId('download-sha256')).toHaveValue(DIGEST('b'));
    await expect(primary.getByTestId('download-signature')).toContainText('Not code-signed');
    await expect(primary).toContainText('linux test requirement');
    await expect(page.locator('#download')).toContainText('capture');
    // Nothing is installed automatically and the page never says it is.
    await expect(page.locator('#download')).not.toContainText(
      /install(s|ed)? automatically for you/i,
    );
  });

  test('"Choose another platform" lists every file, each with its own link', async ({
    page,
    api,
  }) => {
    api.desktopReleases = releaseOf([
      file('macos', 'arm64', 'zip', 91_234_567, 'b'),
      file('windows', 'x64', 'zip', 84_300_000, 'a'),
      file('linux', 'x64', 'tar.gz', 1000, 'c'),
    ]);
    await page.goto('/');
    await expect(page.getByTestId('download-all')).toHaveCount(0);
    await page.getByTestId('download-choose-other').click();
    const rows = page.getByTestId('download-build');
    await expect(rows).toHaveCount(3);
    // Stable order: Windows, macOS, Linux.
    await expect(rows.nth(0)).toContainText('Windows');
    await expect(rows.nth(1)).toContainText('macOS Apple Silicon');
    await expect(rows.nth(2)).toContainText('Linux');
    await expect(rows.nth(0)).toContainText('Unsigned build — Windows SmartScreen will warn you');
    await expect(rows.nth(1)).toContainText('macOS Gatekeeper');
  });

  test.describe('on Windows', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    test('prefers the signed installer and says when only an unsigned zip exists', async ({
      page,
      api,
    }) => {
      api.desktopReleases = releaseOf([
        file('windows', 'x64', 'zip', 84_300_000, 'a'),
        file('windows', 'x64', 'exe', 90_000_000, 'd', 'signed'),
      ]);
      await page.goto('/');
      await expect(page.getByTestId('download-link')).toHaveAttribute(
        'href',
        /RealtimeDocs-1\.0\.0-windows-x64\.exe$/,
      );
      await expect(page.getByTestId('download-signature')).toHaveText('Signed build.');
      api.desktopReleases = releaseOf([file('windows', 'x64', 'zip', 84_300_000, 'a')]);
      await page.goto('/');
      await expect(page.getByTestId('download-signature')).toContainText(
        'Unsigned build — Windows SmartScreen will warn you',
      );
    });
  });

  test.describe('on a phone', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });
    test('says the app is not available for this device and keeps the manual list', async ({
      page,
      api,
    }) => {
      api.desktopReleases = releaseOf([file('windows', 'x64', 'zip', 1000, 'a')]);
      await page.goto('/');
      await expect(page.getByTestId('download-unsupported')).toContainText(
        'not available for this device',
      );
      await expect(page.getByTestId('download-primary')).toHaveCount(0);
      await page.getByTestId('download-choose-other').click();
      await expect(page.getByTestId('download-build')).toHaveCount(1);
    });
  });

  test('says "No release published for Linux yet" with no dead link when only Windows exists', async ({
    page,
    api,
  }) => {
    api.desktopReleases = releaseOf([file('windows', 'x64', 'zip', 1000, 'a')]);
    await page.goto('/');
    const missing = page.getByTestId('download-unavailable');
    await expect(missing).toContainText('No release published for Linux yet');
    await expect(page.getByTestId('download-link')).toHaveCount(0);
    await expect(page.locator('#download a[href^="/download/"]')).toHaveCount(0);
  });

  test('says the release is not published when nothing is listed', async ({ page }) => {
    await page.goto('/');
    const empty = page.getByTestId('downloads-empty');
    await expect(empty).toContainText('Release not published');
    await expect(empty.getByRole('link', { name: 'Windows' })).toHaveAttribute(
      'href',
      '/guides/windows-client',
    );
    await expect(empty.getByRole('link', { name: 'macOS' })).toHaveAttribute(
      'href',
      '/guides/macos-client',
    );
    await expect(empty.getByRole('link', { name: 'Linux' })).toHaveAttribute(
      'href',
      '/guides/linux-client',
    );
    await expect(page.getByTestId('download-build')).toHaveCount(0);
    await expect(page.locator('#download a[href^="/download/"]')).toHaveCount(0);
  });

  test('a server that still has only the legacy flat files keeps working, signature unstated', async ({
    page,
    api,
  }) => {
    api.downloads = {
      release: { version: '0.1.0', notes: null, signed: null },
      artifacts: [
        {
          file: 'realtimedocs-windows-x64.zip',
          platform: 'windows',
          arch: 'x64',
          bytes: 84_300_000,
          sha256: DIGEST('a'),
          modifiedAt: '2026-11-10T10:00:00.000Z',
          url: '/download/realtimedocs-windows-x64.zip',
        },
      ],
    };
    await page.goto('/');
    await page.getByTestId('download-choose-other').click();
    const row = page.locator('[data-file="realtimedocs-windows-x64.zip"]');
    await expect(row.getByTestId('download-link-row')).toHaveAttribute(
      'href',
      '/download/realtimedocs-windows-x64.zip',
    );
    await expect(row).toContainText('Signature not stated');
    await expect(row).toContainText(DIGEST('a'));
  });

  test('links the sign-in and browser alternatives', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#download');
    await expect(section).toContainText('No install? Open your share link in any modern browser.');
    await expect(section).toContainText('Or just use it in your browser');
    await section.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/login');
  });

  test('/download lists the requirements and links the release notes; /releases/:version shows them', async ({
    page,
    api,
  }) => {
    api.desktopReleases = releaseOf([
      file('windows', 'x64', 'zip', 84_300_000, 'a'),
      file('linux', 'x64', 'tar.gz', 1000, 'c'),
    ]);
    await page.goto('/download');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Download RealtimeDocs Desktop',
    );
    const requirements = page.getByTestId('download-requirements');
    await expect(requirements).toContainText('windows test requirement');
    await expect(requirements).toContainText('No release published for macOS yet.');
    await page.getByTestId('release-history').getByRole('link', { name: 'Version 1.0.0' }).click();
    await expect(page).toHaveURL('/releases/1.0.0');
    await expect(page.getByTestId('release-notes-body')).toContainText('First public build.');
    await expect(page.getByTestId('download-build')).toHaveCount(2);
  });

  test('an unknown release is a not-found page', async ({ page }) => {
    await page.goto('/releases/9.9.9');
    await expect(page.getByRole('heading', { name: /not found/i }).first()).toBeVisible();
  });
});

test.describe('compatibility matrix', () => {
  test('the per-app grid is not shown while no test is recorded', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('platform-table')).toBeVisible();
    // The grid appears with the first complete record in verified-configurations.json.
    await expect(page.getByTestId('compatibility-matrix')).toHaveCount(0);
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
    await expect(first.locator('summary')).toHaveText(
      'Can other participants see the presenter panel?',
    );
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
    await expect(page.getByTestId('security')).toContainText('SHA-256 hashes');
    await expect(page.getByTestId('security')).toContainText('disconnects open connections');
    await expect(page.getByTestId('limitations')).toContainText('has not been verified');
    await expect(page.getByTestId('limitations')).toContainText('not end-to-end encrypted');
  });

  test('explains the session workflow and keeps candidates out of the desktop app', async ({
    page,
  }) => {
    await page.goto('/');
    const section = page.locator('#sessions');
    await expect(section.locator('ol li')).toHaveCount(3);
    await expect(section).toContainText('One request, one document.');
    await expect(section).toContainText('Aarav — Candidate');
    await expect(section).toContainText('Naman — Interviewer');
    await expect(section).toContainText('No desktop app and no download controls');
  });

  test('the FAQ answers the honest questions', async ({ page }) => {
    await page.goto('/');
    const faq = page.getByTestId('faq');
    const text = ((await faq.textContent()) ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('We make no claim about detection.');
    expect(text).toContain('No. The button downloads a file.');
    expect(text).toContain('Nothing is installed automatically.');
    expect(text).toContain('Whatever the release manifest on this server says.');
    expect(text).toContain('Use presenter notes in line with your office and meeting policies.');
    await expect(page.getByTestId('landing')).toContainText(REQUIRED_SENTENCE);
  });
});

test.describe('layout and motion', () => {
  for (const theme of THEMES) {
    for (const width of LANDING_WIDTHS) {
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
        if (width === 320) {
          const left = await page
            .getByRole('heading', { level: 1 })
            .evaluate((element) => element.getBoundingClientRect().left);
          expect(left).toBeGreaterThanOrEqual(16);
        }
      });
    }
    for (const width of WIDTHS) {
      test(`the documents do not scroll sideways at ${width}px (${theme})`, async ({ page }) => {
        await setSavedTheme(page, theme);
        await page.setViewportSize({ width, height: 800 });
        for (const slug of ['readme', 'windows-client', 'macos-client', 'security']) {
          await page.goto(`/guides/${slug}`);
          await expect(page.getByTestId('docs-article')).toBeVisible();
          expect(await hasHorizontalOverflow(page), slug).toBe(false);
        }
      });
    }
  }

  test('the demonstration plays, pauses and jumps between scenes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const demo = page.getByTestId('product-demo');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toBeVisible();
    const play = page.getByTestId('demo-play');
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    await expect(demo).toHaveAttribute('data-playing', 'true');
    // The animated stage is decorative for assistive technology.
    await expect(demo.locator('.demo__stage')).toHaveAttribute('aria-hidden', 'true');
    await play.focus();
    await page.keyboard.press('Enter');
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    await expect(demo).toHaveAttribute('data-playing', 'false');
    await demo.getByRole('button', { name: 'Presenter' }).click();
    await expect(demo).toHaveAttribute('data-scene', '3');
    await expect(demo.locator('.demo__panel')).toContainText('OS protection accepted');
    await expect(demo.locator('.demo__panel')).toContainText('Manual verification required');
    await demo.getByRole('button', { name: 'Saving' }).click();
    await expect(demo.locator('.demo__save-b')).toHaveCSS('opacity', '1');
    await page.getByTestId('demo-next').click();
    await expect(demo).toHaveAttribute('data-scene', '5');
    await page.getByTestId('demo-next').click();
    await expect(demo).toHaveAttribute('data-scene', '0');
    // Paused means paused: it stays on its scene.
    await page.waitForTimeout(800);
    await expect(demo).toHaveAttribute('data-scene', '0');
  });

  test('the demonstration advances by itself when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const demo = page.getByTestId('product-demo');
    await expect(demo).toBeVisible();
    // Off-screen it does not play.
    await expect(demo).toHaveAttribute('data-playing', 'false');
    await page.waitForTimeout(5200);
    await expect(demo).toHaveAttribute('data-scene', '0');
    await demo.scrollIntoViewIfNeeded();
    await expect(demo).toHaveAttribute('data-scene', '1', { timeout: 9000 });
  });

  test('with reduced motion nothing plays and the scenes are stepped through', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const demo = page.getByTestId('product-demo');
    await expect(demo).toBeVisible();
    await expect(page.getByTestId('demo-play')).toHaveCount(0);
    await expect(demo).toHaveAttribute('data-playing', 'false');
    await page.waitForTimeout(5500);
    await expect(demo).toHaveAttribute('data-scene', '0');
    await page.getByTestId('demo-next').click();
    await expect(demo).toHaveAttribute('data-scene', '1');
    for (const selector of ['.demo__line > span', '.demo__panel', '.demo__roster']) {
      const durations = await demo
        .locator(selector)
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).transitionDuration));
      expect(new Set(durations), selector).toEqual(new Set(['0s']));
    }
    // Scroll reveals are off: nothing is waiting to fade in.
    await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
  });

  test('the navigation collapses into a disclosure menu on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('nav-menu')).toBeHidden();
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const menu = page.getByTestId('nav-menu');
    for (const name of ['Product', 'Sessions', 'History', 'API', 'Security', 'Download']) {
      await expect(menu.getByRole('link', { name })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-menu')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });
});

test.describe('OS-aware download button', () => {
  for (const [name, ua, label] of [
    ['Windows', UA.windows, 'Download for Windows'],
    ['macOS', UA.macos, 'Download for macOS'],
    ['Linux', UA.linux, 'Download for Linux'],
  ] as const) {
    test.describe(`on ${name}`, () => {
      test.use({ userAgent: ua });
      test(`the navigation and the hero offer "${label}" and the manual chooser works`, async ({
        page,
        api,
      }) => {
        api.desktopReleases = releaseOf([
          file('windows', 'x64', 'exe', 90_000_000, 'a', 'signed'),
          file('macos', 'universal', 'dmg', 70_000_000, 'b'),
          file('linux', 'x64', 'tar.gz', 91_234_567, 'c'),
        ]);
        await page.goto('/');
        await expect(page.getByTestId('nav-download')).toHaveText(label);
        await expect(page.getByTestId('nav-download')).toHaveAttribute('href', '/#download');
        await expect(page.getByTestId('hero-download-link')).toHaveText(label);
        await expect(page.getByTestId('hero-download-signature')).toBeVisible();
        // The hero's chooser lists every platform; choosing one changes the offer.
        await page.getByTestId('hero-download-choose-other').click();
        await page.getByTestId('hero-download-all').getByRole('button', { name: 'macOS' }).click();
        await expect(page.getByTestId('hero-download-link')).toHaveText('Download for macOS');
        await expect(page.getByTestId('hero-download-build')).toHaveCount(3);
      });
    });
  }

  test.describe('on Linux without a Linux build', () => {
    test.use({ userAgent: UA.linux });
    test('says so in the hero without a dead link and the navigation stays plain', async ({
      page,
      api,
    }) => {
      api.desktopReleases = releaseOf([file('windows', 'x64', 'exe', 1000, 'a')]);
      await page.goto('/');
      await expect(page.getByTestId('hero-download-unavailable')).toContainText(
        'No release published for Linux yet',
      );
      await expect(page.getByTestId('hero-download-link')).toHaveCount(0);
      await expect(page.getByTestId('nav-download')).toHaveText('Download');
      await expect(page.locator('main a[href^="/download/"]')).toHaveCount(0);
    });
  });

  test('required sentence is prominent and the platform table states what the team tested', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-caveat')).toBeInViewport();
    const rows = page.getByTestId('platform-table').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText('depends on the display server');
    await expect(rows.nth(2)).toContainText('may be unavailable');
    await expect(rows.nth(0)).toContainText('Tested by our team');
    await expect(rows.nth(1)).toContainText('Tested by our team');
    // Linux: the app was tested; the exclusion itself is not promised.
    await expect(rows.nth(2)).toContainText('App tested by our team');
    await expect(rows.nth(2)).toContainText('Capture exclusion depends on your desktop');
    // The request to check one's own setup stays next to the claim.
    await expect(page.getByTestId('compatibility-section')).toContainText(
      'check your own setup once before you rely on it',
    );
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
    test(`/guides/${slug} renders, also spelled ${spelling}`, async ({ page }) => {
      for (const name of [slug, spelling]) {
        await page.goto(`/guides/${name}`);
        const article = page.getByTestId('docs-article');
        await expect(article).toHaveAttribute('data-doc', slug);
        await expect(article.getByRole('heading', { level: 1 }).first()).toContainText(heading);
        expect(await article.locator('p, li').count()).toBeGreaterThan(5);
      }
    });
  }

  test('puts nothing but text and plain elements on the page', async ({ page }) => {
    for (const slug of ['readme', 'windows-client', 'macos-client', 'security']) {
      await page.goto(`/guides/${slug}`);
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
    await page.goto('/guides/readme');
    await page
      .getByTestId('docs-article')
      .locator('a[href="/guides/windows-client"]')
      .first()
      .click();
    await expect(page).toHaveURL('/guides/windows-client');
    await expect(page.getByTestId('docs-article')).toHaveAttribute('data-doc', 'windows-client');
  });

  test('an unknown name gets the not-found screen', async ({ page }) => {
    for (const name of ['nope', 'readme.txt', 'docs', 'security.md.md']) {
      await page.goto(`/guides/${name}`);
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

test.describe('keyboard and accessibility', () => {
  test('the keyboard reaches navigation, the download button, the demo controls and the FAQ', async ({
    page,
    api,
  }) => {
    api.desktopReleases = releaseOf([file('linux', 'x64', 'tar.gz', 91_234_567, 'c')]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(page.getByTestId('hero-download-link')).toBeVisible();
    const seen: string[] = [];
    let focusedDemoPlay = false;
    let focusedFaq = false;
    for (let step = 0; step < 90 && !focusedFaq; step += 1) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return {
          text: (element?.textContent ?? '').trim().slice(0, 40),
          testid: element?.dataset.testid ?? '',
          tag: element?.tagName ?? '',
          outline: element ? getComputedStyle(element).outlineStyle : 'none',
        };
      });
      seen.push(where.testid || where.text);
      if (where.testid === 'demo-play') focusedDemoPlay = true;
      if (where.tag === 'SUMMARY') {
        focusedFaq = true;
        expect(where.outline).not.toBe('none');
      }
    }
    expect(seen).toContain('nav-download');
    expect(seen).toContain('hero-download-link');
    expect(focusedDemoPlay).toBe(true);
    expect(focusedFaq).toBe(true);
    expect(seen.indexOf('nav-download')).toBeLessThan(seen.indexOf('hero-download-link'));
    expect(seen.indexOf('hero-download-link')).toBeLessThan(seen.indexOf('demo-play'));
    await page.keyboard.press('Enter');
    await expect(page.locator('.land-faq__item[open]')).toHaveCount(1);
  });

  for (const theme of THEMES) {
    test(`axe finds no serious or critical problems (${theme})`, async ({ page, api }) => {
      await setSavedTheme(page, theme);
      api.signupEnabled = true;
      api.desktopReleases = releaseOf([file('linux', 'x64', 'tar.gz', 91_234_567, 'c')]);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      await expect(page.getByTestId('hero-download-link')).toBeVisible();
      const demo = page.getByTestId('product-demo');
      await demo.scrollIntoViewIfNeeded();
      await page.getByTestId('demo-play').click();
      await demo.getByRole('button', { name: 'Presence' }).click();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(30);
      }
      for (const summary of await page.locator('.land-faq__item summary').all()) {
        await summary.click();
      }
      await page.waitForTimeout(1500);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(
        blocking.map((violation) => ({
          rule: violation.id,
          targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
        })),
      ).toEqual([]);
    });
  }
});
