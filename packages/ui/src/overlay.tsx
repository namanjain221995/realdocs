import {
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  focusElement,
  type FocusTarget,
  getActiveElement,
  getTabbable,
  resolveFocusTarget,
  trapTabKey,
} from './internal/focus';
import { useIsomorphicLayoutEffect, useLatest } from './internal/hooks';
import {
  isTopLayer,
  isTopModal,
  LayerContext,
  layerContains,
  type LayerNode,
  lockScroll,
  PortalContext,
  pushModal,
  useLayer,
} from './internal/layers';

/**
 * The building blocks of the kit's own overlays, for an overlay the kit does
 * not ship (a docked side panel, a command palette). An overlay built with
 * them joins the same layer stack as `Dialog`, `Popover`, `DropdownMenu` and
 * `Sheet`: Escape reaches only the top-most layer, focus traps hand over to
 * whichever opened last, and scroll locks are counted together.
 *
 * Call the hooks from a component that is mounted while the overlay is open,
 * or switch them with `enabled`.
 */

/** One open overlay in the layer stack. Returned by `useOverlayLayer`. */
export interface OverlayLayer {
  /** The overlay's element, or null before it is in the DOM. */
  readonly element: HTMLElement | null;
  /**
   * True when the node is inside this overlay or inside an overlay opened
   * from it, wherever that one is portalled to.
   */
  contains: (target: Node | null | undefined) => boolean;
  /** True while no other open overlay is above this one. */
  isTopMost: () => boolean;
}

export interface OverlayLayerOptions {
  /**
   * Called when Escape is pressed while this overlay is the top-most one. The
   * key is marked as handled (`event.preventDefault()`) for you. Return
   * `false` to decline it; it is then offered to the overlay below. Without
   * `onEscape` the overlay takes no part in Escape handling.
   */
  onEscape?: (event: KeyboardEvent) => void | boolean;
  /** Take part in the stack only while true. Defaults to true. */
  enabled?: boolean;
}

const layerNodes = new WeakMap<OverlayLayer, LayerNode>();

/**
 * Registers an open overlay in the kit's layer stack. Pass the overlay's root
 * element from state (`const [element, setElement] = useState(null)` with
 * `ref={setElement}`), so the hooks re-run when it appears.
 */
export function useOverlayLayer(
  element: HTMLElement | null,
  options: OverlayLayerOptions = {},
): OverlayLayer {
  const { onEscape, enabled = true } = options;
  const onEscapeRef = useLatest(onEscape);

  const node = useLayer(
    element,
    (event) => {
      const handler = onEscapeRef.current;
      if (!handler || handler(event) === false) return false;
      event.preventDefault();
      return true;
    },
    enabled,
  );

  return useMemo(() => {
    const layer: OverlayLayer = {
      element,
      contains: (target) => target !== null && target !== undefined && layerContains(node, target),
      isTopMost: () => isTopLayer(node),
    };
    layerNodes.set(layer, node);
    return layer;
  }, [node, element]);
}

export interface OverlayProviderProps {
  /** The layer returned by `useOverlayLayer`. */
  layer: OverlayLayer;
  /**
   * Where kit popovers, menus and tooltips opened inside the overlay are
   * portalled, so they stack above it. Use an element that covers the
   * viewport and is not transformed or clipped: the fixed wrapper around
   * backdrop and panel, not the panel itself. Leave it out when the overlay
   * sits below `--rd-z-dropdown`; they then portal to `document.body` as usual.
   */
  container?: HTMLElement | null;
  children?: ReactNode;
}

/**
 * Wrap the overlay's content in this. Kit overlays opened from inside then
 * count as part of it: they are above it for Escape, and a press or focus
 * inside them is not "outside" it.
 */
export function OverlayProvider({ layer, container, children }: OverlayProviderProps) {
  const inherited = useContext(PortalContext);
  // Both providers always render, so the content keeps its state when
  // `container` arrives after the first render.
  return (
    <PortalContext value={container ?? inherited}>
      <LayerContext value={layerNodes.get(layer) ?? null}>{children}</LayerContext>
    </PortalContext>
  );
}

export interface FocusTrapOptions {
  /** Trap only while true, for an overlay that is modal in some layouts. Defaults to true. */
  enabled?: boolean;
}

/**
 * Keeps Tab and Shift+Tab inside the overlay while it is the top-most trap:
 * the keys wrap at either end, and focus that ended up on the page behind is
 * pulled back in. A dialog or sheet opened from inside takes the trap over
 * until it closes. Give the overlay `tabIndex={-1}`, so it can hold focus
 * itself when it has no controls.
 */
