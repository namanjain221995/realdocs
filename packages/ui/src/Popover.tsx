import {
  cloneElement,
  type ComponentProps,
  isValidElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type FloatingPlacement,
  type FloatingReference,
  useFloatingPosition,
} from './internal/floating';
import { focusElement, getActiveElement, getTabbable } from './internal/focus';
import { useIsomorphicLayoutEffect, useLatest, useMergedRefs } from './internal/hooks';
import {
  LayerContext,
  layerContains,
  nestedThemeOf,
  useLayer,
  usePortalContainer,
} from './internal/layers';
import { cx } from './utils';

export type PopoverPlacement = FloatingPlacement;

/** A rectangle to anchor to when there is no element, such as a text selection. */
export interface PopoverVirtualAnchor {
  getBoundingClientRect: () => {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  contextElement?: Element;
}

/** Spread these on the element a popover is anchored to. */
export interface PopoverAnchorProps {
  ref: RefCallback<HTMLElement>;
  'aria-haspopup': 'dialog' | 'menu' | 'listbox' | 'true';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export type PopoverAnchor =
  | ((props: PopoverAnchorProps) => ReactNode)
  | Element
  | PopoverVirtualAnchor
  | RefObject<Element | null>
  | null;

export type PopoverInitialFocus = 'first' | 'container' | 'none' | RefObject<HTMLElement | null>;

export interface PopoverProps extends Omit<ComponentProps<'div'>, 'role'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The element that opens the popover. It is cloned with a ref, the ARIA
   * state and a click handler that toggles `open`.
   */
  trigger?: ReactElement;
  /**
   * What the popover is positioned against when there is no `trigger`:
   * a render prop that receives the props to spread on your own element, an
   * element, a ref to one, or a virtual rectangle. Opening is then up to you.
   */
  anchor?: PopoverAnchor;
  /** Preferred position. Flips and shifts to stay in view. Defaults to `bottom-start`. */
  placement?: PopoverPlacement;
  /** Gap to the anchor in px. Defaults to 6. */
  offset?: number;
  /** `dialog` by default. `none` when the content brings its own role (a menu). */
  role?: 'dialog' | 'menu' | 'listbox' | 'none';
  /**
   * Where focus goes on open: the first tabbable element (default), the
   * popover itself, a given element, or `none` to leave focus where it is.
   */
  initialFocus?: PopoverInitialFocus;
  /** Return focus to the anchor when the popover closes. Defaults to true. */
  returnFocus?: boolean;
  /** Make the popover at least as wide as its anchor. */
  matchAnchorWidth?: boolean;
  closeOnEscape?: boolean;
  closeOnOutsidePress?: boolean;
}

interface TriggerLikeProps {
  ref?: Ref<HTMLElement>;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

function isRefObject(value: unknown): value is RefObject<Element | null> {
  return typeof value === 'object' && value !== null && 'current' in value;
}

/**
 * A non-modal floating panel anchored to an element. It is portalled, moves
 * focus in on open and back on close, and closes on Escape, on a press
 * outside, and when Tab leaves it.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  anchor,
  placement = 'bottom-start',
  offset = 6,
  role = 'dialog',
  initialFocus = 'first',
  returnFocus = true,
  matchAnchorWidth = false,
  closeOnEscape = true,
  closeOnOutsidePress = true,
  id: idProp,
  children,
  ...rest
}: PopoverProps) {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const generatedId = useId();
  const id = idProp ?? `rd-popover-${generatedId}`;

  const triggerElement = isValidElement<TriggerLikeProps>(trigger) ? trigger : null;
  const triggerRef = useMergedRefs<HTMLElement>(triggerElement?.props.ref, setAnchorElement);

  const anchorProps: PopoverAnchorProps = {
    ref: setAnchorElement,
    'aria-haspopup': role === 'none' ? 'true' : role,
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
  };

  let anchorNode: ReactNode = null;
  let external: Element | PopoverVirtualAnchor | RefObject<Element | null> | null = null;
  if (triggerElement) {
    const original = triggerElement.props.onClick;
    anchorNode = cloneElement(triggerElement, {
      ...anchorProps,
      ref: triggerRef,
      onClick: (event: MouseEvent<HTMLElement>) => {
        original?.(event);
        if (!event.defaultPrevented) onOpenChange(!open);
      },
    } as Partial<TriggerLikeProps>);
  } else if (typeof anchor === 'function') {
    anchorNode = anchor(anchorProps);
  } else if (anchor) {
    external = anchor;
  }

  const getReference = useCallback((): FloatingReference | null => {
    if (external === null) return anchorElement;
    return isRefObject(external) ? external.current : external;
  }, [external, anchorElement]);

  return (
    <>
      {anchorNode}
      {open ? (
        <PopoverContent
          {...rest}
          id={id}
          role={role}
          getReference={getReference}
          referenceKey={external ?? anchorElement}
          placement={placement}
          offset={offset}
          initialFocus={initialFocus}
          returnFocus={returnFocus}
          matchAnchorWidth={matchAnchorWidth}
          closeOnEscape={closeOnEscape}
          closeOnOutsidePress={closeOnOutsidePress}
          onOpenChange={onOpenChange}
        >
          {children}
        </PopoverContent>
      ) : null}
    </>
  );
}

interface PopoverContentProps extends Omit<ComponentProps<'div'>, 'role'> {
  id: string;
  role: 'dialog' | 'menu' | 'listbox' | 'none';
  getReference: () => FloatingReference | null;
  referenceKey: unknown;
  placement: PopoverPlacement;
  offset: number;
  initialFocus: PopoverInitialFocus;
  returnFocus: boolean;
  matchAnchorWidth: boolean;
  closeOnEscape: boolean;
  closeOnOutsidePress: boolean;
  onOpenChange: (open: boolean) => void;
}

function referenceElementOf(reference: FloatingReference | null): Element | null {
  if (!reference) return null;
  if (reference instanceof Element) return reference;
  return reference.contextElement ?? null;
}

function PopoverContent({
  id,
  role,
  getReference,
  referenceKey,
  placement,
  offset,
  initialFocus,
  returnFocus,
  matchAnchorWidth,
  closeOnEscape,
  closeOnOutsidePress,
  onOpenChange,
  className,
  children,
  onKeyDown,
  ref,
  ...rest
}: PopoverContentProps) {
  const container = usePortalContainer();
  const [floating, setFloating] = useState<HTMLDivElement | null>(null);
  const floatingRef = useMergedRefs<HTMLDivElement>(ref, setFloating);
  // Captured during render: `autoFocus` children move focus before effects run.
  const [focusedBefore] = useState(getActiveElement);

  const onOpenChangeRef = useLatest(onOpenChange);
  const getReferenceRef = useLatest(getReference);
  const settings = useLatest({ initialFocus, returnFocus, closeOnEscape });

  const layer = useLayer(floating, (event) => {
    if (!settings.current.closeOnEscape) return;
    event.preventDefault();
    onOpenChangeRef.current(false);
  });

  useFloatingPosition({
    getReference,
    referenceKey,
    floating,
    placement,
    offset,
    matchWidth: matchAnchorWidth,
  });

  // Move focus in on open, and hand it back on close.
  useIsomorphicLayoutEffect(() => {
    if (!floating) return;
    const target = settings.current.initialFocus;
    if (target !== 'none' && !floating.contains(document.activeElement)) {
      if (typeof target === 'object') {
        focusElement(target.current ?? floating);
      } else if (target === 'container') {
        focusElement(floating);
      } else {
        focusElement(getTabbable(floating)[0] ?? floating);
      }
    }
    return () => {
      if (!settings.current.returnFocus) return;
      const active = document.activeElement;
      // Only take focus back if it would otherwise be lost with the popover.
      if (active && active !== document.body && !floating.contains(active)) return;
      const reference = referenceElementOf(getReferenceRef.current());
      const target = reference instanceof HTMLElement ? reference : focusedBefore;
      if (target?.isConnected) focusElement(target);
    };
  }, [floating, focusedBefore, settings, getReferenceRef]);

  useEffect(() => {
    if (!closeOnOutsidePress) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layerContains(layer, target)) return;
      // A press on the anchor is left to the anchor's own toggle.
      if (referenceElementOf(getReferenceRef.current())?.contains(target)) return;
      onOpenChangeRef.current(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [closeOnOutsidePress, layer, getReferenceRef, onOpenChangeRef]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Tab' || !floating) return;
    // React also delivers events from overlays portalled out of this one.
    if (!(event.target instanceof Node) || !floating.contains(event.target)) return;
    const tabbable = getTabbable(floating);
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    const active = document.activeElement;
    const leavingBackward = event.shiftKey && (active === first || active === floating);
    const leavingForward = !event.shiftKey && active === last;
    if (tabbable.length === 0 || leavingBackward || leavingForward) {
      // The popover sits at the end of the document, so let Tab close it and
      // continue from the anchor instead of jumping to the browser chrome.
      event.preventDefault();
      onOpenChange(false);
    }
  };

  if (!container) return null;
  return createPortal(
    <LayerContext value={layer}>
      <div
        {...rest}
        ref={floatingRef}
        id={id}
        role={role === 'none' ? undefined : role}
        tabIndex={-1}
        className={cx('rd-popover', className)}
        data-theme={nestedThemeOf(referenceElementOf(getReference()))}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </LayerContext>,
    container,
  );
}
