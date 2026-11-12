import { useEffect, type RefObject } from 'react';

/**
 * Gentle once-only fade-in for elements marked `data-reveal` below the fold. Elements already in
 * view are never hidden, nothing is hidden without IntersectionObserver or when the visitor asked
 * for reduced motion, and an element that was revealed stays revealed.
 */
export function useReveal(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scope = root.current;
    if (!scope || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = 'in';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const element of scope.querySelectorAll<HTMLElement>('[data-reveal]')) {
      if (element.getBoundingClientRect().top < window.innerHeight) {
        element.dataset.reveal = 'in';
        continue;
      }
      element.dataset.reveal = 'pending';
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
      for (const element of scope.querySelectorAll<HTMLElement>('[data-reveal="pending"]')) {
        element.dataset.reveal = 'in';
      }
    };
  }, [root]);
}
