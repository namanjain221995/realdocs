import { Check } from 'lucide-react';
import {
  cloneElement,
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { focusElement } from './internal/focus';
import { useControllableState, useIsomorphicLayoutEffect, useMergedRefs } from './internal/hooks';
import { Popover, type PopoverPlacement } from './Popover';
import { cx } from './utils';

interface MenuContextValue {
  /** Closes the surrounding dropdown, if there is one. */
  close: (() => void) | undefined;
}

const MenuContext = createContext<MenuContextValue>({ close: undefined });

export type MenuInitialFocus = 'first' | 'last' | 'menu' | 'none';

export interface MenuProps extends ComponentProps<'div'> {
  /** Called when an item is chosen or Tab is pressed, so a host can close. */
  onClose?: () => void;
  /** Where focus goes when the menu mounts. Defaults to `none`. */
  initialFocus?: MenuInitialFocus;
}

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"]';
const TYPEAHEAD_RESET_MS = 600;

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (item) => item.getAttribute('aria-disabled') !== 'true',
  );
}

/**
 * A list of actions with roving focus: Up/Down move, Home/End jump, typing a
 * letter jumps to the next matching item, Enter or Space runs the item.
 */
export function Menu({
  onClose,
  initialFocus = 'none',
  className,
  children,
  onKeyDown,
  onFocus,
  ref,
  ...rest
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, menuRef);
  const typeahead = useRef({ buffer: '', at: 0 });
  const context = useMemo<MenuContextValue>(() => ({ close: onClose }), [onClose]);
  // Focus moves once, when the menu appears; later prop changes must not move it.
  const [focusOnMount] = useState(initialFocus);

  // Exactly one enabled item is in the Tab order, so the menu is a single tab
  // stop. Runs after every render because items come and go with the children.
  useIsomorphicLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const enabled = enabledItems(menu);
    const tabStop = enabled.find((item) => item.tabIndex === 0) ?? enabled[0];
    for (const item of menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
      const wanted = item === tabStop ? 0 : -1;
      if (item.tabIndex !== wanted) item.tabIndex = wanted;
    }
  });

  useIsomorphicLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || focusOnMount === 'none') return;
    const items = enabledItems(menu);
    if (focusOnMount === 'first') focusElement(items[0] ?? menu);
    else if (focusOnMount === 'last') focusElement(items[items.length - 1] ?? menu);
    else focusElement(menu);
  }, [focusOnMount]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    const menu = menuRef.current;
    if (event.defaultPrevented || !menu) return;
    // Ignore keys from overlays that were opened from an item.
    if (!(event.target instanceof Node) || !menu.contains(event.target)) return;

    const items = enabledItems(menu);
    const current = items.findIndex((item) => item === document.activeElement);
    const last = items.length - 1;

    const focusAt = (index: number): void => {
      const item = items[index];
      if (!item) return;
      event.preventDefault();
      focusElement(item);
      item.scrollIntoView?.({ block: 'nearest' });
    };

    switch (event.key) {
      case 'ArrowDown':
        focusAt(current === -1 || current === last ? 0 : current + 1);
        return;
      case 'ArrowUp':
        focusAt(current <= 0 ? last : current - 1);
        return;
      case 'Home':
      case 'PageUp':
        focusAt(0);
        return;
      case 'End':
      case 'PageDown':
        focusAt(last);
        return;
      case 'Tab':
        if (onClose) {
          // Tab leaves the menu and hands focus back to whatever opened it.
          event.preventDefault();
          onClose();
        }
        return;
      case ' ': {
        // Anchors do not activate on Space the way buttons do.
        const active = document.activeElement;
        if (active instanceof HTMLAnchorElement && menu.contains(active)) {
          event.preventDefault();
          active.click();
        }
        return;
      }
      default:
        break;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const now = Date.now();
    const state = typeahead.current;
    state.buffer = now - state.at > TYPEAHEAD_RESET_MS ? event.key : state.buffer + event.key;
    state.at = now;
    const query = state.buffer.toLocaleLowerCase();
    // A single letter cycles through the matches; a longer query refines the current one.
    const start = query.length === 1 ? current + 1 : Math.max(current, 0);
    for (let step = 0; step < items.length; step += 1) {
      const index = (start + step) % items.length;
      const text = (items[index]?.textContent ?? '').trim().toLocaleLowerCase();
      if (text.startsWith(query)) {
        focusAt(index);
        return;
      }
    }
  };

  return (
    <MenuContext value={context}>
      <div
        role="menu"
        tabIndex={-1}
        {...rest}
        ref={mergedRef}
        className={cx('rd-menu', className)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          onFocus?.(event);
          const menu = menuRef.current;
          const target = event.target;
          if (!menu || !(target instanceof HTMLElement) || !menu.contains(target)) return;
          if (!target.matches(ITEM_SELECTOR)) return;
          // The item that was focused last becomes the menu's tab stop.
          for (const item of menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
            item.tabIndex = item === target ? 0 : -1;
          }
        }}
      >
        {children}
      </div>
    </MenuContext>
  );
}

