import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DEMO_ALT } from './demoText';

const ProductDemo = lazy(() => import('./ProductDemo'));

/**
 * Holds the space of the demo (so nothing moves when it arrives) and loads its code only when the
 * box is near the viewport, after the first paint. Without IntersectionObserver it loads at once.
 */
export function DemoSlot() {
  const ref = useRef<HTMLDivElement>(null);
  const [wanted, setWanted] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (wanted || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setWanted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [wanted]);

  return (
    <div
      ref={ref}
      className="demo-slot"
      role="group"
      aria-label="Product demonstration"
      data-testid="demo-slot"
    >
      <p className="lp-sr">{DEMO_ALT}</p>
      {wanted ? (
        <Suspense fallback={<div className="demo-slot__hold" aria-hidden="true" />}>
          <ProductDemo />
        </Suspense>
      ) : (
        <div className="demo-slot__hold" aria-hidden="true" />
      )}
    </div>
  );
}
