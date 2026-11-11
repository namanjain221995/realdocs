import { act, createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  DropdownMenu,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from '../src/index';
import {
  byTestId,
  click,
  flush,
  focus,
  get,
  getAll,
  keyboardClick,
  press,
  query,
  render,
} from './helpers';

interface Spies {
  rename?: () => void;
  wrap?: () => void;
  disabled?: () => void;
  trash?: () => void;
}

function DocumentMenu(spies: Spies) {
  return (
    <>
      <DropdownMenu trigger={<Button data-testid="trigger">Document</Button>} data-testid="menu">
        <MenuLabel>Edit</MenuLabel>
        <MenuItem onSelect={spies.rename} shortcut="F2">
          Rename
        </MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuItem disabled onSelect={spies.disabled}>
          Download
        </MenuItem>
        <MenuSeparator />
        <MenuItem checked onSelect={spies.wrap} closeOnSelect={false}>
          Wrap long lines
        </MenuItem>
        <MenuItem danger onSelect={spies.trash}>
          Trash
        </MenuItem>
      </DropdownMenu>
      <Button data-testid="after">After</Button>
    </>
  );
}

function focusedText(): string | undefined {
  return document.activeElement?.querySelector('.rd-menu__text')?.textContent ?? undefined;
}

async function openWithKey(key: string): Promise<void> {
  focus(byTestId('trigger'));
  press(key);
  await flush();
}

describe('DropdownMenu', () => {
  it('wires the trigger to the menu for assistive technology', async () => {
    render(<DocumentMenu />);
    const trigger = byTestId('trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);

    click(trigger);
    await flush();
    const menu = byTestId('menu');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.getAttribute('aria-labelledby')).toBe(trigger.id);
    // Portalled out of the React container.
    expect(menu.closest('.rd-popover')?.parentElement).toBe(document.body);
  });

  it('gives items the right roles and states', async () => {
    render(<DocumentMenu />);
    click(byTestId('trigger'));
    await flush();
    expect(getAll('[role="menuitem"]')).toHaveLength(4);
    const checkbox = get('[role="menuitemcheckbox"]');
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(getAll('[aria-disabled="true"]')).toHaveLength(1);
    expect(getAll('[role="separator"]')).toHaveLength(1);
  });

  it('focuses the menu itself when opened with the mouse', async () => {
    render(<DocumentMenu />);
    click(byTestId('trigger'));
    await flush();
    expect(document.activeElement).toBe(byTestId('menu'));
    press('ArrowDown');
    expect(focusedText()).toBe('Rename');
  });

  it('focuses the first item when opened with Enter, Space or ArrowDown', async () => {
    render(<DocumentMenu />);
    focus(byTestId('trigger'));
    keyboardClick(byTestId('trigger'));
    await flush();
    expect(focusedText()).toBe('Rename');
    press('Escape');

    await openWithKey('ArrowDown');
    expect(focusedText()).toBe('Rename');
  });

  it('focuses the last item when opened with ArrowUp', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowUp');
    expect(focusedText()).toBe('Trash');
  });

  it('moves with the arrow keys, skips disabled items and wraps', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    expect(press('ArrowDown')).toBe(false);
    expect(focusedText()).toBe('Duplicate');
    press('ArrowDown');
    // "Download" is disabled.
    expect(focusedText()).toBe('Wrap long lines');
    press('ArrowDown');
    expect(focusedText()).toBe('Trash');
    press('ArrowDown');
    expect(focusedText()).toBe('Rename');
    press('ArrowUp');
    expect(focusedText()).toBe('Trash');
    press('ArrowUp');
    expect(focusedText()).toBe('Wrap long lines');
  });

  it('jumps with Home and End', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    press('End');
    expect(focusedText()).toBe('Trash');
    press('Home');
    expect(focusedText()).toBe('Rename');
  });

  it('jumps to items by typing, cycling through matches', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    press('t');
    expect(focusedText()).toBe('Trash');
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(1000);
      press('d');
      // Enabled items only: "Download" is skipped.
      expect(focusedText()).toBe('Duplicate');
      vi.advanceTimersByTime(1000);
      press('w');
      press('r');
      expect(focusedText()).toBe('Wrap long lines');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a single item in the tab order', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    press('ArrowDown');
    const tabStops = getAll('[role^="menuitem"]').filter((item) => item.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toBe(document.activeElement);
  });

  it('runs the item, closes and returns focus to the trigger', async () => {
    const rename = vi.fn();
    render(<DocumentMenu rename={rename} />);
    await openWithKey('ArrowDown');
    // Enter on a button is a click.
    keyboardClick(document.activeElement as HTMLElement);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(query('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('trigger'));
    expect(byTestId('trigger').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the menu open for items with closeOnSelect={false}', async () => {
    const wrap = vi.fn();
    render(<DocumentMenu wrap={wrap} />);
    await openWithKey('ArrowDown');
    click(get('[role="menuitemcheckbox"]'));
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(query('[role="menu"]')).not.toBeNull();
  });

  it('does nothing for a disabled item', async () => {
    const disabled = vi.fn();
    render(<DocumentMenu disabled={disabled} />);
    await openWithKey('ArrowDown');
    click(get('[aria-disabled="true"]'));
    expect(disabled).not.toHaveBeenCalled();
    expect(query('[role="menu"]')).not.toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    press('Escape');
    expect(query('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('trigger'));
  });

  it('closes on Tab without letting focus wander off', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    expect(press('Tab')).toBe(false);
    expect(query('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('trigger'));
  });

  it('closes when the trigger is clicked again and on a press outside', async () => {
    render(<DocumentMenu />);
    click(byTestId('trigger'));
    await flush();
    click(byTestId('trigger'));
    expect(query('[role="menu"]')).toBeNull();

    click(byTestId('trigger'));
    await flush();
    click(byTestId('after'));
    expect(query('[role="menu"]')).toBeNull();
  });

  it('moves focus with the mouse so hover and keyboard share one highlight', async () => {
    render(<DocumentMenu />);
    await openWithKey('ArrowDown');
    const trash = getAll('[role="menuitem"]').find((item) => item.textContent === 'Trash');
    expect(trash).toBeDefined();
    act(() => {
      trash?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }),
      );
    });
    expect(document.activeElement).toBe(trash);
    press('ArrowUp');
    expect(focusedText()).toBe('Wrap long lines');
  });

  it('works with an IconButton trigger and keeps its accessible name', async () => {
    render(
      <DropdownMenu
        trigger={
          <IconButton label="More actions" data-testid="icon-trigger">
            <span />
          </IconButton>
        }
      >
        <MenuItem>Rename</MenuItem>
      </DropdownMenu>,
    );
    const trigger = byTestId('icon-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('More actions');
    click(trigger);
    await flush();
    expect(query('[role="menu"]')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('can be controlled from outside', async () => {
    const onOpenChange = vi.fn();
    const view = render(
      <DropdownMenu
        open={false}
        onOpenChange={onOpenChange}
        trigger={<Button data-testid="trigger">Document</Button>}
      >
        <MenuItem>Rename</MenuItem>
      </DropdownMenu>,
    );
    click(byTestId('trigger'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(query('[role="menu"]')).toBeNull();
    view.rerender(
      <DropdownMenu
        open
        onOpenChange={onOpenChange}
        trigger={<Button data-testid="trigger">Document</Button>}
      >
        <MenuItem>Rename</MenuItem>
      </DropdownMenu>,
    );
    await flush();
    expect(query('[role="menu"]')).not.toBeNull();
  });
});

describe('MenuItem as a link', () => {
  it('renders an anchor, with its handlers, ref and attributes on that anchor', async () => {
    const ref = createRef<HTMLAnchorElement>();
    let clicked: EventTarget | null = null;
    const onSelect = vi.fn();
    render(
      <DropdownMenu trigger={<Button data-testid="trigger">Document</Button>}>
        <MenuItem
          href="/settings"
          ref={ref}
          data-testid="settings"
          onSelect={onSelect}
          onClick={(event) => {
            clicked = event.currentTarget;
            // A router handles the navigation itself.
            event.preventDefault();
          }}
        >
          Settings
        </MenuItem>
        <MenuItem href="/print" target="_blank" data-testid="print">
          Print view
        </MenuItem>
        <MenuItem href="/export.md" download data-testid="export">
          Export as Markdown
        </MenuItem>
        <MenuItem href="/archive" disabled data-testid="archive">
          Archive
        </MenuItem>
      </DropdownMenu>,
    );
    click(byTestId('trigger'));
    await flush();

    const settings = byTestId<HTMLAnchorElement>('settings');
    expect(settings.tagName).toBe('A');
    expect(settings.getAttribute('href')).toBe('/settings');
    expect(settings.getAttribute('role')).toBe('menuitem');
    expect(ref.current).toBe(settings);
    // Links that open a new tab do not hand over the opener.
    expect(byTestId('print').getAttribute('rel')).toBe('noopener noreferrer');
    expect(byTestId('export').hasAttribute('download')).toBe(true);
    // A disabled link has nowhere to go and is skipped by the arrow keys.
    expect(byTestId('archive').hasAttribute('href')).toBe(false);
    expect(byTestId('archive').getAttribute('aria-disabled')).toBe('true');

    click(settings);
    expect(clicked).toBe(settings);
    // Unlike a button item, a link still counts as chosen when its own
    // handler prevented the default: the menu closes after in-app navigation.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(query('[role="menu"]')).toBeNull();
  });

  it('keeps a button item open when its handler prevents the default', async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu trigger={<Button data-testid="trigger">Document</Button>}>
        <MenuItem
          onSelect={onSelect}
          onClick={(event) => event.preventDefault()}
          data-testid="item"
        >
          Rename
        </MenuItem>
      </DropdownMenu>,
    );
    click(byTestId('trigger'));
    await flush();
    const item = byTestId('item');
    expect(item.tagName).toBe('BUTTON');
    click(item);
    expect(onSelect).not.toHaveBeenCalled();
    expect(query('[role="menu"]')).not.toBeNull();
  });
});

describe('Menu, inline', () => {
  it('is a single tab stop and handles arrows without a popover', () => {
    const onClose = vi.fn();
    render(
      <Menu aria-label="Document actions" onClose={onClose} data-testid="menu">
        <MenuItem>Rename</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuItem href="/export.md" download>
          Export
        </MenuItem>
      </Menu>,
    );
    const items = getAll('[role="menuitem"]');
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1]);
    focus(items[0] as HTMLElement);
    press('ArrowDown');
    press('ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    // The focused item is now the tab stop.
    expect(items.map((item) => item.tabIndex)).toEqual([-1, -1, 0]);
    expect(items[2]?.tagName).toBe('A');
    expect(items[2]?.getAttribute('href')).toBe('/export.md');
  });

  it('moves its tab stop off an item that becomes disabled', () => {
    const view = render(
      <Menu aria-label="Document actions">
        <MenuItem>Rename</MenuItem>
        <MenuItem>Duplicate</MenuItem>
      </Menu>,
    );
    expect(getAll('[role="menuitem"]').map((item) => item.tabIndex)).toEqual([0, -1]);
    view.rerender(
      <Menu aria-label="Document actions">
        <MenuItem disabled>Rename</MenuItem>
        <MenuItem>Duplicate</MenuItem>
      </Menu>,
    );
    expect(getAll('[role="menuitem"]').map((item) => item.tabIndex)).toEqual([-1, 0]);
  });

  it('leaves Tab to the browser when there is nothing to close', () => {
    render(
      <Menu aria-label="Document actions">
        <MenuItem>Rename</MenuItem>
      </Menu>,
    );
    focus(get('[role="menuitem"]'));
    expect(press('Tab')).toBe(true);
  });
});
