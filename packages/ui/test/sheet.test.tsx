import { act, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  MenuItem,
  Sheet,
  type SheetProps,
  TextField,
} from '../src/index';
import { byTestId, click, flush, focus, get, press, query, render } from './helpers';

function Harness({
  onOpenChange,
  ...sheet
}: Partial<SheetProps> & { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean): void => {
    onOpenChange?.(next);
    setOpen(next);
  };
  return (
    <>
      <Button data-testid="opener" onClick={() => change(true)}>
        Snapshots
      </Button>
      <Button data-testid="elsewhere">Elsewhere</Button>
      <Sheet
        title="Snapshots"
        description="Named versions you can return to."
        data-testid="sheet"
        footer={
          <>
            <Button data-testid="cancel" onClick={() => change(false)}>
              Cancel
            </Button>
            <Button data-testid="save" variant="primary">
              Save snapshot
            </Button>
          </>
        }
        {...sheet}
        open={open}
        onOpenChange={change}
      >
        {sheet.children ?? <TextField label="Snapshot name" data-testid="name" />}
      </Sheet>
    </>
  );
}

function openSheet(): void {
  const opener = byTestId('opener');
  focus(opener);
  click(opener);
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(query('[role="dialog"]')).toBeNull();
    expect(query('.rd-sheet-layer')).toBeNull();
  });

  it('is a labelled, described modal dialog portalled to the body', () => {
    render(<Harness />);
    openSheet();
    const sheet = byTestId('sheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(sheet.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Snapshots');
    expect(title?.tagName).toBe('H2');
    const description = document.getElementById(sheet.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Named versions you can return to.');
    expect(get('.rd-sheet-layer').parentElement).toBe(document.body);
  });

  it('attaches to the end edge at medium width by default, and takes side and size', () => {
    const view = render(<Harness />);
    openSheet();
    expect(get('.rd-sheet-layer').className).toBe('rd-sheet-layer rd-sheet-layer--end');
    expect(byTestId('sheet').className).toBe('rd-sheet rd-sheet--md');
    view.unmount();

    render(<Harness side="bottom" size="lg" className="snapshots" />);
    openSheet();
    expect(get('.rd-sheet-layer').className).toBe('rd-sheet-layer rd-sheet-layer--bottom');
    expect(byTestId('sheet').className).toBe('rd-sheet rd-sheet--lg snapshots');
  });

  it('moves focus to the first control in the body, not to the close button', () => {
    render(<Harness />);
    openSheet();
    expect(document.activeElement).toBe(byTestId('name'));
  });

  it('honours data-autofocus, a ref and a function for initial focus', () => {
    const view = render(
      <Harness>
        <TextField label="One" />
        <TextField label="Two" data-testid="marked" data-autofocus="" />
      </Harness>,
    );
    openSheet();
    expect(document.activeElement).toBe(byTestId('marked'));
    view.unmount();

    function WithRef() {
      const target = useRef<HTMLInputElement>(null);
      return (
        <Harness initialFocus={target}>
          <TextField label="One" />
          <TextField label="Two" ref={target} data-testid="by-ref" />
        </Harness>
      );
    }
    const withRef = render(<WithRef />);
    openSheet();
    expect(document.activeElement).toBe(byTestId('by-ref'));
    withRef.unmount();

    render(<Harness initialFocus={() => query('[data-testid="save"]')} />);
    openSheet();
    expect(document.activeElement).toBe(byTestId('save'));
  });

  it('focuses the sheet itself when it has no controls', () => {
    render(
      <Sheet
        open
        onOpenChange={() => undefined}
        title="Working"
        dismissible={false}
        data-testid="sheet"
      >
        <p>Restoring the snapshot.</p>
      </Sheet>,
    );
    expect(document.activeElement).toBe(byTestId('sheet'));
  });

  it('keeps Tab inside', () => {
    render(<Harness />);
    openSheet();
    const close = get('.rd-sheet__close');
    focus(byTestId('save'));
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(close);
    expect(press('Tab', { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(byTestId('save'));
    act(() => byTestId('elsewhere').focus());
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it('closes on Escape, the close button and the backdrop, returning focus to the opener', () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    openSheet();
    expect(press('Escape')).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(query('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('opener'));

    openSheet();
    click(get('.rd-sheet__close'));
    expect(query('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('opener'));

    openSheet();
    click(get('.rd-sheet__backdrop'));
    expect(query('[role="dialog"]')).toBeNull();
  });

  it('does not close for a click that started inside and ended on the backdrop', () => {
    render(<Harness />);
    openSheet();
    act(() => {
      byTestId('name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      get('.rd-sheet__backdrop').dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 }),
      );
    });
    expect(query('[role="dialog"]')).not.toBeNull();
  });

  it('ignores Escape and the backdrop when dismissible is false, and still owns the key', () => {
    const onOpenChange = vi.fn();
    render(<Harness dismissible={false} onOpenChange={onOpenChange} />);
    openSheet();
    onOpenChange.mockClear();
    expect(press('Escape')).toBe(false);
    click(get('.rd-sheet__backdrop'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(query('.rd-sheet__close')).toBeNull();
  });

  it('locks page scrolling while open', () => {
    document.body.style.overflow = 'auto';
    render(<Harness />);
    openSheet();
    expect(document.body.style.overflow).toBe('hidden');
    press('Escape');
    expect(document.body.style.overflow).toBe('auto');
  });

  it('portals a menu opened inside into its own layer and closes it first on Escape', async () => {
    render(
      <Harness>
        <DropdownMenu trigger={<Button data-testid="menu-trigger">More</Button>}>
          <MenuItem>Rename</MenuItem>
        </DropdownMenu>
      </Harness>,
    );
    openSheet();
    click(byTestId('menu-trigger'));
    await flush();
    const menu = get('[role="menu"]');
    // In the sheet's fixed wrapper (so it stacks above), not inside the panel.
    expect(get('.rd-sheet-layer').contains(menu)).toBe(true);
    expect(byTestId('sheet').contains(menu)).toBe(false);
    press('Escape');
    expect(query('[role="menu"]')).toBeNull();
    expect(query('[data-testid="sheet"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="sheet"]')).toBeNull();
  });

  it('lets a confirmation opened from inside take over, then resumes', () => {
    function WithConfirm() {
      const [sheet, setSheet] = useState(true);
      const [confirm, setConfirm] = useState(false);
      return (
        <Sheet open={sheet} onOpenChange={setSheet} title="Snapshots" data-testid="sheet">
          <Button data-testid="restore" onClick={() => setConfirm(true)}>
            Restore
          </Button>
          <ConfirmDialog
            open={confirm}
            title="Restore this snapshot?"
            message="The document returns to this version."
            confirmLabel="Restore"
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
            data-testid="confirm"
          />
        </Sheet>
      );
    }
    render(<WithConfirm />);
    focus(byTestId('restore'));
    click(byTestId('restore'));
    // The confirmation lives in the sheet's layer, above the panel.
    expect(get('.rd-sheet-layer').contains(byTestId('confirm'))).toBe(true);
    expect(byTestId('confirm').contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(query('[data-testid="confirm"]')).toBeNull();
    expect(query('[data-testid="sheet"]')).not.toBeNull();
    expect(document.activeElement).toBe(byTestId('restore'));
    press('Escape');
    expect(query('[data-testid="sheet"]')).toBeNull();
  });
});
