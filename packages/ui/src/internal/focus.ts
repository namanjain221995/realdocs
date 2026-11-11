import type { RefObject } from 'react';

const CANDIDATE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function isRendered(element: HTMLElement): boolean {
  // No client rects means `display: none` on the element or an ancestor.
  if (element.getClientRects().length === 0) return false;
  return getComputedStyle(element).visibility !== 'hidden';
}

/** True when the element can receive focus right now (by script or by the user). */
export function isFocusable(element: HTMLElement): boolean {
  if (element.matches(':disabled')) return false;
  if (element.closest('[inert]')) return false;
  return isRendered(element);
}

function tabIndexOf(element: HTMLElement): number {
  const attribute = element.getAttribute('tabindex');
  if (attribute === null) return 0;
  const parsed = Number.parseInt(attribute, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Focusable descendants in DOM order, including those with `tabindex="-1"`. */
export function getFocusable(root: ParentNode): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
    if (isFocusable(element)) result.push(element);
  }
  return result;
}

/** Descendants reachable with the Tab key, in DOM order. */
export function getTabbable(root: ParentNode): HTMLElement[] {
  return getFocusable(root).filter((element) => tabIndexOf(element) >= 0);
}

/** Focuses without scrolling the page; tolerates elements that are gone. */
export function focusElement(element: HTMLElement | null | undefined): void {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    // Detached or otherwise unfocusable: nothing to do.
  }
}

/**
 * Keeps one Tab key press inside `scope`: wraps at either end and pulls focus
 * back in when it has escaped. `fallback` takes focus when nothing in the
 * scope can be tabbed to. `owns` names elements outside the scope that still
 * belong to it (an overlay portalled elsewhere) and are left alone.
 */
export function trapTabKey(
  event: KeyboardEvent,
  scope: HTMLElement,
  fallback: HTMLElement | null,
  owns?: (element: Element) => boolean,
): void {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const tabbable = getTabbable(scope);
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    focusElement(fallback);
    return;
  }
  const active = document.activeElement;
  if (!active || !scope.contains(active)) {
    if (active && owns?.(active)) return;
    event.preventDefault();
    focusElement(event.shiftKey ? last : first);
  } else if (event.shiftKey && (active === first || active === fallback)) {
    event.preventDefault();
    focusElement(last);
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusElement(first);
  }
}

/**
 * An element to focus: a ref to it, or a function that returns it. The
 * function is called once the overlay is in the DOM; when it returns nothing,
 * the overlay falls back to its default.
 */
export type FocusTarget = RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined);

export function resolveFocusTarget(target: FocusTarget | undefined): HTMLElement | null {
  if (!target) return null;
  return (typeof target === 'function' ? target() : target.current) ?? null;
}

/** The focused element, or null when focus rests on the document body. */
export function getActiveElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * Controls whose own operation needs the horizontal arrow keys. Composite
 * widgets (toolbar, radio group) leave arrow handling to these elements.
 */
export function usesArrowKeys(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  if (
    element.getAttribute('contenteditable') === 'true' ||
    element.getAttribute('contenteditable') === ''
  ) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    const type = element.type;
    return !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'reset', 'submit'].includes(
      type,
    );
  }
  return false;
}
