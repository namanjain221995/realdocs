import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  type Placement,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/dom';
import { useIsomorphicLayoutEffect, useLatest } from './hooks';

export type FloatingPlacement = Placement;
export type FloatingReference = Element | VirtualElement;

export interface FloatingOptions {
  /** Resolves the element (or virtual rect) to position against. */
  getReference: () => FloatingReference | null;
  /** Re-run positioning when this changes (pass the anchor element or object). */
  referenceKey: unknown;
  floating: HTMLElement | null;
  placement: FloatingPlacement;
  /** Gap between reference and floating element, in px. */
  offset: number;
  /** Give the floating element at least the reference's width. */
  matchWidth?: boolean;
}

/** Distance kept from the viewport edge, in px. */
const VIEWPORT_PADDING = 8;

function snap(value: number): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

/**
 * Keeps `floating` positioned next to the reference: flips to the other side
 * when there is no room, slides along the edge to stay in view, and caps its
 * size to the space available so tall content scrolls instead of overflowing.
 *
 * Styles are written through the CSSOM, which a strict `style-src` CSP allows.
 */
export function useFloatingPosition(options: FloatingOptions): void {
  const { floating, placement, offset: gap, matchWidth = false, referenceKey } = options;
  const getReference = useLatest(options.getReference);

  useIsomorphicLayoutEffect(() => {
    const reference = getReference.current();
    if (!floating || !reference) return;
    let cancelled = false;

    const update = (): void => {
      void computePosition(reference, floating, {
        placement,
        strategy: 'fixed',
        middleware: [
          offset(gap),
          flip({ padding: VIEWPORT_PADDING }),
          shift({ padding: VIEWPORT_PADDING }),
          size({
            padding: VIEWPORT_PADDING,
            apply({ availableWidth, availableHeight, rects, elements }) {
              // Published as custom properties so the stylesheet stays in charge
              // of the size caps and only narrows them to the room there is.
              const style = elements.floating.style;
              style.setProperty(
                '--rd-available-width',
                `${Math.max(0, Math.floor(availableWidth))}px`,
              );
              style.setProperty(
                '--rd-available-height',
                `${Math.max(0, Math.floor(availableHeight))}px`,
              );
              if (matchWidth) style.minWidth = `${Math.round(rects.reference.width)}px`;
            },
          }),
        ],
      }).then(
        (result) => {
          if (cancelled) return;
          floating.style.left = `${snap(result.x)}px`;
          floating.style.top = `${snap(result.y)}px`;
          floating.dataset.placement = result.placement;
          floating.dataset.positioned = 'true';
        },
        () => {
          // Positioning is best effort; show the element where it is.
          if (!cancelled) floating.dataset.positioned = 'true';
        },
      );
    };

    const stop = autoUpdate(reference, floating, update);
    return () => {
      cancelled = true;
      stop();
    };
  }, [floating, placement, gap, matchWidth, referenceKey, getReference]);
}
