// Screenshots and browser checks for the UI kit demo page.
//
// Run it in the Playwright image while `pnpm --filter @realtimedocs/ui run demo`
// is serving on 127.0.0.1:5391 (from the repository root):
//
//   docker run --rm --network host --user 1000:1000 -e HOME=/tmp \
//     -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
//     node packages/ui/demo/screenshot.mjs
//
// It writes PNGs to packages/ui/demo/screenshots/ and prints what it measured.
// It exits non-zero when the page logs an error, overflows sideways, loses
// focus where it should not, or fails a clipboard, theme or accessibility check.
//
// Passes: pages, overlays, focus, measure, a11y, behaviour, additions. Run a
// subset with `-e ONLY=pages,a11y`. Point it at another address with
// `-e DEMO_URL=...`.

// Browser globals appear only inside callbacks that Playwright runs in the page.
/* global document, window, getComputedStyle, matchMedia */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.DEMO_URL ?? 'http://127.0.0.1:5391/';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const SECTION_DIR = path.join(OUT_DIR, 'sections');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

mkdirSync(SECTION_DIR, { recursive: true });

const problems = [];
const note = (message) => console.log(message);
const fail = (message) => {
  problems.push(message);
  console.log(`PROBLEM: ${message}`);
};
const wants = (name) => !ONLY || ONLY.has(name);

