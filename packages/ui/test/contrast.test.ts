// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Reads the colour tokens straight from src/styles.css and checks the WCAG 2.x
 * contrast of every pairing the components use, in both themes. Translucent
 * tokens are composited over each surface they can sit on first.
 */

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];
type Tokens = Map<string, string>;

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function blockAfter(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Selector not found in styles.css: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function declarations(block: string): Tokens {
  const tokens: Tokens = new Map();
  for (const match of block.matchAll(/(--rd-[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) tokens.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return tokens;
}

const shared = declarations(blockAfter(':root {'));
const dark = declarations(blockAfter(":root,\n[data-theme='dark'] {"));
const light = declarations(blockAfter("[data-theme='light'] {"));

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  }
  throw new Error(`Unsupported colour syntax: ${value}`);
}

function resolve(tokens: Tokens, name: string): Rgba {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Token ${name} is not defined`);
  const reference = /^var\((--rd-[\w-]+)\)$/.exec(value)?.[1];
  return reference ? resolve(tokens, reference) : parseColor(value);
}

function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgb): Rgb {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--rd-bg', '--rd-surface-1', '--rd-surface-2', '--rd-surface-3'] as const;
const TONES = ['accent', 'danger', 'warning', 'success', 'info'] as const;

/** Every token name other packages rely on. */
const CONTRACT_COLOURS = [
  '--rd-bg',
  '--rd-surface-1',
  '--rd-surface-2',
  '--rd-surface-3',
  '--rd-overlay',
  '--rd-border',
  '--rd-border-strong',
  '--rd-text',
  '--rd-text-muted',
  '--rd-text-faint',
  '--rd-accent',
  '--rd-accent-hover',
  '--rd-accent-contrast',
  '--rd-accent-soft',
  '--rd-danger',
  '--rd-danger-soft',
  '--rd-warning',
  '--rd-warning-soft',
  '--rd-success',
  '--rd-success-soft',
  '--rd-info',
  '--rd-info-soft',
  '--rd-focus-ring',
  '--rd-shadow-1',
  '--rd-shadow-2',
  '--rd-shadow-3',
];

const CONTRACT_SHARED: Record<string, string | null> = {
  '--rd-radius-sm': null,
  '--rd-radius-md': null,
  '--rd-radius-lg': null,
  '--rd-radius-full': null,
  '--rd-space-1': '4px',
  '--rd-space-2': '8px',
  '--rd-space-3': '12px',
  '--rd-space-4': '16px',
  '--rd-space-5': '20px',
  '--rd-space-6': '24px',
  '--rd-space-7': '32px',
  '--rd-space-8': '40px',
  '--rd-font-ui': null,
  '--rd-font-doc': null,
  '--rd-font-mono': null,
  '--rd-text-xs': null,
  '--rd-text-sm': null,
  '--rd-text-md': null,
  '--rd-text-lg': null,
  '--rd-text-xl': null,
  '--rd-text-2xl': null,
  '--rd-leading-tight': null,
  '--rd-leading-normal': null,
  '--rd-z-dropdown': null,
  '--rd-z-modal': null,
  '--rd-z-toast': null,
  '--rd-duration-fast': null,
  '--rd-duration-base': null,
  '--rd-ease': null,
  '--rd-control-h-sm': '28px',
  '--rd-control-h-md': '32px',
};

describe('token contract', () => {
  it('defines every shared token, with the agreed spacing and control sizes', () => {
    for (const [name, expected] of Object.entries(CONTRACT_SHARED)) {
      expect(shared.has(name), `${name} is missing`).toBe(true);
      if (expected !== null) expect(shared.get(name), name).toBe(expected);
    }
  });

  it.each([
    ['dark', dark],
    ['light', light],
  ])('defines every colour token for the %s theme', (_name, tokens) => {
    for (const name of CONTRACT_COLOURS) expect(tokens.has(name), `${name} is missing`).toBe(true);
  });

  it('declares the matching color-scheme for each theme', () => {
    expect(blockAfter(":root,\n[data-theme='dark'] {")).toMatch(/color-scheme:\s*dark;/);
    expect(blockAfter("[data-theme='light'] {")).toMatch(/color-scheme:\s*light;/);
  });

  it('orders the layers dropdown < modal < toast', () => {
    const z = (name: string): number => Number(shared.get(name));
    expect(z('--rd-z-dropdown')).toBeLessThan(z('--rd-z-modal'));
    expect(z('--rd-z-modal')).toBeLessThan(z('--rd-z-toast'));
  });

  it('falls back to system Devanagari and emoji fonts in the document and UI stacks', () => {
    for (const name of ['--rd-font-ui', '--rd-font-doc']) {
      const stack = shared.get(name) ?? '';
      for (const family of [
        'Noto Sans Devanagari',
        'Nirmala UI',
        'Kohinoor Devanagari',
        'Apple Color Emoji',
        'Segoe UI Emoji',
        'Noto Color Emoji',
      ]) {
        expect(stack, `${name} lacks ${family}`).toContain(family);
      }
    }
    expect(shared.get('--rd-font-mono')).toContain('monospace');
  });

  it('keeps motion within 120 to 180ms and switches it off for reduced motion', () => {
    expect(shared.get('--rd-duration-fast')).toBe('120ms');
    expect(shared.get('--rd-duration-base')).toBe('180ms');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/--rd-duration-fast:\s*0ms/);
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme contrast', (_name, tokens) => {
  const solid = (name: string): Rgb => {
    const [r, g, b, a] = resolve(tokens, name);
    if (a !== 1) throw new Error(`${name} is translucent; composite it over a surface`);
    return [r, g, b];
  };
  const on = (name: string, surface: Rgb): Rgb => over(resolve(tokens, name), surface);
  const surfaces = SURFACES.map((name) => [name, solid(name)] as const);

  it('body, muted and faint text reach 4.5:1 on every surface', () => {
    for (const text of ['--rd-text', '--rd-text-muted', '--rd-text-faint']) {
      for (const [surfaceName, surface] of surfaces) {
        expect(contrast(solid(text), surface), `${text} on ${surfaceName}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('accent and status colours reach 4.5:1 as text on every surface', () => {
    for (const tone of TONES) {
      for (const [surfaceName, surface] of surfaces) {
        expect(
          contrast(solid(`--rd-${tone}`), surface),
          `--rd-${tone} on ${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('badge text reaches 4.5:1 on its own soft background over every surface', () => {
    for (const tone of TONES) {
      for (const [surfaceName, surface] of surfaces) {
        const soft = on(`--rd-${tone}-soft`, surface);
        expect(
          contrast(solid(`--rd-${tone}`), soft),
          `--rd-${tone} on --rd-${tone}-soft over ${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5);
        // Banner copy uses the normal text colour on the same tint.
        expect(
          contrast(solid('--rd-text'), soft),
          `--rd-text on --rd-${tone}-soft over ${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('filled buttons reach 4.5:1, at rest and on hover', () => {
    const pairs: Array<[string, string]> = [
      ['--rd-accent-contrast', '--rd-accent'],
      ['--rd-accent-contrast', '--rd-accent-hover'],
      ['--rd-danger-contrast', '--rd-danger-solid'],
      ['--rd-danger-contrast', '--rd-danger-solid-hover'],
    ];
    for (const [text, fill] of pairs) {
      expect(contrast(solid(text), solid(fill)), `${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text stays readable on hover, pressed, input and secondary-button fills', () => {
    // Which text colours each translucent fill carries in the components.
    const usage: Array<[fill: string, texts: string[]]> = [
      ['--rd-hover', ['--rd-text', '--rd-text-muted']],
      ['--rd-active', ['--rd-text']],
      ['--rd-control-bg', ['--rd-text', '--rd-text-muted', '--rd-text-faint']],
      ['--rd-button-bg', ['--rd-text']],
      ['--rd-button-bg-hover', ['--rd-text']],
      ['--rd-button-bg-active', ['--rd-text']],
    ];
    for (const [fill, texts] of usage) {
      for (const [surfaceName, surface] of surfaces) {
        const background = on(fill, surface);
        for (const text of texts) {
          expect(
            contrast(solid(text), background),
            `${text} on ${fill} over ${surfaceName}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('menus, popovers, toasts and tooltips reach 4.5:1', () => {
    const raised = solid('--rd-raised');
    for (const text of ['--rd-text', '--rd-text-muted', '--rd-text-faint', '--rd-danger']) {
      expect(contrast(solid(text), raised), `${text} on --rd-raised`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(solid(text), on('--rd-hover', raised)),
        `${text} on a highlighted menu item`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(solid('--rd-accent'), raised),
      'toast action on --rd-raised',
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(solid('--rd-danger'), on('--rd-danger-soft', raised)),
      'highlighted destructive menu item',
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(solid('--rd-tooltip-text'), solid('--rd-tooltip-bg')),
      'tooltip',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('control outlines, the focus ring and checked fills reach 3:1 against every surface', () => {
    for (const [surfaceName, surface] of surfaces) {
      expect(
        contrast(on('--rd-control-border', surface), surface),
        `--rd-control-border on ${surfaceName}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(solid('--rd-focus-ring'), surface),
        `--rd-focus-ring on ${surfaceName}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(solid('--rd-accent'), surface),
        `checked fill on ${surfaceName}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('pressed toggle buttons reach 4.5:1 in every variant', () => {
    // Filled variants: the label on the darker pressed fill.
    const filled: Array<[string, string]> = [
      ['--rd-accent-contrast', '--rd-accent-pressed'],
      ['--rd-danger-contrast', '--rd-danger-solid-pressed'],
    ];
    for (const [text, fill] of filled) {
      expect(contrast(solid(text), solid(fill)), `${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
    // Outlined and ghost variants: accent text on the accent tint, on any surface.
    for (const [surfaceName, surface] of surfaces) {
      expect(
        contrast(solid('--rd-accent'), on('--rd-accent-soft', surface)),
        `pressed secondary or ghost button over ${surfaceName}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // Pressed has to look different from the resting fill it replaces.
    expect(contrast(solid('--rd-accent-pressed'), solid('--rd-accent'))).toBeGreaterThan(1.5);
    expect(
      contrast(solid('--rd-danger-solid-pressed'), solid('--rd-danger-solid')),
    ).toBeGreaterThan(1.5);
  });

  it('links reach 4.5:1 at rest and on hover, wherever running text can sit', () => {
    for (const colour of ['--rd-accent', '--rd-accent-hover']) {
      for (const [surfaceName, surface] of surfaces) {
        expect(
          contrast(solid(colour), surface),
          `link ${colour} on ${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5);
        // Inside a banner, on its tint.
        for (const tone of TONES) {
          expect(
            contrast(solid(colour), on(`--rd-${tone}-soft`, surface)),
            `link ${colour} on --rd-${tone}-soft over ${surfaceName}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Inside a popover, a menu or a toast.
      expect(
        contrast(solid(colour), solid('--rd-raised')),
        `link ${colour} on --rd-raised`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('status dots and message icons reach 3:1, plain and on their own tint', () => {
    // Surface 3 is for small raised details; dots and banners do not sit on it.
    for (const [surfaceName, surface] of surfaces.slice(0, 3)) {
      for (const tone of TONES) {
        const signal = solid(`--rd-signal-${tone}`);
        expect(
          contrast(signal, surface),
          `--rd-signal-${tone} on ${surfaceName}`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrast(signal, on(`--rd-${tone}-soft`, surface)),
          `--rd-signal-${tone} on --rd-${tone}-soft over ${surfaceName}`,
        ).toBeGreaterThanOrEqual(3);
      }
      expect(
        contrast(solid('--rd-text-muted'), surface),
        `neutral dot on ${surfaceName}`,
      ).toBeGreaterThanOrEqual(3);
    }
    for (const tone of TONES) {
      expect(
        contrast(solid(`--rd-signal-${tone}`), solid('--rd-raised')),
        `--rd-signal-${tone} in a toast`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps hairline borders subtle but present', () => {
    for (const [surfaceName, surface] of surfaces) {
      const hairline = contrast(on('--rd-border', surface), surface);
      const strong = contrast(on('--rd-border-strong', surface), surface);
      expect(hairline, `--rd-border on ${surfaceName}`).toBeGreaterThan(1.15);
      expect(strong, `--rd-border-strong on ${surfaceName}`).toBeGreaterThan(hairline);
    }
  });
});