interface MenuItemOwnProps {
  icon?: ReactNode;
  /** A key hint shown at the end, for example `Ctrl+D`. */
  shortcut?: ReactNode;
  /** Marks a destructive action. */
  danger?: boolean;
  disabled?: boolean;
  /** When set, the item is a checkable option and shows a tick while true. */
  checked?: boolean;
  /** Runs when the item is chosen by click, Enter or Space. */
  onSelect?: () => void;
  /** Close the surrounding dropdown after choosing. Defaults to true. */
  closeOnSelect?: boolean;
}

/** A menu item that runs an action. Renders a `<button>`. */
export interface MenuItemButtonProps
  extends Omit<ComponentProps<'button'>, 'onSelect'>, MenuItemOwnProps {
  href?: undefined;
  /** Link attributes need `href`. */
  target?: undefined;
  rel?: undefined;
  download?: undefined;
}

/**
 * A menu item that navigates or downloads. Renders an `<a>`, so `ref`, event
 * handlers and attributes such as `target` and `download` are the anchor's.
 */
export interface MenuItemLinkProps
  extends Omit<ComponentProps<'a'>, 'onSelect' | 'href'>, MenuItemOwnProps {
  /** Makes the item a link. */
  href: string;
}

/** Discriminated by `href`: with it the item is a link, without it a button. */
export type MenuItemProps = MenuItemButtonProps | MenuItemLinkProps;

interface MenuItemBehaviour<E extends HTMLElement> extends MenuItemOwnProps {
  className: string | undefined;
  /** A link navigates even when its own click handler has prevented the default. */
  link: boolean;
  onClick: MouseEventHandler<E> | undefined;
  onPointerMove: PointerEventHandler<E> | undefined;
  onPointerLeave: PointerEventHandler<E> | undefined;
}

/** Role, state and handlers shared by both shapes of a menu item. */
function useMenuItem<E extends HTMLElement>({
  danger = false,
  disabled = false,
  checked,
  onSelect,
  closeOnSelect = true,
  className,
  link,
  onClick,
  onPointerMove,
  onPointerLeave,
}: MenuItemBehaviour<E>) {
  const menu = useContext(MenuContext);
  const checkable = checked !== undefined;
  return {
    role: checkable ? 'menuitemcheckbox' : 'menuitem',
    'aria-checked': checkable ? checked : undefined,
    'aria-disabled': disabled || undefined,
    'data-danger': danger ? '' : undefined,
    tabIndex: -1,
    className: cx('rd-menu__item', className),
    onClick: (event: MouseEvent<E>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
      if (event.defaultPrevented && !link) return;
      onSelect?.();
      if (closeOnSelect) menu.close?.();
    },
    // Hover and keyboard share one highlight: the pointer moves focus.
    onPointerMove: (event: PointerEvent<E>) => {
      onPointerMove?.(event);
      if (disabled || event.pointerType !== 'mouse') return;
      if (document.activeElement !== event.currentTarget) focusElement(event.currentTarget);
    },
    onPointerLeave: (event: PointerEvent<E>) => {
      onPointerLeave?.(event);
      if (event.pointerType !== 'mouse') return;
      if (document.activeElement === event.currentTarget) {
        focusElement(event.currentTarget.closest<HTMLElement>('[role="menu"]'));
      }
    },
  } as const;
}