async function openPage(
  browser,
  { theme, width, height = 900, touch = false, scale = 1, reducedMotion },
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    hasTouch: touch,
    isMobile: touch,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem('rd.theme', value);
    } catch {
      // Storage is optional for the demo.
    }
  }, theme);
  const page = await context.newPage();
  const label = `${theme}-${width}${touch ? '-touch' : ''}`;
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      fail(`[${label}] console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => fail(`[${label}] page error: ${error.message}`));
  page.on('requestfailed', (request) => fail(`[${label}] request failed: ${request.url()}`));
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelectorAll('[data-section]').length >= 9);
  return { context, page, label };
}

/**
 * The page overflows sideways when the document is wider than the viewport.
 * For diagnosis, lists the elements that reach past the right edge and are not
 * held back by a scroll container (an absolutely positioned element is only
 * held back by scroll containers that enclose its containing block).
 */
async function findOverflow(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const culprits = [];
    const heldBack = (element) => {
      let boundary = element.parentElement;
      if (getComputedStyle(element).position === 'absolute') {
        boundary = element.offsetParent;
      }
      for (
        let node = boundary;
        node && node !== document.documentElement;
        node = node.parentElement
      ) {
        if (getComputedStyle(node).overflowX !== 'visible') return true;
      }
      return false;
    };
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      if (style.position === 'fixed') continue;
      const rect = element.getBoundingClientRect();
      if (rect.right <= viewport + 0.5 || heldBack(element)) continue;
      culprits.push(
        `${element.tagName.toLowerCase()}.${String(element.className).split(' ').join('.')} ` +
          `[${Math.round(rect.left)}..${Math.round(rect.right)}] ${style.position}`,
      );
    }
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      culprits: culprits.slice(0, 12),
    };
  });
}

async function checkOverflow(page, label) {
  const result = await findOverflow(page);
  if (result.scrollWidth > result.viewport) {
    fail(
      `[${label}] horizontal overflow: scrollWidth ${result.scrollWidth} > ${result.viewport}; ` +
        result.culprits.join(' | '),
    );
  } else {
    note(
      `[${label}] no horizontal overflow (scrollWidth ${result.scrollWidth}, viewport ${result.viewport})`,
    );
  }
}

async function shootSections(page, label) {
  // The sticky header would otherwise cover the top of each crop.
  await page.addStyleTag({ content: '.demo-header { position: static !important; }' });
  const sections = await page.locator('[data-section]').all();
  for (const section of sections) {
    const id = await section.getAttribute('data-section');
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: path.join(SECTION_DIR, `${label}-${id}.png`) });
  }
}

async function fullPage(browser, theme, width) {
  const { context, page, label } = await openPage(browser, { theme, width });
  await checkOverflow(page, label);
  await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), fullPage: true });
  if (width > 400) await shootSections(page, label);
  await context.close();
  if (width <= 400) {
    // Narrow crops at 2x, so small text can be inspected.
    const zoomed = await openPage(browser, { theme, width, scale: 2 });
    await shootSections(zoomed.page, label);
    await zoomed.context.close();
  }
}

async function overlays(browser, theme, width) {
  const { context, page, label } = await openPage(browser, { theme, width, height: 760 });
  const shot = async (name) => {
    // Let the 120-180ms enter animations finish first.
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT_DIR, `${label}-${name}.png`) });
  };
  const section = page.locator('[data-section="overlays"]');
  await section.scrollIntoViewIfNeeded();

  // Dropdown menu, opened from the keyboard so the first item shows its focus ring.
  await page.getByTestId('open-menu').focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Document', exact: true });
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  await shot('menu');
  const menuBox = await menu.boundingBox();
  note(`[${label}] menu box ${JSON.stringify(menuBox)}`);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  if (!(await page.getByTestId('open-menu').evaluate((el) => el === document.activeElement))) {
    fail(`[${label}] focus did not return to the menu trigger`);
  }

  // Popover.
  await page.getByTestId('open-popover').click();
  await page.getByRole('dialog', { name: 'Highlight colour' }).waitFor();
  await shot('popover');
  await page.mouse.click(8, 400);
  await page.getByRole('dialog', { name: 'Highlight colour' }).waitFor({ state: 'detached' });

  // Tooltip on keyboard focus.
  await page.getByTestId('open-popover').focus();
  await page.keyboard.press('Tab');
  await page.getByRole('tooltip').waitFor();
  await shot('tooltip');
  await page.keyboard.press('Escape');

  // Toasts: they must not take focus from the button.
  await page.getByTestId('toast-success').click();
  await page.getByTestId('toast-action').click();
  await page.getByTestId('toast-danger').click();
  await page.locator('.rd-toast').nth(2).waitFor();
  const focusKept = await page
    .getByTestId('toast-danger')
    .evaluate((el) => el === document.activeElement);
  if (!focusKept) fail(`[${label}] a toast moved focus away from its trigger`);
  await shot('toasts');
  while ((await page.locator('.rd-toast__close').count()) > 0) {
    await page.locator('.rd-toast__close').first().click();
  }

  // Dialog.
  await page.getByTestId('open-dialog').click();
  const dialog = page.getByTestId('share-dialog');
  await dialog.waitFor();
  await shot('dialog');
  const dialogBox = await dialog.boundingBox();
  note(`[${label}] dialog box ${JSON.stringify(dialogBox)}`);
  if (dialogBox && (dialogBox.x < 0 || dialogBox.x + dialogBox.width > width)) {
    fail(`[${label}] the dialog is wider than the viewport`);
  }
  // Tab must stay inside the dialog.
  for (let step = 0; step < 14; step += 1) await page.keyboard.press('Tab');
  const trapped = await page.evaluate(
    () =>
      document.querySelector('[data-testid="share-dialog"]')?.contains(document.activeElement) ??
      false,
  );
  if (!trapped) fail(`[${label}] Tab left the open dialog`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  if (!(await page.getByTestId('open-dialog').evaluate((el) => el === document.activeElement))) {
    fail(`[${label}] focus did not return to the dialog trigger`);
  }

  // Confirmation, including its loading state.
  await page.getByTestId('open-confirm').click();
  await page.getByTestId('confirm-dialog').waitFor();
  await shot('confirm');
  await page.getByRole('button', { name: 'Revoke link' }).last().click();
  await shot('confirm-loading');
  await page.getByTestId('confirm-dialog').waitFor({ state: 'detached' });

  await context.close();
}

async function focusRings(browser, theme) {
  const { context, page, label } = await openPage(browser, { theme, width: 1280, height: 760 });
  // Toolbar: keyboard focus, then arrow along it.
  await page.locator('[data-section="toolbar"]').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Undo' }).first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  await page
    .locator('[data-section="toolbar"]')
    .screenshot({ path: path.join(OUT_DIR, `${label}-focus-toolbar.png`) });
  await page.keyboard.press('Escape');

  // Fields: a focused input, then a focused switch.
  await page.locator('[data-section="fields"]').scrollIntoViewIfNeeded();
  await page.getByTestId('title-field').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page
    .locator('[data-section="fields"]')
    .screenshot({ path: path.join(OUT_DIR, `${label}-focus-input.png`) });
  await page.getByTestId('follow-switch').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page
    .locator('[data-section="fields"]')
    .screenshot({ path: path.join(OUT_DIR, `${label}-focus-switch.png`) });

  // Buttons: focus ring on a primary button.
  await page.locator('[data-section="actions"]').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'New document' }).first().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page
    .locator('[data-section="actions"]')
    .screenshot({ path: path.join(OUT_DIR, `${label}-focus-button.png`) });
  await context.close();
}

async function measurements(browser) {
  // Control sizes with a mouse and with touch.
  for (const touch of [false, true]) {
    const { context, page, label } = await openPage(browser, { theme: 'dark', width: 360, touch });
    const sizes = await page.evaluate(() => {
      const height = (selector) => {
        const element = document.querySelector(selector);
        return element ? Math.round(element.getBoundingClientRect().height * 10) / 10 : null;
      };
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        button: height('.rd-btn--md'),
        buttonSmall: height('.rd-btn--sm'),
        iconButton: height('.rd-icon-btn--md'),
        input: height('.rd-input--md'),
        checkbox: height('.rd-check__box'),
        switchTrack: height('.rd-switch__track'),
        tab: height('.rd-tabs__tab'),
        inputFontSize: getComputedStyle(document.querySelector('.rd-input__control')).fontSize,
        bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
        fontsLoaded: [...document.fonts]
          .filter((font) => font.status === 'loaded')
          .map((font) => `${font.family} ${font.style}`),
      };
    });
    note(`[${label}] sizes ${JSON.stringify(sizes)}`);
    if (touch) {
      await checkOverflow(page, label);
      await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), fullPage: true });
      await shootSections(page, label);
    }
    await context.close();
  }

  // The narrowest supported width.
  for (const theme of ['dark', 'light']) {
    const { context, page, label } = await openPage(browser, { theme, width: 320 });
    await checkOverflow(page, label);
    await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), fullPage: true });
    await context.close();
  }

  // A window the size of a small floating panel: overlays must fit and scroll inside.
  {
    const { context, page, label } = await openPage(browser, {
      theme: 'dark',
      width: 320,
      height: 420,
    });
    await page.getByTestId('open-dialog').click();
    const dialog = page.getByTestId('share-dialog');
    await dialog.waitFor();
    await page.waitForTimeout(260);
    const box = await dialog.boundingBox();
    const body = await page
      .locator('.rd-dialog__body')
      .evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    note(`[${label}x420] dialog ${JSON.stringify(box)} body ${JSON.stringify(body)}`);
    if (!box || box.y < 0 || box.y + box.height > 420 || box.x < 0 || box.x + box.width > 320) {
      fail(`[${label}x420] the dialog does not fit the viewport`);
    }
    if (body.scroll <= body.client) fail(`[${label}x420] the dialog body should scroll here`);
    await page.screenshot({ path: path.join(OUT_DIR, `${label}x420-dialog.png`) });
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 320, height: 240 });
    await page.getByTestId('open-menu').scrollIntoViewIfNeeded();
    await page.getByTestId('open-menu').click();
    await page.getByRole('menu', { name: 'Document', exact: true }).waitFor();
    await page.waitForTimeout(260);
    const menu = await page.locator('.rd-popover--menu').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        scroll: element.scrollHeight,
        client: element.clientHeight,
        placement: element.dataset.placement,
      };
    });
    note(`[${label}x240] menu ${JSON.stringify(menu)}`);
    if (menu.top < 0 || menu.bottom > 240 || menu.left < 0 || menu.right > 320) {
      fail(`[${label}x240] the menu does not fit the viewport`);
    }
    await page.screenshot({ path: path.join(OUT_DIR, `${label}x240-menu.png`) });
    await context.close();
  }

  // Reduced motion: animations and transitions collapse to (almost) nothing.
  const { context, page, label } = await openPage(browser, {
    theme: 'dark',
    width: 1280,
    reducedMotion: true,
  });
  const motion = await page.evaluate(() => {
    const read = (selector, pseudo) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element, pseudo);
      return {
        animation: style.animationDuration,
        transition: style.transitionDuration,
        iterations: style.animationIterationCount,
      };
    };
    return {
      spinner: read('.rd-spinner > svg'),
      skeleton: read('.rd-skeleton'),
      pulse: read('.rd-status__dot[data-pulse]', '::after'),
      button: read('.rd-btn'),
      fast: getComputedStyle(document.documentElement).getPropertyValue('--rd-duration-fast'),
    };
  });
  note(`[${label}] reduced motion ${JSON.stringify(motion)}`);
  const seconds = (value) =>
    value?.endsWith('ms') ? Number.parseFloat(value) / 1000 : Number.parseFloat(value ?? '0');
  for (const [name, style] of Object.entries(motion)) {
    if (!style || typeof style === 'string') continue;
    if (seconds(style.animation) > 0.001 || seconds(style.transition) > 0.001) {
      fail(`[${label}] ${name} still animates under prefers-reduced-motion`);
    }
  }
  await context.close();
}

/**
 * Checks, in Chromium's own accessibility tree, that controls expose the role,
 * name and state a screen reader user needs.
 */
async function accessibilityTree(browser) {
  const { context, page, label } = await openPage(browser, { theme: 'dark', width: 1280 });
  const expectations = [
    ['button', { name: 'New document' }],
    ['button', { name: 'Keep on top', pressed: true }],
    ['button', { name: 'Search documents', disabled: true }],
    ['link', { name: 'Print view' }],
    ['button', { name: 'Snapshots', pressed: false }],
    ['button', { name: 'Follow latest', pressed: true }],
    ['button', { name: 'Pause sharing', pressed: true }],
    ['link', { name: 'Check what others see' }],
    ['link', { name: 'All documents' }],
    ['button', { name: 'Show details', expanded: false }],
    ['toolbar', { name: 'Formatting' }],
    ['group', { name: 'Text formatting' }],
    ['button', { name: 'Bold', pressed: true }],
    ['button', { name: 'Italic', pressed: false }],
    ['radiogroup', { name: 'Alignment' }],
    ['radio', { name: 'Align left', checked: true }],
    ['combobox', { name: 'Text style' }],
    ['textbox', { name: 'Document title' }],
    ['textbox', { name: 'Search' }],
    [
      'textbox',
      { name: 'Invite by email', description: 'Enter a full address, like marcus@example.com.' },
    ],
    [
      'textbox',
      {
        name: 'Server address',
        description: 'The address of your RealtimeDocs server, not localhost.',
      },
    ],
    ['combobox', { name: 'Link expires' }],
    ['radiogroup', { name: 'Access' }],
    ['radio', { name: 'Can view', checked: true }],
    ['textbox', { name: 'Snapshot note' }],
    ['textbox', { name: 'Workspace', disabled: true }],
    ['checkbox', { name: 'Notify me when someone opens the link', checked: true }],
    ['checkbox', { name: 'Select all documents', checked: 'mixed' }],
    ['checkbox', { name: 'Allow downloads', disabled: true }],
    ['switch', { name: 'Follow latest edits', checked: true }],
    ['switch', { name: 'Click-through reading mode', checked: false }],
    ['slider', { name: 'Panel background' }],
    ['textbox', { name: 'Share link' }],
    ['button', { name: 'Show' }],
    ['tablist', { name: 'Sharing' }],
    ['tab', { name: 'People 4', selected: true }],
    ['tab', { name: 'Snapshots', selected: false }],
    ['tabpanel', { name: 'People 4' }],
    ['img', { name: 'Asha Rao is editing' }],
    ['img', { name: '3 more: Tomás Oliveira, Wen Li, Noor Haddad' }],
    ['alert', { name: '' }],
    ['button', { name: 'Dismiss' }],
    ['heading', { name: 'No documents yet', level: 2 }],
    ['heading', { name: 'This link was revoked', level: 2 }],
    ['menu', { name: 'Document actions' }],
    ['menuitem', { name: 'Rename F2' }],
    ['menuitemcheckbox', { name: 'Wrap long lines', checked: true }],
    ['region', { name: 'Notifications' }],
    ['slider', { name: 'Panel background' }],
  ];
  let found = 0;
  for (const [role, options] of expectations) {
    const count = await page.getByRole(role, options).count();
    if (count === 0)
      fail(`[${label}] accessibility tree has no ${role} ${JSON.stringify(options)}`);
    else found += 1;
  }
  // The invalid field is flagged, and the slider speaks its formatted value.
  const invalid = await page
    .getByRole('textbox', { name: 'Invite by email' })
    .getAttribute('aria-invalid');
  if (invalid !== 'true') fail(`[${label}] the field with an error is not marked invalid`);
  const valueText = await page.getByTestId('opacity-slider').getAttribute('aria-valuetext');
  if (valueText !== '72%') fail(`[${label}] slider value text is ${valueText}`);

  // A dialog and a confirmation, as assistive technology sees them.
  await page.getByTestId('open-dialog').click();
  if (
    (await page.getByRole('dialog', { name: 'Share “Quarterly planning notes”' }).count()) === 0
  ) {
    fail(`[${label}] the dialog is not exposed with its title as name`);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('open-confirm').click();
  const confirm = page.getByRole('alertdialog', { name: 'Revoke this link?' });
  if ((await confirm.count()) === 0) fail(`[${label}] the confirmation is not an alertdialog`);
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  if (focused !== 'Cancel')
    fail(`[${label}] a destructive confirmation should start on Cancel, not ${focused}`);
  await page.keyboard.press('Escape');

  // The whole toolbar is one stop in the Tab order.
  await page.getByTestId('save-button').focus();
  const stops = [];
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      const toolbar = active?.closest('[data-testid="editor-toolbar"]');
      return {
        inToolbar: Boolean(toolbar),
        first: toolbar === document.querySelector('[data-testid="editor-toolbar"]'),
        name: active?.getAttribute('aria-label') ?? active?.textContent ?? '',
      };
    });
    if (where.inToolbar && where.first) stops.push(where.name);
    if (stops.length > 0 && !where.inToolbar) break;
  }
  if (stops.length !== 1)
    fail(`[${label}] expected one tab stop in the toolbar, got ${JSON.stringify(stops)}`);
  note(
    `[${label}] accessibility tree: ${found}/${expectations.length} role and name checks passed; toolbar tab stops: ${JSON.stringify(stops)}`,
  );
  await context.close();
}

/** Behaviour that only a real browser can confirm: the clipboard and storage. */
async function behaviour(browser) {
  const link = 'https://docs.example.test/s/8Kq2vL0OIl1x#Zt4mB9wQ7nR3';

  // Copy through the async Clipboard API.
  {
    const { context, page, label } = await openPage(browser, { theme: 'dark', width: 1280 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const field = page.getByTestId('share-link');
    await field.scrollIntoViewIfNeeded();
    const copy = page
      .locator('.rd-copy')
      .filter({ has: field })
      .getByRole('button', { name: 'Copy' });
    await copy.click();
    await page.locator('.rd-copy[data-status="copied"]').first().waitFor();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    if (clipboard !== link)
      fail(`[${label}] Clipboard API path copied ${JSON.stringify(clipboard)}`);
    else note(`[${label}] copied through navigator.clipboard`);
    await page
      .locator('.rd-copy[data-status="copied"]')
      .first()
      .screenshot({
        path: path.join(OUT_DIR, `${label}-copied.png`),
      });
    await context.close();
  }

  // Copy through the legacy fallback, as in Safari or on a plain-http origin.
  {
    const { context, page, label } = await openPage(browser, { theme: 'dark', width: 1280 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('stale'));
    const used = await page.evaluate(() => {
      const state = { execCommand: 0 };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      const original = document.execCommand.bind(document);
      document.execCommand = (...args) => {
        state.execCommand += 1;
        return original(...args);
      };
      window.__copyState = state;
      return typeof navigator.clipboard;
    });
    const field = page.getByTestId('share-link');
    await field.scrollIntoViewIfNeeded();
    const copy = page
      .locator('.rd-copy')
      .filter({ has: field })
      .getByRole('button', { name: 'Copy' });
    await copy.click();
    await page.locator('.rd-copy[data-status="copied"]').first().waitFor();
    const calls = await page.evaluate(() => window.__copyState.execCommand);
    const leftover = await page.locator('body > textarea').count();
    const focusKept = await copy.evaluate((element) => element === document.activeElement);
    // Read the result in a second page of the same context, where the API is intact.
    const reader = await context.newPage();
    await reader.goto(BASE_URL);
    await reader.bringToFront();
    const clipboard = await reader.evaluate(() => navigator.clipboard.readText());
    if (used !== 'undefined') fail(`[${label}] could not remove navigator.clipboard for the test`);
    if (calls !== 1) fail(`[${label}] fallback called execCommand ${calls} times`);
    if (clipboard !== link) fail(`[${label}] fallback path copied ${JSON.stringify(clipboard)}`);
    if (leftover !== 0) fail(`[${label}] the fallback left its textarea in the page`);
    if (!focusKept) fail(`[${label}] the fallback did not put focus back on the Copy button`);
    if (calls === 1 && clipboard === link) note(`[${label}] copied through document.execCommand`);
    await context.close();
  }

  // Switching the theme applies it to the document and saves the choice.
  {
    const { context, page, label } = await openPage(browser, { theme: 'dark', width: 1280 });
    await page.getByRole('radio', { name: 'Light' }).click();
    const applied = await page.evaluate(() => document.documentElement.dataset.theme);
    const state = await context.storageState();
    const saved = state.origins
      .flatMap((origin) => origin.localStorage)
      .find((item) => item.name === 'rd.theme');
    if (applied !== 'light' || saved?.value !== 'light') {
      fail(`[${label}] theme not applied or saved: ${applied} / ${saved?.value}`);
    } else {
      note(`[${label}] theme switch applied data-theme=light and saved rd.theme=light`);
    }
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (background !== 'rgb(243, 246, 248)') fail(`[${label}] light background is ${background}`);
    await context.close();
  }

  // A saved choice is picked up when the app starts.
  {
    const { context, page, label } = await openPage(browser, { theme: 'light', width: 1280 });
    const applied = await page.evaluate(() => document.documentElement.dataset.theme);
    const checked = await page.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked');
    if (applied !== 'light' || checked !== 'true') {
      fail(`[${label}] saved theme was not restored: ${applied} / ${checked}`);
    } else {
      note(`[${label}] saved theme restored on load`);
    }
    await context.close();
  }

  // With storage blocked the page still renders and the theme still switches.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: 'Light' }).click();
    const applied = await page.evaluate(() => document.documentElement.dataset.theme);
    if (errors.length > 0) fail(`[no-storage] page errors: ${errors.join(' | ')}`);
    if (applied !== 'light') fail(`[no-storage] theme did not switch without storage: ${applied}`);
    if (errors.length === 0 && applied === 'light')
      note('[no-storage] theme switches with localStorage blocked');
    await context.close();
  }
}

/**
 * Toggles and switches under scripted clicks, pressed buttons, links, the
 * sheet, and what a dialog does to a copy field it focuses.
 */
async function additions(browser, theme, width) {
  const { context, page, label } = await openPage(browser, { theme, width, height: 760 });
  const shot = async (name, target = page) => {
    await page.waitForTimeout(260);
    await target.screenshot({ path: path.join(OUT_DIR, `${label}-${name}.png`) });
  };
  const checked = (testId) => page.getByTestId(testId).isChecked();

  // A scripted click on the real input, exactly as an end-to-end test makes it:
  // no `force`, so Playwright insists that the input itself receives the click.
  const toggles = [
    ['follow-switch', 'a switch that is on'],
    ['click-through-switch', 'a switch that is off'],
    ['notify-checkbox', 'a checkbox'],
  ];
  for (const [testId, what] of toggles) {
    const selector = `[data-testid="${testId}"]`;
    await page.locator(selector).scrollIntoViewIfNeeded();
    const start = await checked(testId);
    try {
      await page.click(selector, { timeout: 5000 });
      const once = await checked(testId);
      await page.click(selector, { timeout: 5000 });
      const twice = await checked(testId);
      if (once === start || twice !== start) {
        fail(
          `[${label}] ${what}: clicks gave ${start} -> ${once} -> ${twice}, expected one toggle each`,
        );
      }
      // The corners of the input's own box toggle too.
      const box = await page.locator(selector).boundingBox();
      await page.locator(selector).click({ position: { x: 2, y: 2 }, timeout: 5000 });
      const corner = await checked(testId);
      await page
        .locator(selector)
        .click({ position: { x: box.width - 2, y: box.height - 2 }, timeout: 5000 });
      const back = await checked(testId);
      if (corner === start || back !== start) {
        fail(`[${label}] ${what}: corner clicks gave ${start} -> ${corner} -> ${back}`);
      }
    } catch (error) {
      fail(`[${label}] ${what}: page.click was refused: ${String(error.message).split('\n')[0]}`);
    }
  }
  // A click on the label text toggles once as well.
  {
    const start = await checked('follow-switch');
    await page.getByText('Follow latest edits', { exact: true }).click();
    if ((await checked('follow-switch')) === start)
      fail(`[${label}] the switch label did not toggle it`);
    await page.getByText('Follow latest edits', { exact: true }).click();
  }
  // Nothing but the input may be the hit target anywhere inside its box, in either state.
  const stolen = await page.evaluate(() => {
    const problems = [];
    for (const input of document.querySelectorAll('.rd-switch__input, .rd-check__input')) {
      input.scrollIntoView({ block: 'center' });
      const rect = input.getBoundingClientRect();
      for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        for (const fy of [0.2, 0.5, 0.8]) {
          const hit = document.elementFromPoint(
            rect.left + rect.width * fx,
            rect.top + rect.height * fy,
          );
          if (hit !== input) {
            problems.push(
              `${input.className} (${input.checked ? 'on' : 'off'}) at ${fx},${fy}: ${hit?.className}`,
            );
          }
        }
      }
    }
    return problems;
  });
  if (stolen.length > 0)
    fail(
      `[${label}] something covers a checkbox or switch input: ${stolen.slice(0, 4).join(' | ')}`,
    );
  else
    note(
      `[${label}] switches and checkboxes toggle once per scripted click; the input is the hit target across its box`,
    );

  // Pressed buttons: every variant looks different from its resting state.
  const styleOf = (testId) =>
    page.getByTestId(testId).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        pressed: element.getAttribute('aria-pressed'),
      };
    });
  await page.getByTestId('toggle-share').scrollIntoViewIfNeeded();
  await page.mouse.move(4, 4);
  const token = (name) =>
    page.evaluate((property) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${property})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, name);
  const accent = await token('--rd-accent');
  const pressedShare = await styleOf('toggle-share');
  const restingSnapshots = await styleOf('toggle-snapshots');
  if (pressedShare.pressed !== 'true' || restingSnapshots.pressed !== 'false') {
    fail(
      `[${label}] toggle buttons do not carry aria-pressed: ${JSON.stringify([pressedShare, restingSnapshots])}`,
    );
  }
  if (pressedShare.color !== accent || pressedShare.background === restingSnapshots.background) {
    fail(
      `[${label}] a pressed secondary button looks like a resting one: ${JSON.stringify(pressedShare)}`,
    );
  }
  for (const [testId, property] of [
    ['toggle-follow', '--rd-accent-pressed'],
    ['toggle-pause', '--rd-danger-solid-pressed'],
  ]) {
    const style = await styleOf(testId);
    if (style.background !== (await token(property))) {
      fail(`[${label}] ${testId} pressed background is ${style.background}, expected ${property}`);
    }
  }
  if ((await styleOf('toggle-source')).color !== accent)
    fail(`[${label}] a pressed ghost button is not accent coloured`);
  // Hovering must not make a pressed button look unpressed.
  await page.getByTestId('toggle-follow').hover();
  await page.waitForTimeout(200);
  if ((await styleOf('toggle-follow')).background !== (await token('--rd-accent-pressed'))) {
    fail(`[${label}] a pressed primary button loses its look on hover`);
  }
  await page.mouse.move(4, 4);
  await page.getByTestId('toggle-share').click();
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);
  const released = await styleOf('toggle-share');
  if (released.pressed !== 'false' || released.background !== restingSnapshots.background) {
    fail(
      `[${label}] releasing a toggle did not restore its resting look: ${JSON.stringify(released)}`,
    );
  }
  await page.getByTestId('toggle-share').click();
  await page.mouse.move(4, 4);
  note(
    `[${label}] pressed buttons: ${JSON.stringify(pressedShare)} vs resting ${JSON.stringify(restingSnapshots)}`,
  );

  // Links: underlined, accent coloured, with a focus ring from the keyboard.
  const linkStyle = (testId) =>
    page.getByTestId(testId).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        line: style.textDecorationLine,
        decoration: style.textDecorationColor,
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });
  const inline = await linkStyle('link-inline');
  if (inline.color !== accent || inline.line !== 'underline')
    fail(`[${label}] inline link style: ${JSON.stringify(inline)}`);
  const quietRest = await linkStyle('link-quiet');
  await page.getByTestId('link-quiet').hover();
  await page.waitForTimeout(200);
  const quietHover = await linkStyle('link-quiet');
  if (!/, 0\)$/.test(quietRest.decoration) || /, 0\)$/.test(quietHover.decoration)) {
    fail(
      `[${label}] a quiet link should gain its underline on hover: ${JSON.stringify([quietRest, quietHover])}`,
    );
  }
  await page.mouse.move(4, 4);
  await page.getByTestId('toggle-pause').focus();
  await page.keyboard.press('Tab');
  const focused = await linkStyle('link-inline');
  const onLink = await page
    .getByTestId('link-inline')
    .evaluate((element) => element === document.activeElement);
  if (!onLink || focused.outline !== 'solid 2px')
    fail(`[${label}] a link focused from the keyboard has no ring: ${JSON.stringify(focused)}`);
  await shot('toggles-and-links', page.locator('[data-section="actions"]'));
  note(`[${label}] links: ${JSON.stringify(inline)}; focus ring ${focused.outline}`);

  // A dialog whose first control is a copy field: focused, with nothing selected.
  await page.getByTestId('open-link-ready').scrollIntoViewIfNeeded();
  await page.getByTestId('open-link-ready').click();
  await page.getByTestId('link-ready').waitFor();
  const selection = () =>
    page.evaluate(() => {
      const input = document.querySelector('[data-testid="link-ready-field"]');
      return {
        focused: document.activeElement === input,
        start: input.selectionStart,
        end: input.selectionEnd,
        length: input.value.length,
        text: String(window.getSelection()),
      };
    });
  const onOpen = await selection();
  if (!onOpen.focused) fail(`[${label}] the dialog did not focus its first control`);
  if (onOpen.start !== onOpen.end)
    fail(`[${label}] opening the dialog selected the copy field text: ${JSON.stringify(onOpen)}`);
  await shot('link-ready');
  // A real click selects the whole value; so does arriving with the Tab key.
  await page.getByTestId('link-ready-field').click();
  const onClick = await selection();
  if (onClick.start !== 0 || onClick.end !== onClick.length)
    fail(`[${label}] a click did not select the copy field: ${JSON.stringify(onClick)}`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const onTab = await selection();
  if (!onTab.focused || onTab.start !== 0 || onTab.end !== onTab.length) {
    fail(`[${label}] Tab into the copy field did not select it: ${JSON.stringify(onTab)}`);
  }
  note(
    `[${label}] copy field in a dialog: on open ${JSON.stringify(onOpen)}, after click ${onClick.start}-${onClick.end}, after Tab ${onTab.start}-${onTab.end}`,
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('link-ready').waitFor({ state: 'detached' });

  // A confirmation with a list under its message.
  await page.getByTestId('open-confirm-list').click();
  const confirm = page.getByTestId('confirm-list');
  await confirm.waitFor();
  const confirmState = await confirm.evaluate((element) => ({
    described: document.getElementById(element.getAttribute('aria-describedby'))?.textContent,
    items: element.querySelectorAll('.rd-dialog__body li').length,
    focus: document.activeElement?.textContent,
  }));
  if (
    confirmState.described !== 'You can restore them from the trash for 30 days.' ||
    confirmState.items !== 3 ||
    confirmState.focus !== 'Cancel'
  ) {
    fail(`[${label}] confirmation with detail: ${JSON.stringify(confirmState)}`);
  }
  await shot('confirm-list');
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'detached' });

  // The sheet: attached to the edge, full height, modal.
  await page.getByTestId('open-sheet').click();
  const sheet = page.getByTestId('snapshots-sheet');
  await sheet.waitFor();
  await page.waitForTimeout(260);
  const sheetBox = await sheet.boundingBox();
  note(`[${label}] sheet box ${JSON.stringify(sheetBox)}`);
  const expectedWidth = Math.min(400, width);
  if (
    !sheetBox ||
    Math.round(sheetBox.x + sheetBox.width) !== width ||
    Math.round(sheetBox.height) !== 760 ||
    Math.round(sheetBox.width) !== expectedWidth
  ) {
    fail(`[${label}] the sheet is not attached to the end edge at full height`);
  }
  if (
    !(await page
      .getByTestId('snapshot-name')
      .evaluate((element) => element === document.activeElement))
  ) {
    fail(`[${label}] the sheet did not focus its first field`);
  }
  await shot('sheet');
  for (let step = 0; step < 12; step += 1) await page.keyboard.press('Tab');
  if (!(await page.evaluate(() => Boolean(document.activeElement?.closest('.rd-sheet-layer'))))) {
    fail(`[${label}] Tab left the open sheet`);
  }
  // A menu opened inside the sheet is drawn above it and takes Escape first.
  await page.getByTestId('snapshot-menu').click();
  const menu = page.locator('.rd-sheet-layer').getByRole('menu');
  await menu.waitFor();
  await page.waitForTimeout(260);
  const onTop = await page.evaluate(() => {
    const item = document.querySelector('.rd-sheet-layer [role="menuitem"]');
    if (!item) return 'no menu inside the sheet layer';
    const rect = item.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return item.contains(hit) ? 'ok' : `covered by ${hit?.className}`;
  });
  if (onTop !== 'ok') fail(`[${label}] menu inside the sheet: ${onTop}`);
  await shot('sheet-menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  if ((await sheet.count()) !== 1)
    fail(`[${label}] Escape closed the sheet together with its menu`);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  if (
    !(await page
      .getByTestId('open-sheet')
      .evaluate((element) => element === document.activeElement))
  ) {
    fail(`[${label}] focus did not return to the button that opened the sheet`);
  }
  const scrollRestored = await page.evaluate(() => document.body.style.overflow);
  if (scrollRestored === 'hidden')
    fail(`[${label}] the page is still scroll-locked after the sheet closed`);
  await context.close();
}

const browser = await chromium.launch();
try {
  if (wants('pages')) {
    for (const theme of ['dark', 'light']) {
      for (const width of [1280, 360]) await fullPage(browser, theme, width);
    }
  }
  if (wants('overlays')) {
    for (const theme of ['dark', 'light']) {
      for (const width of [1280, 360]) await overlays(browser, theme, width);
    }
  }
  if (wants('focus')) {
    for (const theme of ['dark', 'light']) await focusRings(browser, theme);
  }
  if (wants('measure')) await measurements(browser);
  if (wants('a11y')) await accessibilityTree(browser);
  if (wants('behaviour')) await behaviour(browser);
  if (wants('additions')) {
    for (const theme of ['dark', 'light']) {
      for (const width of [1280, 360]) await additions(browser, theme, width);
    }
  }
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nNo problems found.');
