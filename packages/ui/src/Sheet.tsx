import { X } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { type FocusTarget, getTabbable, resolveFocusTarget } from './internal/focus';
import { useMergedRefs } from './internal/hooks';
import { usePortalContainer } from './internal/layers';
import {
  OverlayProvider,
  useFocusTrap,
  useOverlayFocus,
  useOverlayLayer,
  useScrollLock,
} from './overlay';
import { cx } from './utils';

export type SheetSide = 'start' | 'end' | 'bottom';
export type SheetSize = 'sm' | 'md' | 'lg';

export interface SheetProps extends Omit<ComponentProps<'div'>, 'title' | 'role'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the sheet. Rendered as its heading. */
  title: ReactNode;
  /** One or two sentences under the title, announced with it. */
  description?: ReactNode;
  /** Actions pinned to the bottom edge. Put the main action last. */
  footer?: ReactNode;
  /** The edge the sheet is attached to. `end` (the default) is the right in left-to-right layouts. */
  side?: SheetSide;
  /** Width for `start` and `end`: `sm` 320px, `md` 400px (default), `lg` 560px. Never wider than the screen. */
  size?: SheetSize;
  /**
   * Whether Escape, a press on the backdrop and the close button dismiss the
   * sheet. Turn off while an action is in flight. Defaults to true.
   */
  dismissible?: boolean;
  /**
   * Where focus goes on open: a ref, or a function that returns the element.
   * Without it: `[data-autofocus]`, then the first control in the body, then
   * the first one in the footer.
   */
  initialFocus?: FocusTarget;
  /** Accessible name of the close button. Defaults to `Close`. */
  closeLabel?: string;
}

/**
 * A modal panel attached to an edge of the screen, for a task that needs more
 * room than a dialog. Focus, Escape and scrolling behave as in `Dialog`.
 *
 * It is built only from the public overlay hooks (`useOverlayLayer`,
 * `useFocusTrap`, `useOverlayFocus`, `useScrollLock`, `OverlayProvider`), so
 * it doubles as the reference for building your own.
 */
export function Sheet({ open, ...rest }: SheetProps) {
  // Mounted only while open, so each opening starts from a clean state.
  return open ? <SheetSurface {...rest} /> : null;
}

function SheetSurface({
  onOpenChange,
  title,
  description,
  footer,
  side = 'end',
  size = 'md',
  dismissible = true,
  initialFocus,
  closeLabel = 'Close',
  className,
  children,
  ref,
  ...rest
}: Omit<SheetProps, 'open'>) {
  const container = usePortalContainer();
  // The fixed wrapper: kit popovers opened inside the sheet are portalled here.
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const panelRef = useMergedRefs<HTMLDivElement>(ref, setPanel);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  const layer = useOverlayLayer(panel, {
    // The top-most overlay owns Escape even when it refuses to close.
    onEscape: () => {
      if (dismissible) onOpenChange(false);
    },
  });
  useFocusTrap(layer);
  useScrollLock();
  useOverlayFocus(layer, {
    initialFocus: () => {
      if (!panel) return null;
      const body = panel.querySelector<HTMLElement>('.rd-sheet__body');
      const footerElement = panel.querySelector<HTMLElement>('.rd-sheet__footer');
      return (
        resolveFocusTarget(initialFocus) ??
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        (body ? getTabbable(body)[0] : undefined) ??
        (footerElement ? getTabbable(footerElement)[0] : undefined) ??
        panel
      );
    },
  });

  if (!container) return null;
  return createPortal(
    <div ref={setWrapper} className={cx('rd-sheet-layer', `rd-sheet-layer--${side}`)}>
      {/* Rendered once the wrapper exists (same frame, before paint). */}
      {wrapper ? (
        <OverlayProvider layer={layer} container={wrapper}>
          <div
            className="rd-sheet__backdrop"
            onPointerDown={(event) => {
              pressStartedOnBackdrop.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
              // Ignore a drag that started inside the sheet and ended out here.
              const pressed = pressStartedOnBackdrop.current;
              pressStartedOnBackdrop.current = false;
              if (pressed && event.target === event.currentTarget && dismissible) {
                onOpenChange(false);
              }
            }}
          />
          <div
            {...rest}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={cx('rd-sheet', `rd-sheet--${size}`, className)}
          >
            <header className="rd-sheet__header">
              <h2 id={titleId} className="rd-sheet__title">
                {title}
              </h2>
              {dismissible ? (
                <IconButton
                  label={closeLabel}
                  size="sm"
                  className="rd-sheet__close"
                  onClick={() => onOpenChange(false)}
                >
                  <X />
                </IconButton>
              ) : null}
            </header>
            {description ? (
              <p id={descriptionId} className="rd-sheet__description">
                {description}
              </p>
            ) : null}
            <div className="rd-sheet__body">{children}</div>
            {footer ? <footer className="rd-sheet__footer">{footer}</footer> : null}
          </div>
        </OverlayProvider>
      ) : null}
    </div>,
    container,
  );
}
