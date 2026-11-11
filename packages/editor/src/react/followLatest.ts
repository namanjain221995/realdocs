/**
 * Follow Latest and scroll stability.
 *
 * - Follow Latest (optional, off by default): after a remote change, scroll
 *   smoothly so the change is visible. It never moves focus or the selection.
 *   It pauses as soon as the reader scrolls on their own or selects text and
 *   then only reports that newer changes exist ("Jump to latest").
 * - Scroll stability: a remote edit above the viewport must not move what the
 *   reader is looking at. Browsers with CSS scroll anchoring do this natively;
 *   where it is missing, the first visible block is measured before and after
 *   the remote transaction and the scroll offset is corrected.
 */
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getRemoteChange } from '../editor/collabPlugins';

/**
 * A scroll event this soon after wheel, touch, a scrolling key or a press on
 * the scrollbar is the reader's own. Scroll events without such a signal are
 * ours (automatic reveal) or the browser's (scroll anchoring) and never pause.
 */
const USER_INTENT_WINDOW_MS = 300;

/** Keys that scroll the document wherever the focus is. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isDocumentScroller(scroller: HTMLElement): boolean {
  const doc = scroller.ownerDocument;
  return (
    scroller === doc.scrollingElement || scroller === doc.documentElement || scroller === doc.body
  );
}

function viewportOf(scroller: HTMLElement): { top: number; bottom: number; height: number } {
  if (isDocumentScroller(scroller)) {
    const height = scroller.ownerDocument.defaultView?.innerHeight ?? 0;
    return { top: 0, bottom: height, height };
  }
  const rect = scroller.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, height: rect.height };
}

function scrollByAmount(scroller: HTMLElement, top: number, smooth: boolean): void {
  const target = isDocumentScroller(scroller) ? scroller.ownerDocument.defaultView : scroller;
  target?.scrollBy({ top, behavior: smooth ? 'smooth' : 'auto' });
}

/** Brings a document position into view. Returns true if it scrolled. */
function revealPosition(editor: Editor, scroller: HTMLElement, position: number): boolean {
  let coords: { top: number; bottom: number };
  try {
    coords = editor.view.coordsAtPos(Math.min(position, editor.state.doc.content.size));
  } catch {
    return false;
  }
  const viewport = viewportOf(scroller);
  const margin = Math.min(96, viewport.height * 0.2);
  if (coords.top >= viewport.top + margin && coords.bottom <= viewport.bottom - margin)
    return false;
  scrollByAmount(
    scroller,
    coords.top - (viewport.top + viewport.height * 0.4),
    !prefersReducedMotion(),
  );
  return true;
}

export interface FollowLatest {
  /** Following is on but suspended because the reader took over. */
  paused: boolean;
  /** Remote changes arrived while paused. */
  hasNew: boolean;
  /** Scrolls to the latest remote change and resumes following. */
  jump: () => void;
}

export function useFollowLatest(
  editor: Editor | null,
  getScroller: () => HTMLElement | null,
  enabled: boolean,
): FollowLatest {
  const [state, setState] = useState({ paused: false, hasNew: false });
  const jumpRef = useRef<() => void>(() => {});

  useEffect(() => {
    setState({ paused: false, hasNew: false });
    jumpRef.current = () => {};
    const scroller = getScroller();
    if (!editor || !enabled || !scroller) return undefined;

    let paused = false;
    let lastVersion = getRemoteChange(editor.state).version;
    let intentUntil = 0;
    let dragging = false;
    let frame: number | null = null;

    const reveal = (): void => {
      frame = null;
      if (editor.isDestroyed || paused) return;
      const { position } = getRemoteChange(editor.state);
      if (position !== null) revealPosition(editor, scroller, position);
    };

    const onTransaction = (): void => {
      const { version } = getRemoteChange(editor.state);
      if (version === lastVersion) return;
      lastVersion = version;
      if (paused) {
        setState((previous) => (previous.hasNew ? previous : { paused: true, hasNew: true }));
      } else if (frame === null) {
        // After layout, so coordinates include the new content.
        frame = requestAnimationFrame(reveal);
      }
    };

    const pause = (): void => {
      if (paused) return;
      paused = true;
      setState({ paused: true, hasNew: false });
    };

    const onIntent = (): void => {
      intentUntil = performance.now() + USER_INTENT_WINDOW_MS;
    };
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      // In a text field the space bar types; elsewhere it pages down.
      if (SCROLL_KEYS.has(event.key) || (event.key === ' ' && !typing)) {
        // Only keys that can reach this scroller count.
        if (!target || target === scroller.ownerDocument.body || scroller.contains(target)) {
          onIntent();
        }
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      // A press on the scroller itself is its scrollbar; the middle button
      // starts auto-scrolling.
      if (event.target === scroller || event.button === 1) {
        dragging = true;
        onIntent();
      }
    };
    const onPointerUp = (): void => {
      if (dragging) onIntent();
      dragging = false;
    };
    const onScroll = (): void => {
      if (dragging || performance.now() <= intentUntil) pause();
    };
    const onSelection = (): void => {
      const selection = scroller.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed || !selection.anchorNode) return;
      if (editor.view.dom.contains(selection.anchorNode)) pause();
    };

    jumpRef.current = () => {
      paused = false;
      setState({ paused: false, hasNew: false });
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };

    const scrollTarget: EventTarget = isDocumentScroller(scroller)
      ? (scroller.ownerDocument.defaultView ?? scroller)
      : scroller;
    const doc = scroller.ownerDocument;
    const view = doc.defaultView;
    editor.on('transaction', onTransaction);
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', onIntent, { passive: true });
    scroller.addEventListener('touchmove', onIntent, { passive: true });
    scroller.addEventListener('pointerdown', onPointerDown, { passive: true });
    view?.addEventListener('pointerup', onPointerUp, { passive: true });
    view?.addEventListener('pointercancel', onPointerUp, { passive: true });
    doc.addEventListener('keydown', onKey, { passive: true });
    doc.addEventListener('selectionchange', onSelection);
    return () => {
      editor.off('transaction', onTransaction);
      scrollTarget.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', onIntent);
      scroller.removeEventListener('touchmove', onIntent);
      scroller.removeEventListener('pointerdown', onPointerDown);
      view?.removeEventListener('pointerup', onPointerUp);
      view?.removeEventListener('pointercancel', onPointerUp);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('selectionchange', onSelection);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor, enabled, getScroller]);

  const jump = useCallback(() => jumpRef.current(), []);
  return { paused: state.paused, hasNew: state.hasNew, jump };
}

