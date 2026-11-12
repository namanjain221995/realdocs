import { mmToPx, pageDimensionsMm, type PageSettings } from '@realtimedocs/contracts';
import type { CSSProperties } from 'react';

const px = (mm: number): string => `${mmToPx(mm).toFixed(2)}px`;

/**
 * Custom properties (see styles.css, section 14) for the page layout. Built
 * only from normalised numbers, so no stored text reaches the stylesheet.
 */
export function pageStyleVars(settings: PageSettings): CSSProperties {
  const { width, height } = pageDimensionsMm(settings);
  const share = (mm: number): string => `${((mm / width) * 100).toFixed(3)}%`;
  return {
    '--rd-page-width': px(width),
    '--rd-page-ratio': `${width} / ${height}`,
    '--rd-page-mt': px(settings.marginTop),
    '--rd-page-mr': px(settings.marginRight),
    '--rd-page-mb': px(settings.marginBottom),
    '--rd-page-ml': px(settings.marginLeft),
    '--rd-page-mt-pct': share(settings.marginTop),
    '--rd-page-mr-pct': share(settings.marginRight),
    '--rd-page-mb-pct': share(settings.marginBottom),
    '--rd-page-ml-pct': share(settings.marginLeft),
  } as CSSProperties;
}
