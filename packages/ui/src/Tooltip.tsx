import {
  cloneElement,
  type ComponentProps,
  type FocusEvent,
  isValidElement,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from './internal/floating';
import { useMergedRefs } from './internal/hooks';
import { nestedThemeOf, usePortalContainer } from './internal/layers';
import { cx } from './utils';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps extends Omit<ComponentProps<'div'>, 'content' | 'children'> {
  /** Text shown in the tooltip. Nothing renders when it is empty. */
  content: ReactNode;
  /** Preferred side; flips when there is no room. Defaults to `top`. */
  side?: TooltipSide;
  /**
   * The element the tooltip belongs to. It must forward `ref`, pointer and
   * focus handlers to a DOM node (every control in this kit does).
   */
  children: ReactNode;
  /** Hover delay in ms. Keyboard focus always opens at once. Defaults to 450. */
  delayMs?: number;
  disabled?: boolean;
  /**
   * Expose the tooltip as the child's accessible description. Turn off when the
   * content only repeats the child's accessible name.
   */
  describe?: boolean;
}

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
}

/** Time the pointer has to travel from the trigger onto the tooltip. */
const HIDE_GRACE_MS = 90;
/** After a tooltip closes, the next one opens without the hover delay. */
const WARM_WINDOW_MS = 400;
let lastClosedAt = 0;

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

function joinIds(...ids: Array<string | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/**
 * A short label for a single child, shown on hover and on keyboard focus.
 * Escape hides it, and it stays open while the pointer rests on it.
 */
export function Tooltip({
  content,
  side = 'top',
  children,
  delayMs = 450,
  disabled = false,
  describe = true,
  className,
  id: idProp,
  ref,
  ...rest
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedId = useId();
  const id = idProp ?? `rd-tooltip-${generatedId}`;
  const container = usePortalContainer();

  const child = isValidElement<TriggerProps>(children) ? children : null;
  const childProps: TriggerProps = child?.props ?? {};
  const anchorRef = useMergedRefs<HTMLElement>(childProps.ref, setAnchor);
  const bubbleRef = useMergedRefs<HTMLDivElement>(ref, setBubble);

  const hasContent =
    content !== null && content !== undefined && content !== false && content !== '';
  const visible = open && !disabled && hasContent;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = (immediately: boolean): void => {
    clearTimer();
    // A popover or menu opened from this element replaces the tooltip.
    if (anchor?.getAttribute('aria-expanded') === 'true') return;
    if (immediately || delayMs <= 0 || Date.now() - lastClosedAt < WARM_WINDOW_MS) {
      setOpen(true);
    } else {
      timer.current = setTimeout(() => setOpen(true), delayMs);
    }
  };

  const hide = (immediately: boolean): void => {
    clearTimer();
    if (immediately) {
      setOpen(false);
    } else {
      timer.current = setTimeout(() => setOpen(false), HIDE_GRACE_MS);
    }
  };

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Not stopped on purpose: one Escape also closes the dialog or popover
      // the tooltip sits in.
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      lastClosedAt = Date.now();
    };
  }, [visible]);

  useFloatingPosition({
    getReference: () => anchor,
    referenceKey: anchor,
    floating: visible ? bubble : null,
    placement: side,
    offset: 6,
  });

  const triggerProps: TriggerProps = {
    ref: anchorRef,
    onPointerEnter: (event) => {
      childProps.onPointerEnter?.(event);
      // Touch has no hover; a long-press tooltip would cover the control.
      if (event.pointerType !== 'touch') show(false);
    },
    onPointerLeave: (event) => {
      childProps.onPointerLeave?.(event);
      hide(false);
    },
    onPointerDown: (event) => {
      childProps.onPointerDown?.(event);
      hide(true);
    },
    onClick: (event) => {
      childProps.onClick?.(event);
      hide(true);
    },
    onFocus: (event) => {
      childProps.onFocus?.(event);
      if (isFocusVisible(event.currentTarget)) show(true);
    },
    onBlur: (event) => {
      childProps.onBlur?.(event);
      hide(true);
    },
    'aria-describedby':
      describe && visible
        ? joinIds(childProps['aria-describedby'], id)
        : childProps['aria-describedby'],
  };

  return (
    <>
      {child ? (
        cloneElement(child, triggerProps)
      ) : (
        <span {...triggerProps} ref={anchorRef} className="rd-tooltip-anchor">
          {children}
        </span>
      )}
      {visible && container
        ? createPortal(
            <div
              {...rest}
              ref={bubbleRef}
              id={id}
              role="tooltip"
              className={cx('rd-tooltip', className)}
              data-theme={nestedThemeOf(anchor)}
              onPointerEnter={clearTimer}
              onPointerLeave={() => hide(false)}
            >
              {content}
            </div>,
            container,
          )
        : null}
    </>
  );
}
