/**
 * Print view: the document's page size, orientation and margins.
 *
 * On screen the sheet is drawn at the paper size with the margins as padding
 * (custom properties on the sheet). On paper the browser's own page box is
 * used, so an `@page` rule is installed. The rule is added through the CSSOM
 * (`CSSStyleSheet.insertRule`) into an empty <style> element: no stylesheet
 * text is parsed from markup, so a Content-Security-Policy that forbids inline
 * styles would not block it. The text of the rule is built from numbers and
 * keywords produced by `pageRuleCss`, never from stored strings.
 */
import { pageDimensionsMm, pageRuleCss, type PageSettings } from '@realtimedocs/contracts';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

const mm = (value: number): string => `${value}mm`;

export function printSheetStyle(settings: PageSettings | null): CSSProperties | undefined {
  if (!settings) return undefined;
  const { width } = pageDimensionsMm(settings);
  return {
    '--print-page-width': mm(width),
    '--print-mt': mm(settings.marginTop),
    '--print-mr': mm(settings.marginRight),
    '--print-mb': mm(settings.marginBottom),
    '--print-ml': mm(settings.marginLeft),
  } as CSSProperties;
}

/** Installs `@page { size; margin }` for the settings while the print view is mounted. */
export function usePrintPageRule(settings: PageSettings | null): void {
  useEffect(() => {
    if (!settings) return undefined;
    const element = document.createElement('style');
    element.setAttribute('data-print-page', '');
    document.head.append(element);
    try {
      element.sheet?.insertRule(pageRuleCss(settings), 0);
    } catch {
      // A browser without @page support keeps the default page.
    }
    return () => element.remove();
  }, [settings]);
}
