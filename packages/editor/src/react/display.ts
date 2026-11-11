/** Per-reader display preferences. They never touch the shared document. */
import type { CSSProperties } from 'react';

export interface DisplayPreferences {
  /** 0.8 – 1.8, multiplies the document font size. */
  fontScale: number;
  readingWidth: 'narrow' | 'normal' | 'wide' | 'full';
  /** Document colours; `inherit` follows the app theme. */
  tone: 'inherit' | 'dark' | 'light';
}

export const DEFAULT_DISPLAY: DisplayPreferences = {
  fontScale: 1,
  readingWidth: 'normal',
  tone: 'inherit',
};

const WIDTHS: Record<DisplayPreferences['readingWidth'], string> = {
  narrow: '600px',
  normal: '780px',
  wide: '1040px',
  full: 'none',
};

export function resolveDisplay(
  display: Partial<DisplayPreferences> | undefined,
): DisplayPreferences {
  const scale = Number(display?.fontScale);
  return {
    fontScale: Number.isFinite(scale) ? Math.min(1.8, Math.max(0.8, scale)) : 1,
    readingWidth:
      display?.readingWidth && display.readingWidth in WIDTHS ? display.readingWidth : 'normal',
    tone: display?.tone === 'dark' || display?.tone === 'light' ? display.tone : 'inherit',
  };
}

/** Attributes for the element that wraps the document surface. */
export function displayProps(display: DisplayPreferences): {
  style: CSSProperties;
  'data-reading-width': string;
  'data-theme'?: 'dark' | 'light';
} {
  return {
    style: {
      '--rd-doc-scale': String(display.fontScale),
      '--rd-doc-width': WIDTHS[display.readingWidth],
    } as CSSProperties,
    'data-reading-width': display.readingWidth,
    ...(display.tone === 'inherit' ? {} : { 'data-theme': display.tone }),
  };
}

/** Colour scheme in effect at `element` (the UI kit's `data-theme`; dark by default). */
export function effectiveTheme(
  element: Element | null,
  tone: DisplayPreferences['tone'],
): 'dark' | 'light' {
  if (tone !== 'inherit') return tone;
  const themed = element?.closest('[data-theme]');
  return themed?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
