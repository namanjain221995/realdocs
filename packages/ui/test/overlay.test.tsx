import { act, type ReactNode, type RefObject, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Dialog,
  DropdownMenu,
  MenuItem,
  type OverlayFocusTarget,
  type OverlayLayer,
  OverlayProvider,
  Popover,
  TextField,
  useFocusTrap,
  useOutsidePress,
  useOverlayFocus,
  useOverlayLayer,
  useScrollLock,
} from '../src/index';
import { byTestId, click, flush, focus, get, pointerDown, press, query, render } from './helpers';

/**
 * A side panel built the way an app would build one, from the public hooks
 * only. It stands in for any overlay the kit does not ship.
 */
interface PanelProps {
  onClose: () => void;
  /** Modal panels trap focus and lock scrolling; docked ones do neither. */
  modal?: boolean;
  /** A docked panel only reacts to Escape while focus is inside it. */
  escapeOnlyInside?: boolean;
  /** Leave Escape to whatever is below. */
  ignoreEscape?: boolean;
  enabled?: boolean;
  initialFocus?: OverlayFocusTarget;
  returnFocus?: boolean;
  container?: boolean;
  onOutsidePress?: () => void;
  ignore?: RefObject<Element | null>;
  expose?: (layer: OverlayLayer) => void;
  testId?: string;
  children?: ReactNode;
}

function Panel({
  onClose,
  modal = true,
  escapeOnlyInside = false,
  ignoreEscape = false,
  enabled = true,
  initialFocus,
  returnFocus,
  container = false,
  onOutsidePress,
  ignore,
  expose,
  testId = 'panel',
  children,
}: PanelProps) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const layer = useOverlayLayer(element, {
    enabled,
    onEscape: ignoreEscape
      ? undefined
      : (event) => {
          const inside = event.target instanceof Node && element?.contains(event.target);
          if (escapeOnlyInside && !inside) return false;
          onClose();
          return undefined;
        },
  });
  useFocusTrap(layer, { enabled: modal });
  useOverlayFocus(layer, { initialFocus, returnFocus });
  useScrollLock(modal);
  useOutsidePress(layer, () => onOutsidePress?.(), {
    enabled: onOutsidePress !== undefined,
    ignore: ignore ? [ignore] : undefined,
  });
  expose?.(layer);
  return (
    <aside
      ref={setElement}
      role={modal ? 'dialog' : 'complementary'}
      aria-modal={modal || undefined}
      aria-label="Sharing"
      tabIndex={-1}
      data-testid={testId}
    >
      <OverlayProvider layer={layer} container={container ? element : undefined}>
        {children}
      </OverlayProvider>
    </aside>
  );
}

function PanelControls() {
  return (
    <>
      <TextField label="Link name" data-testid="first" />
      <Button data-testid="middle">Copy</Button>
      <Button data-testid="last">Done</Button>
    </>
  );
}

/** An opener button, the panel it opens, and something else on the page. */
function Harness(props: Omit<PanelProps, 'onClose' | 'children'> & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button data-testid="opener" onClick={() => setOpen(true)}>
        Share
      </Button>
      <Button data-testid="elsewhere">Elsewhere</Button>
      <p data-testid="text">Plain text</p>
      {open ? (
        <Panel {...props} onClose={() => setOpen(false)}>
          {props.children ?? <PanelControls />}
        </Panel>
      ) : null}
    </>
  );
}

function openPanel(): void {
  const opener = byTestId('opener');
  focus(opener);
  click(opener);
}

