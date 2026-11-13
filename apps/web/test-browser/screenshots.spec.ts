/**
 * Captures the main screens at desktop, tablet and phone widths in both
 * themes, for visual review, and checks on the way that none of them scrolls
 * sideways. Chromium only. Images go to `.stage/screenshots/` (not committed).
 *
 * The document screens here show the app around the editor: this suite has no
 * collaboration server, so the editor itself is waiting to connect. Pictures
 * of the editor with a document in it come from the real-stack suite
 * (`test-real/screenshots.spec.ts`, `.stage/screenshots-real/`).
 */
import type { Page } from '@playwright/test';
import {
  allowConsoleErrors,
  DOC_IDS,
  expect,
  hasHorizontalOverflow,
  INVITATION_IDS,
  type MockApi,
  SECRETS,
  seedShareLink,
  SHARE_IDS,
  signedInAs,
  test,
  type ThemeName,
  USERS,
  setSavedTheme,
} from './support/test';

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'phone', width: 360, height: 740 },
] as const;
const THEMES: readonly ThemeName[] = ['dark', 'light'];

interface Screen {
  name: string;
  /** Prepares the mock and opens the screen; resolves when it is ready to capture. */
  open: (page: Page, api: MockApi) => Promise<void>;
  /** Capture the whole scrollable page rather than the viewport. */
  fullPage?: boolean;
}

