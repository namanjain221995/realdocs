/**
 * Who sees what without an account, and where a person starts after signing in.
 *
 * - A visitor sees the sign-in page and nothing else: not the product page, the downloads, the
 *   guides or the developer portal.
 * - An administrator starts in the administration area; a member on the product page, whose
 *   header shows their account.
 * - A page asked for while signed out is where the person ends up after signing in.
 * - A share link still opens its document without an account, and unlocks nothing else.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  DOC_IDS,
  expect,
  PASSWORDS,
  SECRETS,
  seedShareLink,
  setSavedTheme,
  SHARE_IDS,
  signedInAs,
  test,
  USERS,
} from './support/test';

const HIDDEN = [
  '/product',
  '/download',
  '/docs',
  '/docs/api',
  '/guides/windows-client',
  '/releases/1.0.0',
];

async function signInWith(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORDS[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('without an account', () => {
  test('the start page is the sign-in page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('landing')).toHaveCount(0);
  });

  for (const path of HIDDEN) {
    test(`${path} asks for sign-in and shows nothing of the page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      for (const id of ['landing', 'download-section', 'docs-article', 'developers']) {
        await expect(page.getByTestId(id)).toHaveCount(0);
      }
    });
  }

  test('a share link opens its document and unlocks nothing else', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    await page.goto(`/s/${SHARE_IDS.press}#${SECRETS.share}`);
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
    await expect(page.getByTestId('rd-editor')).toBeVisible();
    // Still a guest: every account-only page sends them to sign in.
    for (const path of ['/', '/product', '/docs', '/download', '/guides/security']) {
      await page.goto(path);
      await expect(page).toHaveURL(/^[^?]*\/login(\?next=.*)?$/);
      await expect(page.getByTestId('landing')).toHaveCount(0);
    }
  });
});

test.describe('after signing in', () => {
  test('an administrator starts in the administration area', async ({ page }) => {
    await page.goto('/');
    await signInWith(page, USERS.asha.email);
    await expect(page).toHaveURL('/admin/users');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('a member starts on the product page, with their account in its header', async ({
    page,
  }) => {
    await page.goto('/');
    await signInWith(page, USERS.ben.email);
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('landing')).toBeVisible();
    // No "Sign in" anywhere on a page that only signed-in people see.
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('nav-open-documents')).toBeVisible();

    const account = page.getByRole('button', { name: `Account menu for ${USERS.ben.displayName}` });
    await account.click();
    await expect(page.getByRole('menuitem', { name: 'My documents' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    // Nothing for administrators in a member's menu.
    await expect(page.getByRole('menuitem', { name: 'Administration' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'My documents' }).click();
    await expect(page).toHaveURL('/documents');
    await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  });

  test('a page asked for while signed out wins over the role default', async ({ page }) => {
    await page.goto('/docs');
    await expect(page).toHaveURL('/login?next=%2Fdocs');
    await signInWith(page, USERS.asha.email);
    await expect(page).toHaveURL('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // And the return address cannot leave the site.
    await page.goto('/login?next=%2F%2Fevil.example%2Fx');
    await expect(page).toHaveURL('/admin/users');
  });

  test('an administrator can open the product page, and a member their documents', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/documents');
    await page.getByRole('button', { name: `Account menu for ${USERS.asha.displayName}` }).click();
    await page.getByRole('menuitem', { name: 'Product page' }).click();
    await expect(page).toHaveURL('/product');
    await expect(page.getByTestId('landing')).toBeVisible();
    await page.getByRole('button', { name: `Account menu for ${USERS.asha.displayName}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Administration' })).toBeVisible();
  });

  test('signing out from the product page ends on the sign-in page', async ({ page, api }) => {
    signedInAs(api, USERS.ben);
    await page.goto('/');
    await page.getByRole('button', { name: `Account menu for ${USERS.ben.displayName}` }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const confirm = page.getByRole('button', { name: 'Sign out' });
    if (await confirm.count()) await confirm.first().click();
    await expect(page).toHaveURL('/login');
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('the sign-in page', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`has no serious accessibility problem (${theme})`, async ({ page }) => {
      await setSavedTheme(page, theme);
      // Colours are measured in the settled state, not half-way through the opening sequence.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => ({
          rule: violation.id,
          targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
        }));
      expect(blocking).toEqual([]);
    });
  }

  test('the picture is decoration: hidden from assistive technology, never a tab stop', async ({
    page,
  }) => {
    await page.goto('/login');
    const scene = page.getByTestId('login-scene');
    await expect(scene).toHaveAttribute('aria-hidden', 'true');
    expect(await scene.locator('a, button, input, [tabindex]').count()).toBe(0);
    // Keyboard order: email (focused on arrival), password, show password, sign in.
    await expect(page.getByLabel('Email')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  });

  test('holds still under reduced motion, with the same content', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    const state = await page.evaluate(() => {
      const names = (selector: string) =>
        [...document.querySelectorAll(selector)].map((el) => getComputedStyle(el).animationName);
      const typed = [...document.querySelectorAll('.login-scene__typed')].map((el) => ({
        text: el.textContent,
        visible: el.getBoundingClientRect().width > 20,
      }));
      return {
        animations: [
          ...names('.login__form'),
          ...names('.login-scene__typed'),
          ...names('.login-scene__caret'),
          ...names('.login-scene__panel'),
        ],
        typed,
      };
    });
    expect(state.animations.every((name) => name === 'none')).toBe(true);
    expect(state.typed).toHaveLength(3);
    expect(state.typed.every((line) => line.visible)).toBe(true);
  });

  test('an error opens without moving the page sideways, and is announced', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.ben.email);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const error = page.getByTestId('login-error');
    await expect(error).toBeVisible();
    await expect(page.locator('.login__notice')).toHaveAttribute('aria-live', 'polite');
    // The form is still usable and nothing overflows.
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const width of [320, 768, 1440]) {
    test(`fits a ${width} px wide window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await page.getByRole('button', { name: 'Sign in' }).boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
      await page.screenshot({ path: `.stage/screenshots/login-${width}.png`, fullPage: true });
    });
  }
});
