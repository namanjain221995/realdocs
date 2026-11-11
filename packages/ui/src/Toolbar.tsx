import {
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { getFocusable, usesArrowKeys } from './internal/focus';
import { useIsomorphicLayoutEffect, useMergedRefs } from './internal/hooks';
import { useScrollFade } from './internal/scroll-fade';
import { ToolbarContext } from './internal/toolbar-context';
import { cx } from './utils';

export type ToolbarProps = ComponentProps<'div'>;

/**
 * The controls the arrow keys walk through. Text inputs and sliders need the
 * arrows themselves, so they stay ordinary tab stops.
 */
function toolbarItems(root: HTMLElement): HTMLElement[] {
  return getFocusable(root).filter((element) => !usesArrowKeys(element));
}

/**
 * A row of controls that is one tab stop: Left/Right move between controls,
 * Home/End jump to the ends. When the row is wider than its container it
 * scrolls sideways inside itself, with faded edges, instead of widening the page.
 */
export function Toolbar({ className, children, onKeyDown, onFocus, ref, ...rest }: ToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, rootRef);
  const activeItem = useRef<HTMLElement | null>(null);
  const managedItems = useRef(new Set<HTMLElement>());
  const { fade, sync: syncFade } = useScrollFade(scrollRef);

  /** Keeps exactly one control in the Tab order. */
  const syncTabStops = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = toolbarItems(root);
    let active = activeItem.current;
    if (!active || !items.includes(active)) {
      active = items.find((item) => item.getAttribute('tabindex') === '0') ?? items[0] ?? null;
      activeItem.current = active;
    }
    for (const item of items) {
      const wanted = item === active ? '0' : '-1';
      if (item.getAttribute('tabindex') !== wanted) item.setAttribute('tabindex', wanted);
    }
    // A control that dropped out (disabled, hidden) must not keep the tab stop
    // it held, or it would become a second one when it returns.
    const current = new Set(items);
    for (const item of managedItems.current) {
      if (!current.has(item) && item.isConnected) item.setAttribute('tabindex', '-1');
    }
    managedItems.current = current;
  }, []);

  // After every render: children may have been added, removed or disabled.
  useIsomorphicLayoutEffect(() => {
    syncTabStops();
  });

  // Catches changes made below us without a re-render of the toolbar itself.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver !== 'function') return;
    const mutations = new MutationObserver(() => {
      syncTabStops();
      syncFade();
    });
    mutations.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert'],
    });
    return () => mutations.disconnect();
  }, [syncTabStops, syncFade]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    const root = rootRef.current;
    if (event.defaultPrevented || !root) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    // Ignore keys from menus and popovers that were opened from a control here.
    if (!(target instanceof HTMLElement) || !root.contains(target)) return;
    if (usesArrowKeys(target)) return;

    const rtl = getComputedStyle(root).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (![forward, backward, 'Home', 'End'].includes(event.key)) return;

    const items = toolbarItems(root);
    const current = items.findIndex((item) => item === target || item.contains(target));
    if (current === -1 || items.length === 0) return;
    let next: number;
    if (event.key === forward) next = (current + 1) % items.length;
    else if (event.key === backward) next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else next = items.length - 1;

    event.preventDefault();
    const item = items[next];
    if (!item) return;
    activeItem.current = item;
    syncTabStops();
    // Focusing scrolls the control into view inside the toolbar.
    item.focus();
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>): void => {
    onFocus?.(event);
    const root = rootRef.current;
    const target = event.target;
    if (!root || !(target instanceof HTMLElement) || !root.contains(target)) return;
    // The control used last (by click or key) is where Tab returns to.
    if (toolbarItems(root).includes(target)) {
      activeItem.current = target;
      syncTabStops();
    }
  };

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      {...rest}
      ref={mergedRef}
      className={cx('rd-toolbar', className)}
      data-fade-start={fade.start ? '' : undefined}
      data-fade-end={fade.end ? '' : undefined}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
    >
      <div ref={scrollRef} className="rd-toolbar__scroll">
        <ToolbarContext value={true}>{children}</ToolbarContext>
      </div>
    </div>
  );
}

/** Related controls inside a toolbar. Give it an `aria-label`. */
export function ToolbarGroup({ className, ...rest }: ComponentProps<'div'>) {
  return <div role="group" {...rest} className={cx('rd-toolbar__group', className)} />;
}

export function ToolbarSeparator({ className, ...rest }: Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      {...rest}
      className={cx('rd-toolbar__separator', className)}
    />
  );
}