const SCREENS: Screen[] = [
  {
    name: 'login',
    open: async (page) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    },
  },
  {
    name: 'login-error',
    open: async (page) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill('asha.rao@northwind.example');
      await page.getByLabel('Password', { exact: true }).fill('not the password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByTestId('login-error')).toBeVisible();
    },
  },
  {
    name: 'invite',
    open: async (page) => {
      await page.goto(`/invite/${INVITATION_IDS.pending}#${SECRETS.invite}`);
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
      await page.getByLabel('Name').fill('Priya Nair');
      await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
    },
    fullPage: true,
  },
  {
    name: 'dashboard-admin',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/documents');
      await expect(page.getByTestId('document-row')).toHaveCount(5);
    },
  },
  {
    name: 'dashboard-trash',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/documents?view=trash');
      await expect(page.getByTestId('document-row')).toHaveCount(2);
    },
  },
  {
    name: 'dashboard-menu',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/documents');
      await page.getByTestId('row-actions').first().click();
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'dashboard-empty',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      api.documents = [];
      await page.goto('/documents');
      await expect(page.getByTestId('documents-empty')).toBeVisible();
    },
  },
  {
    name: 'dashboard-no-results',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/documents?q=budget');
      await expect(page.getByTestId('documents-no-results')).toBeVisible();
    },
  },
  {
    name: 'dashboard-member',
    open: async (page, api) => {
      signedInAs(api, USERS.ben);
      await page.goto('/documents?view=recent');
      await expect(page.getByTestId('document-row')).toHaveCount(2);
    },
  },
  {
    name: 'dashboard-error',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      api.failNext('GET', /^\/api\/documents$/, 'internal', {
        requestId: 'req_7f3a9c21',
        times: 3,
      });
      await page.goto('/documents');
      await expect(page.getByTestId('documents-error')).toBeVisible();
    },
  },
  {
    name: 'document-admin',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}`);
      await expect(page.getByTestId('editor-mount')).toBeVisible();
    },
  },
  {
    name: 'document-share-panel',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}?panel=share`);
      await expect(page.getByTestId('share-row').first()).toBeVisible();
    },
  },
  {
    name: 'document-share-new-link',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}?panel=share`);
      await page.getByTestId('new-link').click();
      await page.getByTestId('share-label').fill('Launch partners');
      await page.getByTestId('create-link-submit').click();
      await expect(page.getByTestId('new-share-link')).toBeVisible();
      await page.getByTestId('new-share-link').scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'document-revoke-confirm',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}?panel=share`);
      await page
        .locator(`[data-share-id="${SHARE_IDS.press}"]`)
        .getByTestId('share-actions')
        .click();
      await page.getByRole('menuitem', { name: 'Revoke link' }).click();
      await expect(page.getByTestId('revoke-confirm')).toBeVisible();
    },
  },
  {
    name: 'document-snapshots-panel',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}?panel=snapshots`);
      await expect(page.getByTestId('snapshot-row')).toHaveCount(3);
    },
  },
  {
    name: 'document-restore-confirm',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}?panel=snapshots`);
      await page.getByTestId('snapshot-restore').first().click();
      await expect(page.getByTestId('restore-confirm')).toBeVisible();
    },
  },
  {
    name: 'document-capture-guidance',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}`);
      await expect(page.getByTestId('editor-mount')).toBeVisible();
      await page.getByTestId('capture-guidance-link').click();
      await expect(page.getByTestId('capture-guidance')).toBeVisible();
    },
  },
  {
    name: 'document-desktop-dialog',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      // No app handles realtimedocs:// in the test browser, which it reports on the console.
      allowConsoleErrors(page, /realtimedocs|scheme|protocol/i);
      await page.goto(`/d/${DOC_IDS.launch}`);
      await expect(page.getByTestId('editor-mount')).toBeVisible();
      if ((page.viewportSize()?.width ?? 0) < 640) {
        await page.getByTestId('document-more').click();
      }
      await page.getByTestId('open-in-desktop').click();
      await expect(page.getByTestId('desktop-launched')).toBeVisible();
    },
  },
  {
    name: 'document-display-preferences',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}`);
      await expect(page.getByTestId('editor-mount')).toBeVisible();
      if ((page.viewportSize()?.width ?? 0) < 640) {
        await page.getByTestId('document-more').click();
      }
      await page.getByTestId('open-display-preferences').click();
      await page.getByTestId('display-preferences').getByRole('radio', { name: 'Wide' }).click();
      await page.getByTestId('display-preferences').getByRole('radio', { name: 'Light' }).click();
    },
  },
  {
    name: 'account-menu',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/documents');
      await expect(page.getByTestId('document-row')).toHaveCount(5);
      await page.getByRole('button', { name: 'Account menu for Asha Rao' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'document-guest',
    open: async (page, api) => {
      api.guestAccess.set(DOC_IDS.launch, {
        role: 'viewer',
        expiresAt: '2026-11-13T12:00:00.000Z',
      });
      await page.goto(`/d/${DOC_IDS.launch}`);
      await expect(page.getByTestId('editor-mount')).toBeVisible();
    },
  },
  {
    name: 'document-archived',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.retro}`);
      await expect(page.getByTestId('archived-banner')).toBeVisible();
    },
  },
  {
    name: 'document-trashed',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.oldPlan}`);
      await expect(page.getByTestId('document-error')).toBeVisible();
    },
  },
  {
    name: 'document-not-found-guest',
    open: async (page) => {
      await page.goto(`/d/${DOC_IDS.missing}`);
      await expect(page.getByTestId('document-error')).toBeVisible();
    },
  },
  {
    name: 'share-expired',
    open: async (page, api) => {
      seedShareLink(api, SHARE_IDS.expired, DOC_IDS.launch);
      await page.goto(`/s/${SHARE_IDS.expired}#${SECRETS.share}`);
      await expect(page.getByTestId('share-exchange-error')).toBeVisible();
    },
  },
  {
    name: 'print',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto(`/d/${DOC_IDS.launch}/print`);
      await expect(page.getByTestId('print-button')).toBeEnabled();
    },
    fullPage: true,
  },
  {
    name: 'settings',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/settings');
      await expect(page.getByTestId('drafts-empty')).toBeVisible();
    },
    fullPage: true,
  },
  {
    name: 'admin-accounts',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/admin/users');
      await expect(page.getByTestId('account-row')).toHaveCount(4);
    },
    fullPage: true,
  },
  {
    name: 'admin-invitations',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/admin/users?tab=invitations');
      await expect(page.getByTestId('invitation-row')).toHaveCount(4);
      await page.getByTestId('invitation-email').fill('lena.fischer@northwind.example');
      await page.getByRole('button', { name: 'Create invitation' }).click();
      await expect(page.getByTestId('new-invitation')).toBeVisible();
    },
    fullPage: true,
  },
  {
    name: 'admin-audit',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/admin/users?tab=audit');
      await expect(page.getByTestId('audit-table')).toBeVisible();
    },
    fullPage: true,
  },
  {
    name: 'not-found',
    open: async (page, api) => {
      signedInAs(api, USERS.asha);
      await page.goto('/nowhere/at/all');
      await expect(page.getByTestId('not-found')).toBeVisible();
    },
  },
];

for (const screen of SCREENS) {
  for (const viewport of WIDTHS) {
    for (const theme of THEMES) {
      test(`${screen.name} at ${viewport.width}px, ${theme}`, async ({ page, api }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setSavedTheme(page, theme);
        await screen.open(page, api);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // Let fonts settle and one-off entrance motion finish.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        expect(await hasHorizontalOverflow(page), 'page scrolls sideways').toBe(false);
        await page.screenshot({
          path: `.stage/screenshots/${screen.name}-${viewport.width}-${theme}.png`,
          fullPage: screen.fullPage ?? false,
          animations: 'disabled',
        });
      });
    }
  }
}
