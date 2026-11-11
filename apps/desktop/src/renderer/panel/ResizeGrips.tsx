import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { RESIZE_EDGES, type ResizeEdge } from '../../shared/geometry';
import { desktop } from '../shared/desktop';

/**
 * Edge and corner grips. The window is created non-resizable (transparent
 * windows are documented as not natively resizable), so resizing is: capture
 * the pointer, report its screen movement once per animation frame, and let
 * the main process clamp and apply the bounds.
 *
 * Screen coordinates are used because the window itself moves while a top or
 * left grip is dragged.
 */
export function ResizeGrips({ collapsed }: { collapsed: boolean }) {
  const drag = useRef<{ pointerId: number; x: number; y: number; frame: number | null } | null>(
    null,
  );
  const latest = useRef<{ dx: number; dy: number } | null>(null);

  const finish = (target: HTMLElement) => {
    const active = drag.current;
    if (!active) return;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    if (latest.current) desktop?.window.resizeMove(latest.current.dx, latest.current.dy);
    latest.current = null;
    drag.current = null;
    if (target.hasPointerCapture(active.pointerId)) target.releasePointerCapture(active.pointerId);
    void desktop?.window.resizeEnd();
  };

  const onPointerDown = (edge: ResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, frame: null };
    void desktop?.window.resizeStart(edge);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    latest.current = { dx: event.screenX - active.x, dy: event.screenY - active.y };
    if (active.frame !== null) return;
    active.frame = requestAnimationFrame(() => {
      active.frame = null;
      const move = latest.current;
      if (!move || drag.current !== active) return;
      latest.current = null;
      desktop?.window.resizeMove(move.dx, move.dy);
    });
  };

  const edges = collapsed
    ? RESIZE_EDGES.filter((edge) => edge === 'e' || edge === 'w')
    : RESIZE_EDGES;

  return (
    <div className="rdp-grips" aria-hidden="true" data-testid="rd-resize-grips">
      {edges.map((edge) => (
        <div
          key={edge}
          className={`rdp-grip rdp-grip--${edge}`}
          data-testid={`rd-grip-${edge}`}
          onPointerDown={onPointerDown(edge)}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finish(event.currentTarget)}
          onPointerCancel={(event) => finish(event.currentTarget)}
          onLostPointerCapture={(event) => finish(event.currentTarget)}
        />
      ))}
    </div>
  );
}
