import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  DropdownMenu,
  IconButton,
  MenuItem,
  SegmentedControl,
  Select,
  TextField,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '../src/index';
import { byTestId, click, flush, focus, get, getAll, press, query, render } from './helpers';

function Formatting({ redoDisabled = true }: { redoDisabled?: boolean }) {
  return (
    <>
      <Button data-testid="before">Before</Button>
      <Toolbar aria-label="Formatting" data-testid="toolbar">
        <ToolbarGroup aria-label="History">
          <IconButton label="Undo" data-testid="undo">
            <span />
          </IconButton>
          <IconButton label="Redo" data-testid="redo" disabled={redoDisabled}>
            <span />
          </IconButton>
        </ToolbarGroup>
        <ToolbarSeparator />
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
        <IconButton label="Italic" data-testid="italic">
          <span />
        </IconButton>
        <a href="#help" data-testid="help">
          Help
        </a>
      </Toolbar>
      <Button data-testid="after">After</Button>
    </>
  );
}

function tabStops(): string[] {
  return getAll('[data-testid="toolbar"] [tabindex="0"]').map((item) => item.dataset.testid ?? '');
}

function activeId(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.testid;
}

describe('Toolbar', () => {
  it('is a labelled horizontal toolbar with groups and separators', () => {
    render(<Formatting />);
    const toolbar = byTestId('toolbar');
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting');
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(get('[role="group"]').getAttribute('aria-label')).toBe('History');
    expect(get('[role="separator"]').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('puts exactly one control in the tab order: the first enabled one', () => {
    render(<Formatting />);
    expect(tabStops()).toEqual(['undo']);
    expect(byTestId('bold').getAttribute('tabindex')).toBe('-1');
    expect(byTestId('italic').getAttribute('tabindex')).toBe('-1');
    expect(byTestId('help').getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus and the tab stop with ArrowRight and ArrowLeft, skipping disabled controls', () => {
    render(<Formatting />);
    focus(byTestId('undo'));
    expect(press('ArrowRight')).toBe(false);
    // "Redo" is disabled.
    expect(activeId()).toBe('bold');
    expect(tabStops()).toEqual(['bold']);
    press('ArrowRight');
    expect(activeId()).toBe('italic');
    press('ArrowRight');
    expect(activeId()).toBe('help');
    expect(tabStops()).toEqual(['help']);
    press('ArrowLeft');
    expect(activeId()).toBe('italic');
    expect(tabStops()).toEqual(['italic']);
  });

  it('wraps around at both ends', () => {
    render(<Formatting />);
    focus(byTestId('undo'));
    press('ArrowLeft');
    expect(activeId()).toBe('help');
    press('ArrowRight');
    expect(activeId()).toBe('undo');
  });

  it('jumps to the ends with Home and End', () => {
    render(<Formatting />);
    focus(byTestId('bold'));
    press('End');
    expect(activeId()).toBe('help');
    press('Home');
    expect(activeId()).toBe('undo');
    expect(tabStops()).toEqual(['undo']);
  });

  it('leaves other keys and modified arrows alone', () => {
    render(<Formatting />);
    focus(byTestId('undo'));
    expect(press('ArrowDown')).toBe(true);
    expect(press('ArrowRight', { ctrlKey: true })).toBe(true);
    expect(press('ArrowRight', { altKey: true })).toBe(true);
    expect(press('Tab')).toBe(true);
    expect(activeId()).toBe('undo');
  });

  it('remembers the control used last as the place Tab returns to', () => {
    render(<Formatting />);
    // A mouse click focuses the control.
    focus(byTestId('italic'));
    expect(tabStops()).toEqual(['italic']);
    focus(byTestId('after'));
    expect(tabStops()).toEqual(['italic']);
  });

  it('includes a control once it becomes enabled', () => {
    const view = render(<Formatting redoDisabled />);
    focus(byTestId('undo'));
    press('ArrowRight');
    expect(activeId()).toBe('bold');
    view.rerender(<Formatting redoDisabled={false} />);
    focus(byTestId('undo'));
    press('ArrowRight');
    expect(activeId()).toBe('redo');
    expect(tabStops()).toEqual(['redo']);
  });

  it('moves the tab stop when the control holding it becomes disabled', async () => {
    function Harness() {
      const [canUndo, setCanUndo] = useState(true);
      return (
        <>
          <Toolbar aria-label="Formatting" data-testid="toolbar">
            <IconButton label="Undo" data-testid="undo" disabled={!canUndo}>
              <span />
            </IconButton>
            <IconButton label="Bold" data-testid="bold">
              <span />
            </IconButton>
          </Toolbar>
          <Button data-testid="toggle" onClick={() => setCanUndo(false)}>
            Disable undo
          </Button>
        </>
      );
    }
    render(<Harness />);
    expect(tabStops()).toEqual(['undo']);
    click(byTestId('toggle'));
    await flush();
    expect(tabStops()).toEqual(['bold']);
  });

  it('picks up controls changed by a child without the toolbar re-rendering', async () => {
    let disable: () => void = () => undefined;
    function History() {
      const [canUndo, setCanUndo] = useState(true);
      disable = () => setCanUndo(false);
      return (
        <IconButton label="Undo" data-testid="undo" disabled={!canUndo}>
          <span />
        </IconButton>
      );
    }
    render(
      <Toolbar aria-label="Formatting" data-testid="toolbar">
        <History />
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
      </Toolbar>,
    );
    expect(tabStops()).toEqual(['undo']);
    act(() => disable());
    // The MutationObserver callback runs as a microtask.
    await flush();
    expect(tabStops()).toEqual(['bold']);
  });

  it('leaves the arrow keys to a text input, which keeps its own tab stop', () => {
    render(
      <Toolbar aria-label="Formatting" data-testid="toolbar">
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
        <TextField aria-label="Font size" data-testid="size" defaultValue="12" />
        <IconButton label="Italic" data-testid="italic">
          <span />
        </IconButton>
      </Toolbar>,
    );
    const size = byTestId('size');
    expect(size.hasAttribute('tabindex')).toBe(false);
    focus(size);
    expect(press('ArrowRight')).toBe(true);
    expect(press('ArrowLeft')).toBe(true);
    expect(press('Home')).toBe(true);
    expect(activeId()).toBe('size');
    // The arrows walk past it between the buttons.
    focus(byTestId('bold'));
    press('ArrowRight');
    expect(activeId()).toBe('italic');
  });

  it('walks through a select with Left/Right, leaving Up/Down to change its value', () => {
    render(
      <Toolbar aria-label="Formatting" data-testid="toolbar">
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
        <Select
          aria-label="Text style"
          data-testid="style"
          defaultValue="p"
          options={[
            { value: 'p', label: 'Paragraph' },
            { value: 'h1', label: 'Heading 1' },
          ]}
        />
        <IconButton label="Italic" data-testid="italic">
          <span />
        </IconButton>
      </Toolbar>,
    );
    focus(byTestId('bold'));
    press('ArrowRight');
    expect(activeId()).toBe('style');
    expect(press('ArrowDown')).toBe(true);
    expect(press('ArrowRight')).toBe(false);
    expect(activeId()).toBe('italic');
  });

  it('treats the options of a segmented control as toolbar stops', () => {
    const onValueChange = vi.fn();
    render(
      <Toolbar aria-label="Formatting" data-testid="toolbar">
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
        <SegmentedControl
          ariaLabel="Alignment"
          value="start"
          onValueChange={onValueChange}
          options={[
            { value: 'start', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'end', label: 'Right' },
          ]}
        />
        <IconButton label="Italic" data-testid="italic">
          <span />
        </IconButton>
      </Toolbar>,
    );
    const radios = getAll('[role="radio"]');
    expect(getAll('[data-testid="toolbar"] [tabindex="0"]')).toHaveLength(1);
    focus(byTestId('bold'));
    press('ArrowRight');
    expect(document.activeElement).toBe(radios[0]);
    press('ArrowRight');
    expect(document.activeElement).toBe(radios[1]);
    // Moving through does not change the value; Enter, Space or a click does.
    expect(onValueChange).not.toHaveBeenCalled();
    click(radios[1] as HTMLElement);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('center');
    press('ArrowRight');
    press('ArrowRight');
    expect(activeId()).toBe('italic');
  });

  it('keeps arrow keys inside an open menu from moving the toolbar', async () => {
    render(
      <Toolbar aria-label="Formatting" data-testid="toolbar">
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
        <DropdownMenu
          trigger={
            <IconButton label="More" data-testid="more">
              <span />
            </IconButton>
          }
        >
          <MenuItem>Clear formatting</MenuItem>
          <MenuItem>Insert divider</MenuItem>
        </DropdownMenu>
      </Toolbar>,
    );
    focus(byTestId('more'));
    press('ArrowDown');
    await flush();
    expect(document.activeElement?.textContent).toBe('Clear formatting');
    press('ArrowRight');
    press('End');
    expect(document.activeElement?.textContent).toBe('Insert divider');
    press('Escape');
    expect(query('[role="menu"]')).toBeNull();
    expect(activeId()).toBe('more');
    expect(tabStops()).toEqual(['more']);
  });

  it('forwards className, style, ref and handlers to the toolbar element', () => {
    const onKeyDown = vi.fn();
    let node: HTMLDivElement | null = null;
    render(
      <Toolbar
        aria-label="Formatting"
        data-testid="toolbar"
        className="editor-toolbar"
        style={{ maxWidth: 320 }}
        onKeyDown={onKeyDown}
        ref={(element) => {
          node = element;
        }}
      >
        <IconButton label="Bold" data-testid="bold">
          <span />
        </IconButton>
      </Toolbar>,
    );
    const toolbar = byTestId('toolbar');
    expect(node).toBe(toolbar);
    expect(toolbar.classList.contains('rd-toolbar')).toBe(true);
    expect(toolbar.classList.contains('editor-toolbar')).toBe(true);
    expect(toolbar.style.maxWidth).toBe('320px');
    focus(byTestId('bold'));
    press('ArrowRight');
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('scrolls inside itself rather than growing: the content lives in an overflow container', () => {
    render(<Formatting />);
    const scroller = get('[data-testid="toolbar"] > .rd-toolbar__scroll');
    expect(scroller.contains(byTestId('undo'))).toBe(true);
    // No fades while nothing overflows.
    expect(byTestId('toolbar').hasAttribute('data-fade-start')).toBe(false);
    expect(byTestId('toolbar').hasAttribute('data-fade-end')).toBe(false);
  });

  it('shows the edge fades that match the scroll position', () => {
    render(<Formatting />);
    const toolbar = byTestId('toolbar');
    const scroller = get('[data-testid="toolbar"] > .rd-toolbar__scroll');
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 200 });
    let scrollLeft = 0;
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(400, value));
      },
    });
    const scrollTo = (position: number): void => {
      scrollLeft = position;
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });
    };

    scrollTo(0);
    expect(toolbar.hasAttribute('data-fade-start')).toBe(false);
    expect(toolbar.hasAttribute('data-fade-end')).toBe(true);
    scrollTo(180);
    expect(toolbar.hasAttribute('data-fade-start')).toBe(true);
    expect(toolbar.hasAttribute('data-fade-end')).toBe(true);
    scrollTo(400);
    expect(toolbar.hasAttribute('data-fade-start')).toBe(true);
    expect(toolbar.hasAttribute('data-fade-end')).toBe(false);

    // A vertical mouse wheel scrolls the overflowing row sideways.
    scrollTo(100);
    const wheel = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
    act(() => {
      scroller.dispatchEvent(wheel);
    });
    expect(scrollLeft).toBe(150);
    expect(wheel.defaultPrevented).toBe(true);
    // At the end the page gets the wheel back.
    scrollTo(400);
    const atEnd = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
    act(() => {
      scroller.dispatchEvent(atEnd);
    });
    expect(atEnd.defaultPrevented).toBe(false);
  });
});