function MenuItemContent({
  icon,
  shortcut,
  checked,
  children,
}: Pick<MenuItemOwnProps, 'icon' | 'shortcut' | 'checked'> & { children: ReactNode }) {
  return (
    <>
      {checked !== undefined ? (
        <span className="rd-menu__lead" aria-hidden="true">
          {checked ? <Check /> : null}
        </span>
      ) : null}
      {icon ? (
        <span className="rd-menu__lead" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="rd-menu__text">{children}</span>
      {shortcut ? <span className="rd-menu__shortcut">{shortcut}</span> : null}
    </>
  );
}

function MenuItemButton({
  icon,
  shortcut,
  danger,
  disabled,
  checked,
  onSelect,
  closeOnSelect,
  className,
  children,
  onClick,
  onPointerMove,
  onPointerLeave,
  href: _href,
  target: _target,
  rel: _rel,
  download: _download,
  ...rest
}: MenuItemButtonProps) {
  const shared = useMenuItem<HTMLButtonElement>({
    danger,
    disabled,
    checked,
    onSelect,
    closeOnSelect,
    className,
    link: false,
    onClick,
    onPointerMove,
    onPointerLeave,
  });
  return (
    <button {...rest} {...shared} type="button">
      <MenuItemContent icon={icon} shortcut={shortcut} checked={checked}>
        {children}
      </MenuItemContent>
    </button>
  );
}

function MenuItemLink({
  icon,
  shortcut,
  danger,
  disabled,
  checked,
  onSelect,
  closeOnSelect,
  className,
  children,
  onClick,
  onPointerMove,
  onPointerLeave,
  href,
  target,
  rel,
  ...rest
}: MenuItemLinkProps) {
  const shared = useMenuItem<HTMLAnchorElement>({
    danger,
    disabled,
    checked,
    onSelect,
    closeOnSelect,
    className,
    link: true,
    onClick,
    onPointerMove,
    onPointerLeave,
  });
  return (
    <a
      {...rest}
      {...shared}
      // A disabled link has nowhere to go.
      href={disabled ? undefined : href}
      target={target}
      rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
    >
      <MenuItemContent icon={icon} shortcut={shortcut} checked={checked}>
        {children}
      </MenuItemContent>
    </a>
  );
}

/**
 * One action in a menu. Give it `href` to make it a link (`<a>`) for
 * navigation and downloads; without `href` it is a `<button>`. Props, event
 * handlers and `ref` are typed for the element that is rendered.
 */
export function MenuItem(props: MenuItemProps) {
  return props.href === undefined ? <MenuItemButton {...props} /> : <MenuItemLink {...props} />;
}

export function MenuSeparator({ className, ...rest }: ComponentProps<'div'>) {
  return <div role="separator" {...rest} className={cx('rd-menu__separator', className)} />;
}

/** A heading for the group of items that follows. */
export function MenuLabel({ className, ...rest }: ComponentProps<'div'>) {
  return <div {...rest} className={cx('rd-menu__label', className)} />;
}

export interface DropdownMenuProps extends Omit<MenuProps, 'onClose' | 'initialFocus'> {
  /** The button that opens the menu. It must forward `ref`, click and key handlers. */
  trigger: ReactElement;
  /** `MenuItem`, `MenuSeparator` and `MenuLabel` elements. */
  children: ReactNode;
  /** Defaults to `bottom-start`. */
  placement?: PopoverPlacement;
  /** Controlled open state. Leave undefined to let the menu manage it. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DropdownTriggerProps {
  ref?: Ref<HTMLElement>;
  id?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

/** A button that opens a `Menu` in a popover, wired for keyboard and screen readers. */
export function DropdownMenu({
  trigger,
  children,
  placement = 'bottom-start',
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  id: idProp,
  ...menuProps
}: DropdownMenuProps) {
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange);
  const [focusOnOpen, setFocusOnOpen] = useState<MenuInitialFocus>('menu');
  const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);
  const typedTrigger = trigger as ReactElement<DropdownTriggerProps>;
  const triggerProps = typedTrigger.props;
  const triggerRef = useMergedRefs<HTMLElement>(triggerProps.ref, setTriggerElement);
  const generatedId = useId();
  const menuId = idProp ?? `rd-menu-${generatedId}`;
  const triggerId = triggerProps.id ?? `rd-menu-trigger-${generatedId}`;

  const openWith = (focus: MenuInitialFocus): void => {
    setFocusOnOpen(focus);
    setOpen(true);
  };

  return (
    <>
      {cloneElement(typedTrigger, {
        ref: triggerRef,
        id: triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onClick: (event: MouseEvent<HTMLElement>) => {
          triggerProps.onClick?.(event);
          if (event.defaultPrevented) return;
          if (open) setOpen(false);
          // `detail` is 0 for a click made with Enter or Space.
          else openWith(event.detail === 0 ? 'first' : 'menu');
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          triggerProps.onKeyDown?.(event);
          if (event.defaultPrevented || open) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openWith(event.key === 'ArrowDown' ? 'first' : 'last');
          }
        },
      } as Partial<DropdownTriggerProps>)}
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={triggerElement}
        placement={placement}
        role="none"
        initialFocus="none"
        className="rd-popover--menu"
      >
        <Menu
          aria-labelledby={triggerId}
          {...menuProps}
          id={menuId}
          initialFocus={focusOnOpen}
          onClose={() => setOpen(false)}
        >
          {children}
        </Menu>
      </Popover>
    </>
  );
}
