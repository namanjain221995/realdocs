import { type RefObject, useCallback, useEffect, useState } from 'react';
import { useIsomorphicLayoutEffect } from './hooks';

export interface ScrollFade {
  /** Content is hidden before the visible part. */
  start: boolean;
  /** Content is hidden after the visible part. */
  end: boolean;
}

/**
 * Tracks which edges of a horizontally scrolling row hide content, so the row
 * can fade there. Also lets a plain mouse wheel scroll the row sideways.
 */
export function useScrollFade(scroller: RefObject<HTMLElement | null>): {
  fade: ScrollFade;
  sync: () => void;
} {
  const [fade, setFade] = useState<ScrollFade>({ start: false, end: false });

  const sync = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const overflow = element.scrollWidth - element.clientWidth;
    // `scrollLeft` is negative in right-to-left rows.
    const position = Math.abs(element.scrollLeft);
    const start = overflow > 1 && position > 1;
    const end = overflow > 1 && position < overflow - 1;
    setFade((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, [scroller]);

  // After every render: the content of the row may have changed.
  useIsomorphicLayoutEffect(() => {
    sync();
  });

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    resizes?.observe(element);
    element.addEventListener('scroll', sync, { passive: true });

    // A mouse wheel only scrolls vertically; map it onto the overflowing row.
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (element.scrollWidth - element.clientWidth <= 1) return;
      const before = element.scrollLeft;
      element.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      // At either end the page scrolls as usual.
      if (element.scrollLeft !== before) event.preventDefault();
    };
    element.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      resizes?.disconnect();
      element.removeEventListener('scroll', sync);
      element.removeEventListener('wheel', onWheel);
    };
  }, [scroller, sync]);

  return { fade, sync };
}