/** True when the browser keeps the viewport stable by itself. */
export function hasNativeScrollAnchoring(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('overflow-anchor', 'auto')
  );
}

/** After the user's own edit, the layout it produced is accepted as it is for this long. */
const LOCAL_EDIT_GRACE_MS = 60;
/** The anchor is chosen again this long after the last scroll event. */
const ANCHOR_SETTLE_MS = 150;

/**
 * Manual scroll anchoring, used where CSS scroll anchoring does not exist
 * (`overflow-anchor`; missing in older Safari).
 *
 * The first block that reaches into the viewport is remembered together with
 * its position on screen. Whenever the layout moves it — a remote edit above,
 * a collaborator's caret, an image or diagram that finished loading — the
 * scroll offset is corrected by exactly that distance, before the next paint.
 * The reader's own scrolling moves the remembered position along, and the
 * user's own typing is never corrected.
 */
export function useScrollAnchor(
  editor: Editor | null,
  getScroller: () => HTMLElement | null,
  force = false,
): void {
  useEffect(() => {
    if (!editor || (!force && hasNativeScrollAnchoring())) return undefined;
    const content = editor.view.dom;
    const doc = content.ownerDocument;
    const win = doc.defaultView;
    if (!win || typeof win.ResizeObserver !== 'function') return undefined;

    /** The block being held in place and the screen position it should keep. */
    let anchor: { element: Element; top: number } | null = null;
    let lastOffset = 0;
    let localEditAt = Number.NEGATIVE_INFINITY;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const offsetOf = (scroller: HTMLElement): number =>
      isDocumentScroller(scroller) ? win.scrollY : scroller.scrollTop;

    const pick = (): void => {
      anchor = null;
      const scroller = getScroller();
      if (!scroller) return;
      lastOffset = offsetOf(scroller);
      // At the very top there is nothing above the viewport to protect.
      if (lastOffset <= 0) return;
      const viewport = viewportOf(scroller);
      const blocks = content.children;
      // First block whose bottom edge is below the top of the viewport.
      let low = 0;
      let high = blocks.length - 1;
      let found: Element | null = null;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const block = blocks[middle];
        if (!block) break;
        if (block.getBoundingClientRect().bottom > viewport.top) {
          found = block;
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }
      if (found) anchor = { element: found, top: found.getBoundingClientRect().top };
    };

    const correct = (): void => {
      const scroller = getScroller();
      const current = anchor;
      if (
        !scroller ||
        !current ||
        !current.element.isConnected ||
        win.performance.now() - localEditAt < LOCAL_EDIT_GRACE_MS
      ) {
        pick();
        return;
      }
      // Measured against the position to keep, not against the last
      // measurement: what a rounded scroll offset could not express is still
      // part of the next correction, so nothing adds up over many changes.
      const wanted = current.element.getBoundingClientRect().top - current.top;
      if (Math.abs(wanted) < 0.5) return;
      const start = offsetOf(scroller);
      scrollByAmount(scroller, wanted, false);
      // Our own scrolling: the scroll listener must not count it as the reader's.
      lastOffset = offsetOf(scroller);
      // The end of the scroll range was reached: accept the layout as it is now.
      if (Math.abs(wanted - (lastOffset - start)) >= 1) pick();
    };

    const onScroll = (event: Event): void => {
      const scroller = getScroller();
      if (!scroller) return;
      const target = event.target;
      if (target !== scroller && !(isDocumentScroller(scroller) && target === doc)) return;
      const offset = offsetOf(scroller);
      const moved = offset - lastOffset;
      lastOffset = offset;
      // The reader scrolled: the position to keep moves with the content.
      if (anchor && moved !== 0) anchor.top -= moved;
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        pick();
      }, ANCHOR_SETTLE_MS);
    };

    const before = ({ transaction }: { transaction: Transaction }): void => {
      if (!transaction.docChanged) return;
      const sync = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
      // The user's own edit: the browser and ProseMirror keep the caret in view.
      if (!sync?.isChangeOrigin) localEditAt = win.performance.now();
    };

    // Any change of the document's height, whatever caused it.
    const observer = new win.ResizeObserver(correct);
    observer.observe(content);
    // Scroll events do not bubble; capturing at the document sees every scroller.
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    editor.on('beforeTransaction', before);
    // Right after the DOM update of a transaction, so the correction is never painted late.
    editor.on('transaction', correct);
    pick();
    return () => {
      observer.disconnect();
      doc.removeEventListener('scroll', onScroll, { capture: true });
      editor.off('beforeTransaction', before);
      editor.off('transaction', correct);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [editor, getScroller, force]);
}