describe('useOverlayLayer: Escape', () => {
  it('closes the overlay and marks the key as handled', () => {
    render(<Harness />);
    openPanel();
    expect(query('[data-testid="panel"]')).not.toBeNull();
    const allowed = press('Escape');
    expect(allowed).toBe(false);
    expect(query('[data-testid="panel"]')).toBeNull();
  });

  it('gives Escape to a kit menu opened inside first, then to the overlay', async () => {
    render(
      <Harness>
        <DropdownMenu trigger={<Button data-testid="menu-trigger">More</Button>}>
          <MenuItem>Rename</MenuItem>
        </DropdownMenu>
      </Harness>,
    );
    openPanel();
    click(byTestId('menu-trigger'));
    await flush();
    expect(query('[role="menu"]')).not.toBeNull();
    press('Escape');
    expect(query('[role="menu"]')).toBeNull();
    expect(query('[data-testid="panel"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="panel"]')).toBeNull();
  });

  it('gives Escape to a kit dialog opened later first, then to the overlay', () => {
    function WithDialog() {
      const [panel, setPanel] = useState(true);
      const [dialog, setDialog] = useState(false);
      return (
        <>
          {panel ? (
            <Panel onClose={() => setPanel(false)}>
              <Button data-testid="open-dialog" onClick={() => setDialog(true)}>
                Details
              </Button>
            </Panel>
          ) : null}
          {/* A sibling of the panel, as an app would render it. */}
          <Dialog open={dialog} onOpenChange={setDialog} title="Details" data-testid="dialog">
            <Button>Fine</Button>
          </Dialog>
        </>
      );
    }
    render(<WithDialog />);
    click(byTestId('open-dialog'));
    expect(query('[data-testid="dialog"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="dialog"]')).toBeNull();
    expect(query('[data-testid="panel"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="panel"]')).toBeNull();
  });

  it('is above a kit popover that was already open', async () => {
    function PopoverThenPanel() {
      const [popover, setPopover] = useState(true);
      const [panel, setPanel] = useState(false);
      return (
        <>
          <Popover
            open={popover}
            onOpenChange={setPopover}
            closeOnOutsidePress={false}
            data-testid="popover"
            trigger={<Button>Colours</Button>}
          >
            <Button data-testid="open-panel" onClick={() => setPanel(true)}>
              Open panel
            </Button>
          </Popover>
          {panel ? <Panel onClose={() => setPanel(false)} /> : null}
        </>
      );
    }
    render(<PopoverThenPanel />);
    await flush();
    click(byTestId('open-panel'));
    press('Escape');
    expect(query('[data-testid="panel"]')).toBeNull();
    expect(query('[data-testid="popover"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="popover"]')).toBeNull();
  });

  it('passes Escape down when the handler declines it', async () => {
    function DockedAbovePopover() {
      const [popover, setPopover] = useState(true);
      const [panel, setPanel] = useState(true);
      return (
        <>
          <Popover
            open={popover}
            onOpenChange={setPopover}
            closeOnOutsidePress={false}
            initialFocus="none"
            data-testid="popover"
            trigger={<Button data-testid="trigger">Colours</Button>}
          >
            Content
          </Popover>
          {panel ? (
            <Panel modal={false} escapeOnlyInside onClose={() => setPanel(false)}>
              <Button data-testid="inside">Inside</Button>
            </Panel>
          ) : null}
        </>
      );
    }
    render(<DockedAbovePopover />);
    await flush();
    // Focus is outside the docked panel: it declines, and the popover below closes.
    focus(byTestId('trigger'));
    press('Escape');
    expect(query('[data-testid="popover"]')).toBeNull();
    expect(query('[data-testid="panel"]')).not.toBeNull();
    // With focus inside, the panel takes the key.
    focus(byTestId('inside'));
    press('Escape');
    expect(query('[data-testid="panel"]')).toBeNull();
  });

  it('leaves the key unhandled when every layer declines', () => {
    render(
      <Panel modal={false} escapeOnlyInside onClose={() => undefined}>
        <Button>Inside</Button>
      </Panel>,
    );
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => outside.focus());
    expect(press('Escape')).toBe(true);
    expect(query('[data-testid="panel"]')).not.toBeNull();
  });

  it('stays out of Escape handling without onEscape, or while disabled', async () => {
    function Stack({ enabled, ignoreEscape }: { enabled: boolean; ignoreEscape: boolean }) {
      const [popover, setPopover] = useState(true);
      const onClose = vi.fn();
      return (
        <>
          <Popover
            open={popover}
            onOpenChange={setPopover}
            closeOnOutsidePress={false}
            data-testid="popover"
            trigger={<Button>Colours</Button>}
          >
            Content
          </Popover>
          <Panel enabled={enabled} ignoreEscape={ignoreEscape} modal={false} onClose={onClose} />
        </>
      );
    }
    const view = render(<Stack enabled ignoreEscape />);
    await flush();
    press('Escape');
    expect(query('[data-testid="popover"]')).toBeNull();
    expect(query('[data-testid="panel"]')).not.toBeNull();
    view.unmount();

    render(<Stack enabled={false} ignoreEscape={false} />);
    await flush();
    press('Escape');
    expect(query('[data-testid="popover"]')).toBeNull();
    expect(query('[data-testid="panel"]')).not.toBeNull();
  });

  it('ignores Escape pressed during IME composition', () => {
    render(<Harness />);
    openPanel();
    press('Escape', { isComposing: true });
    expect(query('[data-testid="panel"]')).not.toBeNull();
  });

  it('reports containment and whether it is top-most', async () => {
    let layer: OverlayLayer | undefined;
    function Probe() {
      const [dialog, setDialog] = useState(false);
      return (
        <>
          <Panel onClose={() => undefined} expose={(current) => (layer = current)}>
            <DropdownMenu trigger={<Button data-testid="menu-trigger">More</Button>}>
              <MenuItem>Rename</MenuItem>
            </DropdownMenu>
            <Button data-testid="open-dialog" onClick={() => setDialog(true)}>
              Details
            </Button>
          </Panel>
          <p data-testid="text">Plain text</p>
          <Dialog open={dialog} onOpenChange={setDialog} title="Details" />
        </>
      );
    }
    render(<Probe />);
    expect(layer?.element).toBe(byTestId('panel'));
    expect(layer?.isTopMost()).toBe(true);
    expect(layer?.contains(byTestId('menu-trigger'))).toBe(true);
    expect(layer?.contains(byTestId('text'))).toBe(false);
    expect(layer?.contains(null)).toBe(false);

    click(byTestId('menu-trigger'));
    await flush();
    // The menu is portalled to the body, yet it belongs to the panel.
    const menu = get('[role="menu"]');
    expect(byTestId('panel').contains(menu)).toBe(false);
    expect(layer?.contains(menu)).toBe(true);
    expect(layer?.isTopMost()).toBe(false);
    press('Escape');
    expect(layer?.isTopMost()).toBe(true);

    click(byTestId('open-dialog'));
    expect(layer?.isTopMost()).toBe(false);
  });
});

