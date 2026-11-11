import { createRef, type MouseEvent, type ReactElement, type Ref } from 'react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  Button,
  ConfirmDialog,
  Dialog,
  type FocusTarget,
  Link,
  MenuItem,
  type MenuItemButtonProps,
  type MenuItemLinkProps,
  type MenuItemProps,
  type OverlayFocusTarget,
  Sheet,
} from '../src/index';

/**
 * Compile-time checks. `tsc` (the `typecheck` script) is what verifies this
 * file: every `@ts-expect-error` must really be an error, and every
 * `expectTypeOf` must hold. At run time the elements are only constructed.
 */

const anchorRef = createRef<HTMLAnchorElement>();
const buttonRef = createRef<HTMLButtonElement>();
/** What a router helper hands out: a handler that works on any element. */
const anyElementClick = (event: MouseEvent<HTMLElement>): void => event.preventDefault();

describe('MenuItem props are discriminated by href', () => {
  it('types a link item for the anchor it renders', () => {
    const elements: ReactElement[] = [
      <MenuItem
        key="handlers"
        href="/settings"
        ref={anchorRef}
        target="_blank"
        rel="noopener"
        download="notes.md"
        hrefLang="en"
        onClick={(event) => {
          const anchor: HTMLAnchorElement = event.currentTarget;
          // @ts-expect-error the element is an anchor, not a button
          const button: HTMLButtonElement = event.currentTarget;
          return [anchor, button];
        }}
        onPointerMove={(event) => {
          const anchor: HTMLAnchorElement = event.currentTarget;
          return anchor;
        }}
        onSelect={() => undefined}
      >
        Settings
      </MenuItem>,
      // A handler written for any element fits both shapes.
      <MenuItem key="router" href="/documents" onClick={anyElementClick} icon={<span />}>
        Documents
      </MenuItem>,
      <MenuItem key="download" href="/export.md" download danger disabled checked={false}>
        Export
      </MenuItem>,
      // @ts-expect-error a button ref does not fit an item that renders an anchor
      <MenuItem key="bad-ref" href="/settings" ref={buttonRef}>
        Settings
      </MenuItem>,
      // @ts-expect-error `formAction` belongs to buttons, not to links
      <MenuItem key="bad-attribute" href="/settings" formAction="/submit">
        Settings
      </MenuItem>,
    ];
    expect(elements).toHaveLength(5);
  });

  it('types a plain item for the button it renders', () => {
    const elements: ReactElement[] = [
      <MenuItem
        key="handlers"
        ref={buttonRef}
        shortcut="F2"
        onClick={(event) => {
          const button: HTMLButtonElement = event.currentTarget;
          // @ts-expect-error the element is a button, not an anchor
          const anchor: HTMLAnchorElement = event.currentTarget;
          return [button, anchor];
        }}
        onSelect={() => undefined}
        closeOnSelect={false}
      >
        Rename
      </MenuItem>,
      <MenuItem key="router" onClick={anyElementClick}>
        Duplicate
      </MenuItem>,
      // @ts-expect-error an anchor ref does not fit an item that renders a button
      <MenuItem key="bad-ref" ref={anchorRef}>
        Rename
      </MenuItem>,
      // @ts-expect-error `target` needs `href`
      <MenuItem key="bad-target" target="_blank">
        Rename
      </MenuItem>,
      // @ts-expect-error `download` needs `href`
      <MenuItem key="bad-download" download>
        Rename
      </MenuItem>,
    ];
    expect(elements).toHaveLength(5);
  });

  it('exposes both shapes and their union', () => {
    expectTypeOf<MenuItemProps>().toEqualTypeOf<MenuItemButtonProps | MenuItemLinkProps>();
    expectTypeOf<MenuItemLinkProps['href']>().toEqualTypeOf<string>();
    expectTypeOf<MenuItemButtonProps['href']>().toEqualTypeOf<undefined>();
    expectTypeOf<MenuItemLinkProps['ref']>().toEqualTypeOf<Ref<HTMLAnchorElement> | undefined>();
    expectTypeOf<MenuItemButtonProps['ref']>().toEqualTypeOf<Ref<HTMLButtonElement> | undefined>();
    // Narrowing on `href` picks the shape.
    const describe = (props: MenuItemProps): string =>
      props.href === undefined ? (props.formAction ? 'form' : 'button') : (props.target ?? 'link');
    expect(describe({ href: '/x', target: '_blank' })).toBe('_blank');
    expect(describe({})).toBe('button');
  });
});

describe('other prop types added with the follow-up', () => {
  it('accepts a ref or a function wherever an overlay takes its initial focus', () => {
    const ref = createRef<HTMLElement>();
    const pick = (): HTMLElement | null => null;
    expectTypeOf(ref).toMatchTypeOf<FocusTarget>();
    expectTypeOf(pick).toMatchTypeOf<FocusTarget>();
    expectTypeOf<
      'first' | 'container' | 'none' | FocusTarget
    >().toEqualTypeOf<OverlayFocusTarget>();
    const elements: ReactElement[] = [
      <Dialog key="ref" open={false} onOpenChange={() => undefined} title="A" initialFocus={ref} />,
      <Dialog key="fn" open={false} onOpenChange={() => undefined} title="A" initialFocus={pick} />,
      <Sheet
        key="sheet"
        open={false}
        onOpenChange={() => undefined}
        title="A"
        initialFocus={pick}
      />,
      // @ts-expect-error a selector string is not a focus target
      <Dialog key="bad" open={false} onOpenChange={() => undefined} title="A" initialFocus="#x" />,
    ];
    expect(elements).toHaveLength(4);
  });

  it('lets ConfirmDialog take children, Button take pressed, and Link take anchor props', () => {
    const elements: ReactElement[] = [
      <ConfirmDialog
        key="confirm"
        open={false}
        title="Delete?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <ul>
          <li>Roadmap</li>
        </ul>
      </ConfirmDialog>,
      <Button key="pressed" pressed>
        Snapshots
      </Button>,
      <Button key="aria" aria-pressed="true">
        Snapshots
      </Button>,
      <Link key="link" href="/a" underline="hover" tone="neutral" ref={anchorRef} download>
        Documents
      </Link>,
      // @ts-expect-error there is no such underline mode
      <Link key="bad" href="/a" underline="never">
        Documents
      </Link>,
    ];
    expect(elements).toHaveLength(5);
  });
});
