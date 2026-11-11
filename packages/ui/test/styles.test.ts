// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * Structural guards for src/styles.css: rules that are easy to break without
 * any unit test noticing, each one learned from a defect seen in a browser.
 */

const cssUrl = new URL('../src/styles.css', import.meta.url);
const css = readFileSync(cssUrl, 'utf8');
/** The stylesheet without comments, so prose cannot satisfy an assertion. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of the first rule whose selector list is exactly `selector`. */
function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(rules);
  if (!match?.[1]) throw new Error(`No rule for ${selector} in styles.css`);
  return match[1];
}

describe('styles.css', () => {
  it('self-hosts its fonts from installed packages', () => {
    const imports = [...rules.matchAll(/@import\s+'([^']+)';/g)].map((match) => match[1] ?? '');
    expect(imports).toEqual([
      '@fontsource-variable/atkinson-hyperlegible-next/wght.css',
      '@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css',
      '@fontsource-variable/atkinson-hyperlegible-mono/wght.css',
      '@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css',
    ]);
    const require = createRequire(cssUrl);
    for (const specifier of imports) {
      const file = require.resolve(specifier);
      expect(existsSync(file), specifier).toBe(true);
      // The family names in the token stacks must be the ones the packages register.
      const family = /font-family:\s*'([^']+)'/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
      expect(family).toMatch(/^Atkinson Hyperlegible (Next|Mono) Variable$/);
      expect(rules).toContain(`'${family}'`);
    }
  });

  it('loads nothing from the network and embeds no data: URIs', () => {
    // A strict Content-Security-Policy (the desktop app has one) would block both.
    expect(rules).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
    expect(rules).not.toMatch(/data:/i);
    expect(rules).not.toMatch(/@import\s+url\(/i);
  });

  it('keeps every class behind the rd- prefix', () => {
    // File extensions in the @import lines are not class names.
    const withoutImports = rules.replace(/@import[^;]+;/g, '');
    const classes = new Set(
      [...withoutImports.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((match) => match[1] ?? ''),
    );
    expect(classes.size).toBeGreaterThan(100);
    expect([...classes].filter((name) => !name.startsWith('rd-'))).toEqual([]);
  });

  it('never raises specificity with ids or !important outside the reduced-motion block', () => {
    const reducedMotion = rules.indexOf('@media (prefers-reduced-motion: reduce)');
    const forcedColors = rules.indexOf('@media (forced-colors: active)');
    expect(reducedMotion).toBeGreaterThan(0);
    expect(forcedColors).toBeGreaterThan(reducedMotion);
    expect(rules.slice(0, reducedMotion)).not.toContain('!important');
    expect(rules.slice(forcedColors)).not.toContain('!important');
    // Hex colours are the only place a # may appear.
    expect(rules).not.toMatch(/#[a-zA-Z_][\w-]*\s*[{,]/);
  });

  it('keeps the base reset at zero specificity so app styles always win', () => {
    for (const selector of [
      ':where(html)',
      ':where(body)',
      ':where([data-theme])',
      ':where(button, input, select, textarea)',
      ':where(:focus-visible)',
    ]) {
      expect(() => declarationsOf(selector), selector).not.toThrow();
    }
    expect(declarationsOf(':where(body)')).toMatch(/background:\s*var\(--rd-bg\)/);
    expect(declarationsOf(':where(body)')).toMatch(/color:\s*var\(--rd-text\)/);
    expect(declarationsOf(':where(body)')).toMatch(/font-family:\s*var\(--rd-font-ui\)/);
    expect(declarationsOf(':where(:focus-visible)')).toMatch(
      /outline:\s*2px solid var\(--rd-focus-ring\)/,
    );
  });

  it('gives visually hidden content a positioned ancestor in every scroll container', () => {
    // An absolutely positioned child escapes the clipping of a scroll container
    // that is not its containing block, and then widens the whole page.
    expect(declarationsOf('.rd-visually-hidden')).toMatch(/position:\s*absolute/);
    for (const selector of [
      '.rd-toolbar__scroll',
      '.rd-tabs__list',
      '.rd-scroll-area',
      '.rd-dialog__body',
      '.rd-menu',
      '.rd-field',
      '.rd-segmented__option',
      '.rd-spinner',
    ]) {
      expect(declarationsOf(selector), selector).toMatch(/position:\s*relative/);
    }
    // Popovers and tooltips are fixed, which makes them containing blocks too.
    expect(declarationsOf('.rd-popover,\n.rd-tooltip')).toMatch(/position:\s*fixed/);
  });

  it('lets a tall dialog scroll inside itself instead of leaving the viewport', () => {
    const layer = declarationsOf('.rd-dialog-layer');
    // Without a definite grid cell, `max-height: 100%` on the dialog is ignored.
    expect(layer).toMatch(/grid-template:\s*minmax\(0, 1fr\) \/ minmax\(0, 1fr\)/);
    const dialog = declarationsOf('.rd-dialog');
    expect(dialog).toMatch(/max-height:\s*100%/);
    expect(dialog).toMatch(/flex-direction:\s*column/);
    const body = declarationsOf('.rd-dialog__body');
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden auto/);
  });

  it('scrolls the toolbar and the tab list inside themselves, with masked edges', () => {
    for (const selector of ['.rd-toolbar__scroll', '.rd-tabs__list']) {
      const declarations = declarationsOf(selector);
      expect(declarations, selector).toMatch(/overflow:\s*auto hidden/);
      expect(declarations, selector).toMatch(/min-width:\s*0/);
    }
    expect(declarationsOf('.rd-toolbar')).toMatch(/max-width:\s*100%/);
    expect(rules).toMatch(
      /\.rd-toolbar\[data-fade-end\] > \.rd-toolbar__scroll,\s*\.rd-tabs__list\[data-fade-end\]\s*\{\s*mask-image:/,
    );
  });

  it('centres the loading spinner over a button whatever .rd-spinner itself declares', () => {
    // `.rd-spinner { position: relative }` comes later in the file, so the
    // button rule needs the higher specificity to keep the spinner out of flow.
    expect(declarationsOf('.rd-btn > .rd-btn__spinner')).toMatch(/position:\s*absolute/);
    expect(rules.indexOf('.rd-btn > .rd-btn__spinner')).toBeLessThan(
      rules.indexOf('.rd-spinner {'),
    );
  });

  it('offers rd-translucent for see-through panels: full-strength text, stronger hairlines', () => {
    const translucent = declarationsOf('.rd-translucent');
    expect(translucent).toMatch(/--rd-text-muted:\s*var\(--rd-text\)/);
    expect(translucent).toMatch(/--rd-text-faint:\s*var\(--rd-text\)/);
    expect(translucent).toMatch(/--rd-border:\s*var\(--rd-border-strong\)/);
  });

  it('styles pressed toggle buttons at a weight an app class can still override', () => {
    // `.rd-btn--secondary:where([aria-pressed='true'])` weighs one class, the
    // same as the variant rule it follows, so `.my-toggle { background: … }`
    // in an app stylesheet loaded after the kit still wins.
    for (const variant of ['secondary', 'ghost', 'primary', 'danger']) {
      const selector = `.rd-btn--${variant}:where([aria-pressed='true'])`;
      expect(rules, selector).toContain(`${selector},`);
      // The pressed look survives hover and the moment of pressing.
      expect(rules, selector).toContain(`${selector}:hover`);
      expect(rules, selector).toContain(`${selector}:active`);
      expect(rules.indexOf(selector), selector).toBeGreaterThan(
        rules.indexOf(`.rd-btn--${variant}:active`),
      );
    }
    // Only the forced-colours block, which redraws state with outlines, names
    // the attribute at full weight.
    const beforeForcedColours = rules.slice(0, rules.indexOf('@media (forced-colors: active)'));
    expect(beforeForcedColours).not.toMatch(/\.rd-btn[\w-]*\[aria-pressed='true'\]\s*[,{:]/);
    const soft = declarationsOf(
      [
        ".rd-btn--secondary:where([aria-pressed='true'])",
        ".rd-btn--secondary:where([aria-pressed='true']):hover",
        ".rd-btn--secondary:where([aria-pressed='true']):active",
        ".rd-btn--ghost:where([aria-pressed='true'])",
        ".rd-btn--ghost:where([aria-pressed='true']):hover",
        ".rd-btn--ghost:where([aria-pressed='true']):active",
      ].join(',\n'),
    );
    // The same pair a pressed icon button uses.
    const iconButton = declarationsOf(".rd-icon-btn[aria-pressed='true']");
    expect(soft).toMatch(/background:\s*var\(--rd-accent-soft\)/);
    expect(soft).toMatch(/color:\s*var\(--rd-accent\)/);
    expect(iconButton).toMatch(/background:\s*var\(--rd-accent-soft\)/);
    expect(iconButton).toMatch(/color:\s*var\(--rd-accent\)/);
    expect(rules).toMatch(
      /\.rd-btn--primary:where\(\[aria-pressed='true'\]\):active\s*\{\s*background:\s*var\(--rd-accent-pressed\)/,
    );
    expect(rules).toMatch(
      /\.rd-btn--danger:where\(\[aria-pressed='true'\]\):active\s*\{\s*background:\s*var\(--rd-danger-solid-pressed\)/,
    );
  });

  it('keeps the real checkbox and switch input on top, so it is what a click hits', () => {
    // While a switch is on, its thumb is transformed and would paint above an
    // input without a z-index: a scripted click on the input was then refused.
    const input = declarationsOf('.rd-check__input,\n.rd-switch__input');
    expect(input).toMatch(/position:\s*absolute/);
    expect(input).toMatch(/z-index:\s*1/);
    expect(input).toMatch(/opacity:\s*0/);
    // Larger than the visible control, so it covers the whole of it.
    expect(input).toMatch(/width:\s*calc\(100% \+ 8px\)/);
    expect(input).toMatch(/height:\s*calc\(100% \+ 8px\)/);
    const control = declarationsOf('.rd-check__control,\n.rd-switch__control');
    expect(control).toMatch(/position:\s*relative/);
    // The z-index stays inside the control.
    expect(control).toMatch(/isolation:\s*isolate/);
  });

  it('offers links as an opt-in class and never styles bare anchors', () => {
    const link = declarationsOf('.rd-link');
    expect(link).toMatch(/color:\s*var\(--rd-accent\)/);
    expect(link).toMatch(/text-decoration:\s*underline/);
    expect(declarationsOf('.rd-link:hover,\n.rd-link:active')).toMatch(
      /color:\s*var\(--rd-accent-hover\)/,
    );
    expect(declarationsOf('.rd-link:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--rd-focus-ring\)/,
    );
    // No rule may select `a` on its own: every selector list is checked.
    const selectors = [...rules.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)].flatMap((match) =>
      (match[1] ?? '').split(','),
    );
    expect(selectors.length).toBeGreaterThan(300);
    const bareAnchors = selectors.filter((selector) =>
      /(?:^|[\s>+~(])a(?:$|[\s>+~:.[#)])/.test(selector.trim()),
    );
    expect(bareAnchors).toEqual([]);
  });

  it('builds the sheet like the dialog: a fixed layer, a scrolling body', () => {
    const layer = declarationsOf('.rd-sheet-layer');
    expect(layer).toMatch(/position:\s*fixed/);
    expect(layer).toMatch(/z-index:\s*var\(--rd-z-modal\)/);
    const sheet = declarationsOf('.rd-sheet');
    expect(sheet).toMatch(/max-width:\s*100%/);
    expect(sheet).toMatch(/height:\s*100%/);
    const body = declarationsOf('.rd-sheet__body');
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden auto/);
  });

  it('enlarges controls and input text for touch', () => {
    const coarse = rules.slice(rules.indexOf('@media (pointer: coarse)'));
    expect(coarse).toMatch(/--rd-control-h-sm:\s*36px/);
    expect(coarse).toMatch(/--rd-control-h-md:\s*40px/);
    // Below 16px iOS Safari zooms the page when an input is focused.
    expect(coarse).toMatch(/\.rd-input__control\s*\{\s*font-size:\s*16px/);
  });
});