describe('useFocusTrap', () => {
  it('wraps Tab from the last control to the first, and back', () => {
    render(<Harness />);
    openPanel();
    focus(byTestId('last'));
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(byTestId('first'));
    expect(press('Tab', { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(byTestId('last'));
  });

  it('leaves Tab alone between controls', () => {
    render(<Harness />);
    openPanel();
    focus(byTestId('middle'));
    expect(press('Tab')).toBe(true);
    expect(press('Tab', { shiftKey: true })).toBe(true);
  });

  it('pulls focus back in from the page behind', () => {
    render(<Harness />);
    openPanel();
    act(() => byTestId('elsewhere').focus());
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(byTestId('first'));
    act(() => byTestId('elsewhere').focus());
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(byTestId('last'));
  });

  it('holds focus on the overlay itself when it has no controls', () => {
    render(
      <Harness>
        <p>Restoring the snapshot.</p>
      </Harness>,
    );
    openPanel();
    expect(document.activeElement).toBe(byTestId('panel'));
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(byTestId('panel'));
  });

  it('does nothing while disabled', () => {
    render(<Harness modal={false} />);
    openPanel();
    focus(byTestId('last'));
    expect(press('Tab')).toBe(true);
    act(() => byTestId('elsewhere').focus());
    expect(press('Tab')).toBe(true);
    expect(document.activeElement).toBe(byTestId('elsewhere'));
  });

  it('leaves a kit popover opened from inside to manage its own Tab', async () => {
    function WithPopover() {
      const [open, setOpen] = useState(false);
      return (
        <Panel onClose={() => undefined}>
          <Popover
            open={open}
            onOpenChange={setOpen}
            data-testid="popover"
            trigger={<Button data-testid="popover-trigger">Colours</Button>}
          >
            <Button data-testid="one">One</Button>
            <Button data-testid="two">Two</Button>
          </Popover>
          <Button data-testid="after">After</Button>
        </Panel>
      );
    }
    render(<WithPopover />);
    click(byTestId('popover-trigger'));
    await flush();
    // Portalled to the body, outside the panel element.
    expect(byTestId('panel').contains(byTestId('popover'))).toBe(false);
    expect(document.activeElement).toBe(byTestId('one'));
    // Tab between the popover's own controls is not hijacked by the panel's trap.
    expect(press('Tab')).toBe(true);
    expect(document.activeElement).toBe(byTestId('one'));
    // Leaving the popover's last control closes it and returns to its trigger.
    focus(byTestId('two'));
    expect(press('Tab')).toBe(false);
    expect(query('[data-testid="popover"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('popover-trigger'));
  });

  it('hands the trap to a kit dialog opened from inside and takes it back', () => {
    function WithDialog() {
      const [dialog, setDialog] = useState(false);
      return (
        <>
          <Panel onClose={() => undefined}>
            <Button data-testid="open-dialog" onClick={() => setDialog(true)}>
              Details
            </Button>
            <Button data-testid="panel-last">Done</Button>
          </Panel>
          <Dialog open={dialog} onOpenChange={setDialog} title="Details" dismissible={false}>
            <Button data-testid="dialog-only">Fine</Button>
            <Button data-testid="dialog-close" onClick={() => setDialog(false)}>
              Close
            </Button>
          </Dialog>
        </>
      );
    }
    render(<WithDialog />);
    focus(byTestId('open-dialog'));
    click(byTestId('open-dialog'));
    expect(document.activeElement).toBe(byTestId('dialog-only'));
    // The dialog owns Tab now: from its last control it wraps inside the dialog.
    focus(byTestId('dialog-close'));
    press('Tab');
    expect(document.activeElement).toBe(byTestId('dialog-only'));
    click(byTestId('dialog-close'));
    // Focus returned into the panel, whose trap works again.
    expect(document.activeElement).toBe(byTestId('open-dialog'));
    focus(byTestId('panel-last'));
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(byTestId('open-dialog'));
  });
});

describe('useOverlayFocus', () => {
  it('moves focus to the first control on open and back to the opener on close', () => {
    render(<Harness />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('first'));
    press('Escape');
    expect(document.activeElement).toBe(byTestId('opener'));
  });

  it('prefers an element marked data-autofocus', () => {
    render(
      <Harness>
        <Button>One</Button>
        <Button data-testid="marked" data-autofocus="">
          Two
        </Button>
      </Harness>,
    );
    openPanel();
    expect(document.activeElement).toBe(byTestId('marked'));
  });

  it('can focus the overlay itself, a ref, or what a function returns', () => {
    const view = render(<Harness initialFocus="container" />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('panel'));
    view.unmount();

    function WithRef() {
      const target = useRef<HTMLButtonElement>(null);
      return (
        <Harness initialFocus={target}>
          <Button>One</Button>
          <Button ref={target} data-testid="by-ref">
            Two
          </Button>
        </Harness>
      );
    }
    const withRef = render(<WithRef />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('by-ref'));
    withRef.unmount();

    render(<Harness initialFocus={() => query('[data-testid="last"]')} />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('last'));
  });

  it('falls back to the default when a ref or function yields nothing', () => {
    render(<Harness initialFocus={() => null} />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('first'));
  });

  it('can leave focus where it is', () => {
    render(<Harness initialFocus="none" modal={false} />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('opener'));
  });

  it('does not disturb focus the user has moved elsewhere', () => {
    let close: () => void = () => undefined;
    function Docked() {
      const [open, setOpen] = useState(false);
      close = () => setOpen(false);
      return (
        <>
          <Button data-testid="opener" onClick={() => setOpen(true)}>
            Share
          </Button>
          <TextField label="Document title" data-testid="elsewhere" />
          {open ? (
            <Panel modal={false} onClose={close}>
              <Button data-testid="inside">Inside</Button>
            </Panel>
          ) : null}
        </>
      );
    }
    render(<Docked />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('inside'));
    // The user goes back to typing in the page; then the docked panel closes
    // for a reason of its own (its document was archived, say).
    const field = byTestId('elsewhere');
    focus(field);
    // A native listener: React itself mutes its own handlers while it commits.
    const blurred = vi.fn();
    field.addEventListener('blur', blurred);
    act(() => close());
    expect(query('[data-testid="panel"]')).toBeNull();
    expect(document.activeElement).toBe(field);
    // Focus never left the field on the way. A bounce through the opener would
    // be put right by React, but not before it had ended an IME composition
    // and made a screen reader announce the opener.
    expect(blurred).not.toHaveBeenCalled();
  });

  it('does take focus back when it would otherwise be lost with the overlay', () => {
    let close: () => void = () => undefined;
    function Docked() {
      const [open, setOpen] = useState(false);
      close = () => setOpen(false);
      return (
        <>
          <Button data-testid="opener" onClick={() => setOpen(true)}>
            Share
          </Button>
          {open ? (
            <Panel modal={false} onClose={close}>
              <Button data-testid="inside">Inside</Button>
            </Panel>
          ) : null}
        </>
      );
    }
    render(<Docked />);
    openPanel();
    expect(document.activeElement).toBe(byTestId('inside'));
    act(() => close());
    expect(document.activeElement).toBe(byTestId('opener'));
  });

  it('keeps focus where it is on close when returnFocus is off', () => {
    render(<Harness returnFocus={false} />);
    openPanel();
    press('Escape');
    expect(document.activeElement).not.toBe(byTestId('opener'));
  });

  it('returns focus past an opener that has gone to what was focused at open', async () => {
    function FromMenu() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <DropdownMenu trigger={<Button data-testid="menu-trigger">Document</Button>}>
            <MenuItem onSelect={() => setOpen(true)}>Share</MenuItem>
          </DropdownMenu>
          {open ? <Panel onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    render(<FromMenu />);
    focus(byTestId('menu-trigger'));
    press('ArrowDown');
    await flush();
    // The menu item is focused when the panel is requested, and gone once it shows.
    click(document.activeElement as HTMLElement);
    expect(query('[role="menu"]')).toBeNull();
    expect(byTestId('panel').contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(document.activeElement).toBe(byTestId('menu-trigger'));
  });

  it('respects a child that takes focus itself with autoFocus', () => {
    render(
      <Harness>
        <Button>One</Button>
        <input data-testid="auto" autoFocus />
      </Harness>,
    );
    openPanel();
    expect(document.activeElement).toBe(byTestId('auto'));
    press('Escape');
    // The opener was noted before the child took focus.
    expect(document.activeElement).toBe(byTestId('opener'));
  });
});

describe('useScrollLock', () => {
  it('locks page scrolling while enabled and counts together with kit dialogs', () => {
    function Both() {
      const [panel, setPanel] = useState(true);
      const [dialog, setDialog] = useState(true);
      return (
        <>
          {panel ? <Panel onClose={() => setPanel(false)} /> : null}
          <Dialog open={dialog} onOpenChange={setDialog} title="Details">
            <Button>Fine</Button>
          </Dialog>
        </>
      );
    }
    document.body.style.overflow = 'auto';
    render(<Both />);
    expect(document.body.style.overflow).toBe('hidden');
    press('Escape');
    expect(query('[role="dialog"][aria-labelledby]')).toBeNull();
    // The panel still holds its lock.
    expect(document.body.style.overflow).toBe('hidden');
    press('Escape');
    expect(document.body.style.overflow).toBe('auto');
  });

  it('does not lock for a docked overlay', () => {
    document.body.style.overflow = 'auto';
    render(<Panel modal={false} onClose={() => undefined} />);
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('useOutsidePress', () => {
  function Dismissable({ onOutsidePress }: { onOutsidePress: () => void }) {
    const toggle = useRef<HTMLButtonElement>(null);
    const [menu, setMenu] = useState(false);
    return (
      <>
        <Button ref={toggle} data-testid="toggle">
          Toggle
        </Button>
        <p data-testid="text">Plain text</p>
        <Panel
          modal={false}
          onClose={() => undefined}
          onOutsidePress={onOutsidePress}
          ignore={toggle}
        >
          <Button data-testid="inside">Inside</Button>
          <Popover
            open={menu}
            onOpenChange={setMenu}
            data-testid="nested"
            trigger={<Button data-testid="nested-trigger">More</Button>}
          >
            <Button data-testid="nested-action">Nested action</Button>
          </Popover>
        </Panel>
      </>
    );
  }

  it('reports a press outside, and only outside', async () => {
    const onOutsidePress = vi.fn();
    render(<Dismissable onOutsidePress={onOutsidePress} />);
    pointerDown(byTestId('inside'));
    pointerDown(byTestId('panel'));
    expect(onOutsidePress).not.toHaveBeenCalled();
    // The toggle that opened the overlay is on the ignore list.
    pointerDown(byTestId('toggle'));
    expect(onOutsidePress).not.toHaveBeenCalled();
    pointerDown(byTestId('text'));
    expect(onOutsidePress).toHaveBeenCalledTimes(1);
  });

  it('counts a kit popover opened from inside as inside, though it is portalled away', async () => {
    const onOutsidePress = vi.fn();
    render(<Dismissable onOutsidePress={onOutsidePress} />);
    click(byTestId('nested-trigger'));
    await flush();
    expect(byTestId('panel').contains(byTestId('nested'))).toBe(false);
    pointerDown(byTestId('nested-action'));
    expect(onOutsidePress).not.toHaveBeenCalled();
  });

  it('stops listening while disabled', () => {
    render(<Panel modal={false} onClose={() => undefined} />);
    expect(() => pointerDown(document.body)).not.toThrow();
  });
});

describe('OverlayProvider', () => {
  it('portals kit overlays opened inside into the given container', async () => {
    render(
      <Panel container onClose={() => undefined}>
        <DropdownMenu trigger={<Button data-testid="menu-trigger">More</Button>}>
          <MenuItem>Rename</MenuItem>
        </DropdownMenu>
      </Panel>,
    );
    click(byTestId('menu-trigger'));
    await flush();
    expect(byTestId('panel').contains(get('[role="menu"]'))).toBe(true);
  });

  it('portals to the body without a container', async () => {
    render(
      <Panel onClose={() => undefined}>
        <DropdownMenu trigger={<Button data-testid="menu-trigger">More</Button>}>
          <MenuItem>Rename</MenuItem>
        </DropdownMenu>
      </Panel>,
    );
    click(byTestId('menu-trigger'));
    await flush();
    expect(get('[role="menu"]').closest('.rd-popover')?.parentElement).toBe(document.body);
  });

  it('keeps the state of its children when the container arrives after the first render', () => {
    let mounts = 0;
    function Counter() {
      const [count, setCount] = useState(() => {
        mounts += 1;
        return 0;
      });
      return (
        <Button data-testid="counter" onClick={() => setCount(count + 1)}>
          {count}
        </Button>
      );
    }
    // `container` is the panel element: null on the first render, set on the second.
    render(
      <Panel container onClose={() => undefined}>
        <Counter />
      </Panel>,
    );
    click(byTestId('counter'));
    expect(byTestId('counter').textContent).toBe('1');
    expect(mounts).toBe(1);
  });
});