export function useFocusTrap(layer: OverlayLayer, options: FocusTrapOptions = {}): void {
  const { enabled = true } = options;
  const element = layer.element;
  const [trapId] = useState(() => Symbol('rd-focus-trap'));

  useEffect(() => {
    if (!enabled || !element) return;
    const release = pushModal(trapId);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTopModal(trapId)) return;
      // A popover opened from inside may be portalled outside `element`; it
      // manages Tab itself and hands focus back when it closes.
      trapTabKey(event, element, element, (active) => layer.contains(active));
    };
    // Bubble phase, so handlers inside the overlay see the key first.
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      release();
    };
  }, [enabled, element, trapId, layer]);
}

/**
 * Where focus goes when an overlay opens: its first control (`first`, the
 * default; an element marked `data-autofocus` wins), the overlay itself
 * (`container`), nowhere (`none`), or a `FocusTarget` (a ref, or a function
 * that returns the element).
 */
export type OverlayFocusTarget = 'first' | 'container' | 'none' | FocusTarget;

export interface OverlayFocusOptions {
  /** Defaults to `first`. */
  initialFocus?: OverlayFocusTarget;
  /**
   * When the overlay closes, give focus back to the element that had it
   * before, unless the user has already moved it elsewhere. Defaults to true.
   */
  returnFocus?: boolean;
  /** Manage focus only while true. Defaults to true. */
  enabled?: boolean;
}

function initialFocusElement(target: OverlayFocusTarget, element: HTMLElement): HTMLElement | null {
  if (target === 'none') return null;
  if (target === 'container') return element;
  const requested = target === 'first' ? null : resolveFocusTarget(target);
  return (
    requested ??
    element.querySelector<HTMLElement>('[data-autofocus]') ??
    getTabbable(element)[0] ??
    element
  );
}

/**
 * Moves focus into the overlay when it opens and hands it back when it
 * closes. Give the overlay `tabIndex={-1}` so it can take focus itself.
 */
export function useOverlayFocus(layer: OverlayLayer, options: OverlayFocusOptions = {}): void {
  const { initialFocus = 'first', returnFocus = true, enabled = true } = options;
  const element = layer.element;
  const settings = useLatest({ initialFocus, returnFocus, layer });

  // Noted while rendering, on the first render that is enabled: `autoFocus`
  // children take focus before any effect runs, and by then it is too late.
  const focusedBefore = useRef<HTMLElement | null | undefined>(undefined);
  if (!enabled) focusedBefore.current = undefined;
  else if (focusedBefore.current === undefined) focusedBefore.current = getActiveElement();

  useIsomorphicLayoutEffect(() => {
    if (!enabled || !element) return;
    const before = focusedBefore.current ?? null;
    const active = getActiveElement();
    const focusedAtOpen = active && !element.contains(active) ? active : null;
    if (!active || !element.contains(active)) {
      focusElement(initialFocusElement(settings.current.initialFocus, element));
    }
    return () => {
      if (!settings.current.returnFocus) return;
      // Take focus back only if it would otherwise be lost with the overlay.
      const current = getActiveElement();
      if (current && !settings.current.layer.contains(current)) return;
      // The element focused before may be gone (a menu item that opened us).
      focusElement([before, focusedAtOpen].find((candidate) => candidate?.isConnected));
    };
  }, [enabled, element, settings]);
}

/**
 * Stops the page behind a modal overlay from scrolling. Locks are counted
 * together with the kit's dialogs, so the page scrolls again only when the
 * last one is released.
 */
export function useScrollLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return lockScroll();
  }, [enabled]);
}

export interface OutsidePressOptions {
  /** Listen only while true. Defaults to true. */
  enabled?: boolean;
  /**
   * Elements that do not count as outside, such as the button that toggles
   * the overlay (otherwise its own click would reopen what the press closed).
   */
  ignore?: ReadonlyArray<Element | RefObject<Element | null> | null | undefined>;
}

function isRefObject(value: unknown): value is RefObject<Element | null> {
  return typeof value === 'object' && value !== null && 'current' in value;
}

/**
 * Calls `onOutsidePress` for a pointer press that lands outside the overlay.
 * Overlays opened from inside it count as inside, wherever they are portalled.
 */
export function useOutsidePress(
  layer: OverlayLayer,
  onOutsidePress: (event: PointerEvent) => void,
  options: OutsidePressOptions = {},
): void {
  const { enabled = true, ignore } = options;
  const latest = useLatest({ onOutsidePress, ignore });

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || layer.contains(target)) return;
      for (const entry of latest.current.ignore ?? []) {
        const ignored = isRefObject(entry) ? entry.current : entry;
        if (ignored?.contains(target)) return;
      }
      latest.current.onOutsidePress(event);
    };
    // Capture phase, so a handler that stops propagation cannot hide the press.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [enabled, layer, latest]);
}
