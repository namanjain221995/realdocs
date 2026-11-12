/**
 * How much of the shared page settings a surface shows.
 *
 * - `page`: the sheet (paper size, all four margins, paper colour), a ruler for editors and the
 *   page setup dialog. The web editor and viewer.
 * - `margins`: only the left and right margins and the ruler, on the host's own background. The
 *   desktop panel: it stays translucent and has no paper, no paper colour and no page height.
 * - `none`: the per-user reading width, nothing of the page settings.
 */
export type PageMode = 'page' | 'margins' | 'none';

export function resolvePageMode(input: {
  variant: 'editor' | 'viewer' | 'panel';
  layout?: 'page' | 'reading' | undefined;
  pageMargins?: boolean | undefined;
}): PageMode {
  if (input.variant !== 'panel') return input.layout === 'reading' ? 'none' : 'page';
  return input.pageMargins === true ? 'margins' : 'none';
}
