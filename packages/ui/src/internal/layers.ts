import { createContext, useContext, useEffect, useState } from 'react';
import { useIsomorphicLayoutEffect, useLatest } from './hooks';

/* ---------------------------------------------------------------- portals */

/**
 * Where floating content is portalled. A dialog provides its own layer element
 * so popovers, menus and tooltips opened inside it stack above it and stay
 * inside its focus scope. Outside a dialog the container is `document.body`.
 */
export const PortalContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  const fromContext = useContext(PortalContext);
  if (fromContext) return fromContext;
  return typeof document === 'undefined' ? null : document.body;
}

/**
 * Theme of the nearest themed ancestor when it is not the document root, so
 * portalled content matches a subtree that sets its own `data-theme`.
 */
export function nestedThemeOf(element: Element | null | undefined): string | undefined {
  if (!element || typeof document === 'undefined') return undefined;
  const themed = element.closest('[data-theme]');
  if (!themed || themed === document.documentElement) return undefined;
  return themed.getAttribute('data-theme') ?? undefined;
}

/* ----------------------------------------------------------------- layers */

/** One open overlay (popover, menu or dialog) in the React tree of overlays. */
export interface LayerNode {
  readonly depth: number;
  readonly parent: LayerNode | null;
  readonly children: Set<LayerNode>;
  element: HTMLElement | null;
}

export const LayerContext = createContext<LayerNode | null>(null);

/** True when the target is inside this layer or any overlay opened from it. */
export function layerContains(node: LayerNode, target: Node): boolean {
  if (node.element?.contains(target)) return true;
  for (const child of node.children) {
    if (layerContains(child, target)) return true;
  }
  return false;
}

/**
 * What a layer does with Escape. Returning `false` declines the key, which is
 * then offered to the layer below; anything else ends the search.
 */
export type EscapeHandler = (event: KeyboardEvent) => void | boolean;

interface EscapeEntry {
  readonly node: LayerNode;
  readonly handle: EscapeHandler;
}

const escapeEntries: EscapeEntry[] = [];

/** Open layers, top-most first: deeper layers win, then the most recently opened. */
function escapeOrder(): EscapeEntry[] {
  return escapeEntries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.node.depth - a.entry.node.depth || b.index - a.index)
    .map(({ entry }) => entry);
}

/** True while no other open layer is above this one. */
export function isTopLayer(node: LayerNode): boolean {
  return escapeOrder()[0]?.node === node;
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // Escape during IME composition cancels the composition, not the overlay.
  if (event.isComposing || event.keyCode === 229) return;
  for (const entry of escapeOrder()) {
    if (entry.handle(event) !== false) return;
  }
}

function addEscapeEntry(entry: EscapeEntry): () => void {
  if (escapeEntries.length === 0) document.addEventListener('keydown', onDocumentKeyDown);
  escapeEntries.push(entry);
  return () => {
    const index = escapeEntries.indexOf(entry);
    if (index !== -1) escapeEntries.splice(index, 1);
    if (escapeEntries.length === 0) document.removeEventListener('keydown', onDocumentKeyDown);
  };
}

/**
 * Registers an open overlay. Only the top-most overlay receives Escape, and an
 * overlay opened from inside another counts as part of its parent for
 * outside-press detection. With `enabled` false the overlay stays out of both.
 */
export function useLayer(
  element: HTMLElement | null,
  onEscape: EscapeHandler,
  enabled = true,
): LayerNode {
  const parent = useContext(LayerContext);
  const [node] = useState<LayerNode>(() => ({
    depth: (parent?.depth ?? 0) + 1,
    parent,
    children: new Set(),
    element: null,
  }));
  const onEscapeRef = useLatest(onEscape);

  useIsomorphicLayoutEffect(() => {
    node.element = element;
  }, [node, element]);

  useEffect(() => {
    if (!enabled) return;
    node.parent?.children.add(node);
    const remove = addEscapeEntry({ node, handle: (event) => onEscapeRef.current(event) });
    return () => {
      remove();
      node.parent?.children.delete(node);
    };
  }, [node, onEscapeRef, enabled]);

  return node;
}

/* ----------------------------------------------------------------- modals */

const modalStack: symbol[] = [];

/** Marks a modal as open; returns the release function. */
export function pushModal(id: symbol): () => void {
  modalStack.push(id);
  return () => {
    const index = modalStack.indexOf(id);
    if (index !== -1) modalStack.splice(index, 1);
  };
}

export function isTopModal(id: symbol): boolean {
  return modalStack[modalStack.length - 1] === id;
}

/* ------------------------------------------------------------ scroll lock */

let scrollLocks = 0;
let restoreScroll: (() => void) | null = null;

/** Stops the page behind a modal from scrolling. Calls nest; returns the unlock. */
export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (scrollLocks === 0) {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    // Keep the layout from shifting when a classic scrollbar disappears.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0 && document.documentElement.clientWidth > 0) {
      const currentPadding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    body.style.overflow = 'hidden';
    restoreScroll = () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0) {
      restoreScroll?.();
      restoreScroll = null;
    }
  };
}
