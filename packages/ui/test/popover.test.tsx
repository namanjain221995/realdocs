import { act, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Popover, type PopoverProps, TextField } from '../src/index';
import { byTestId, click, flush, focus, get, pointerDown, press, query, render } from './helpers';

function Harness({
  onOpenChange,
  ...popover
}: Partial<PopoverProps> & { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean): void => {
    onOpenChange?.(next);
    setOpen(next);
  };
  return (
    <>
      <Popover
        aria-label="Link"
        data-testid="popover"
        {...popover}
        open={open}
        onOpenChange={change}
        trigger={<Button data-testid="trigger">Link</Button>}
      >
        <TextField label="Address" data-testid="address" />
        <Button data-testid="apply">Apply</Button>
      </Popover>
      <Button data-testid="outside">Outside</Button>
      <p data-testid="text">Plain text</p>
    </>
  );
}

async function open(): Promise<void> {
  const trigger = byTestId('trigger');
  focus(trigger);
  click(trigger);
  await flush();
}

describe('Popover', () => {
  it('renders into document.body only while open', async () => {
    render(<Harness />);
    expect(query('[data-testid="popover"]')).toBeNull();
    await open();
    const popover = byTestId('popover');
    expect(popover.parentElement).toBe(document.body);
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(popover.getAttribute('aria-label')).toBe('Link');
  });

  it('describes its state on the trigger', async () => {
    render(<Harness />);
    const trigger = byTestId('trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await open();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(byTestId('popover').id);
  });

  it('is positioned once floating-ui has run', async () => {
    render(<Harness />);
    await open();
    const popover = byTestId('popover');
    expect(popover.dataset.positioned).toBe('true');
    expect(popover.style.left).toMatch(/px$/);
    expect(popover.style.top).toMatch(/px$/);
    expect(popover.dataset.placement).toBeTruthy();
  });

  it('moves focus to the first control and back to the trigger on close', async () => {
    render(<Harness />);
    await open();
    expect(document.activeElement).toBe(byTestId('address'));
    press('Escape');
    expect(query('[data-testid="popover"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('trigger'));
  });

  it('can leave focus where it is', async () => {
    render(<Harness initialFocus="none" />);
    await open();
    expect(document.activeElement).toBe(byTestId('trigger'));
  });

  it('closes on a press outside', async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await open();
    onOpenChange.mockClear();
    pointerDown(byTestId('text'));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(query('[data-testid="popover"]')).toBeNull();
  });

  it('stays open for a press inside it', async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await open();
    onOpenChange.mockClear();
    pointerDown(byTestId('address'));
    pointerDown(byTestId('popover'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(query('[data-testid="popover"]')).not.toBeNull();
  });

  it('leaves a press on the trigger to the trigger, which then toggles once', async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await open();
    onOpenChange.mockClear();
    // pointerdown must not close it, or the click that follows would reopen it.
    pointerDown(byTestId('trigger'));
    expect(onOpenChange).not.toHaveBeenCalled();
    click(byTestId('trigger'));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(query('[data-testid="popover"]')).toBeNull();
  });

  it('does not steal focus back from where the user pressed', async () => {
    render(<Harness />);
    await open();
    const outside = byTestId('outside');
    pointerDown(outside);
    // The browser focuses the pressed control after pointerdown.
    focus(outside);
    expect(document.activeElement).toBe(outside);
  });

  it('can ignore outside presses and Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Harness onOpenChange={onOpenChange} closeOnOutsidePress={false} closeOnEscape={false} />,
    );
    await open();
    onOpenChange.mockClear();
    pointerDown(byTestId('text'));
    press('Escape');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes when Tab leaves the last control or Shift+Tab leaves the first', async () => {
    render(<Harness />);
    await open();
    focus(byTestId('apply'));
    expect(press('Tab')).toBe(false);
    expect(query('[data-testid="popover"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('trigger'));

    await open();
    expect(document.activeElement).toBe(byTestId('address'));
    expect(press('Tab')).toBe(true);
    expect(press('Tab', { shiftKey: true })).toBe(false);
    expect(query('[data-testid="popover"]')).toBeNull();
  });

  it('treats a popover opened from inside as part of its parent', async () => {
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return (
        <>
          <Popover
            open={outer}
            onOpenChange={setOuter}
            aria-label="Outer"
            data-testid="outer"
            trigger={<Button data-testid="outer-trigger">Outer</Button>}
          >
            <Popover
              open={inner}
              onOpenChange={setInner}
              aria-label="Inner"
              data-testid="inner"
              trigger={<Button data-testid="inner-trigger">Inner</Button>}
            >
              <Button data-testid="inner-action">Inner action</Button>
            </Popover>
          </Popover>
          <p data-testid="text">Plain text</p>
        </>
      );
    }
    render(<Nested />);
    await flush();
    click(byTestId('inner-trigger'));
    await flush();
    expect(byTestId('inner').parentElement).toBe(document.body);

    // A press inside the inner popover is not "outside" the outer one.
    pointerDown(byTestId('inner-action'));
    expect(query('[data-testid="outer"]')).not.toBeNull();
    expect(query('[data-testid="inner"]')).not.toBeNull();

    // Escape closes one layer at a time, innermost first.
    press('Escape');
    expect(query('[data-testid="inner"]')).toBeNull();
    expect(query('[data-testid="outer"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="outer"]')).toBeNull();
  });

  it('closes both layers on a press outside both', async () => {
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <>
          <Popover
            open={outer}
            onOpenChange={setOuter}
            data-testid="outer"
            trigger={<Button>Outer</Button>}
          >
            <Popover
              open={inner}
              onOpenChange={setInner}
              data-testid="inner"
              trigger={<Button>Inner</Button>}
            >
              <Button>Inner action</Button>
            </Popover>
          </Popover>
          <p data-testid="text">Plain text</p>
        </>
      );
    }
    render(<Nested />);
    await flush();
    pointerDown(byTestId('text'));
    expect(query('[data-testid="outer"]')).toBeNull();
    expect(query('[data-testid="inner"]')).toBeNull();
  });

  it('supports an anchor render prop that leaves opening to the caller', async () => {
    function WithAnchor() {
      const [open, setOpen] = useState(false);
      return (
        <Popover
          open={open}
          onOpenChange={setOpen}
          data-testid="popover"
          placement="top"
          anchor={(props) => (
            <button
              type="button"
              {...props}
              data-testid="anchor"
              onDoubleClick={() => setOpen(true)}
            >
              Anchor
            </button>
          )}
        >
          <Button>Inside</Button>
        </Popover>
      );
    }
    render(<WithAnchor />);
    const anchor = byTestId('anchor');
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    // A plain click does not open it: the anchor form adds no toggle.
    click(anchor);
    expect(query('[data-testid="popover"]')).toBeNull();
    focus(anchor);
    act(() => {
      anchor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await flush();
    expect(query('[data-testid="popover"]')).not.toBeNull();
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    // The anchor itself is not "outside".
    pointerDown(anchor);
    expect(query('[data-testid="popover"]')).not.toBeNull();
    press('Escape');
    expect(document.activeElement).toBe(anchor);
  });

  it('can anchor to an element ref or a virtual rectangle', async () => {
    function WithRef() {
      const target = useRef<HTMLParagraphElement>(null);
      return (
        <>
          <p ref={target} data-testid="target">
            Selected text
          </p>
          <Popover open onOpenChange={() => undefined} anchor={target} data-testid="by-ref">
            By ref
          </Popover>
          <Popover
            open
            onOpenChange={() => undefined}
            data-testid="by-rect"
            anchor={{
              getBoundingClientRect: () => ({
                x: 40,
                y: 40,
                width: 10,
                height: 10,
                top: 40,
                left: 40,
                right: 50,
                bottom: 50,
              }),
            }}
          >
            By rectangle
          </Popover>
        </>
      );
    }
    render(<WithRef />);
    await flush();
    expect(byTestId('by-ref').dataset.positioned).toBe('true');
    expect(byTestId('by-rect').dataset.positioned).toBe('true');
    // A press on the referenced element is not an outside press.
    expect(get('[data-testid="by-ref"]')).not.toBeNull();
  });

  it('copies a nested theme onto the portalled popover', async () => {
    function Themed() {
      return (
        <div data-theme="light">
          <Popover
            open
            onOpenChange={() => undefined}
            data-testid="popover"
            trigger={<Button>Open</Button>}
          >
            Content
          </Popover>
        </div>
      );
    }
    render(<Themed />);
    await flush();
    expect(byTestId('popover').getAttribute('data-theme')).toBe('light');
  });
});
