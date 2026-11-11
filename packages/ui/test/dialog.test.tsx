import { act, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  ConfirmDialog,
  CopyField,
  Dialog,
  DropdownMenu,
  MenuItem,
  TextField,
} from '../src/index';
import { byTestId, click, flush, focus, get, getAll, press, query, render } from './helpers';

function ShareDialogHarness({
  dismissible = true,
  onOpenChange,
}: {
  dismissible?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean): void => {
    onOpenChange?.(next);
    setOpen(next);
  };
  return (
    <>
      <Button data-testid="opener" onClick={() => change(true)}>
        Share
      </Button>
      <Button data-testid="elsewhere">Elsewhere</Button>
      <Dialog
        open={open}
        onOpenChange={change}
        title="Share document"
        description="Anyone with the link can view."
        dismissible={dismissible}
        data-testid="dialog"
        footer={
          <>
            <Button data-testid="cancel" onClick={() => change(false)}>
              Cancel
            </Button>
            <Button data-testid="create" variant="primary">
              Create link
            </Button>
          </>
        }
      >
        <TextField label="Link name" data-testid="name" />
      </Dialog>
    </>
  );
}

function openDialog(): void {
  const opener = byTestId('opener');
  focus(opener);
  click(opener);
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<ShareDialogHarness />);
    expect(query('[role="dialog"]')).toBeNull();
  });

  it('is a labelled, described modal dialog', () => {
    render(<ShareDialogHarness />);
    openDialog();
    const dialog = byTestId('dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Share document');
    expect(title?.tagName).toBe('H2');
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Anyone with the link can view.');
  });

  it('moves focus to the first control in the body on open', () => {
    render(<ShareDialogHarness />);
    openDialog();
    expect(document.activeElement).toBe(byTestId('name'));
  });

  it('honours [data-autofocus] and the initialFocus ref', () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Rename">
        <TextField label="First" />
        <TextField label="Second" data-testid="second" data-autofocus="" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(byTestId('second'));
  });

  it('takes initial focus from a ref or from a function', () => {
    function WithRef() {
      const target = useRef<HTMLInputElement>(null);
      return (
        <Dialog open onOpenChange={() => undefined} title="Rename" initialFocus={target}>
          <TextField label="First" />
          <TextField label="Second" ref={target} data-testid="second" />
        </Dialog>
      );
    }
    const view = render(<WithRef />);
    expect(document.activeElement).toBe(byTestId('second'));
    view.unmount();

    // The function runs once the dialog is in the DOM, so it can query it.
    render(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Link created"
        data-testid="dialog"
        initialFocus={() => query('[data-testid="dialog"]')}
      >
        <TextField label="First" data-testid="first" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(byTestId('dialog'));
  });

  it('falls back to the usual order when initialFocus yields nothing', () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Rename" initialFocus={() => null}>
        <TextField label="First" data-testid="first" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(byTestId('first'));
  });

  it('focuses a copy field that comes first without selecting its text', () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Link created">
        <CopyField label="Share link" value="https://docs.example.test/s/abc" data-testid="link" />
      </Dialog>,
    );
    const input = byTestId<HTMLInputElement>('link');
    // Default focus is unchanged: the first control in the body.
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.selectionEnd);
  });

  it('focuses the dialog itself when it has no controls', () => {
    render(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Working"
        dismissible={false}
        data-testid="dialog"
      >
        <p>Restoring the snapshot.</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(byTestId('dialog'));
  });

  it('keeps Tab inside: forward from the last control wraps to the first', () => {
    render(<ShareDialogHarness />);
    openDialog();
    const close = get('.rd-dialog__close');
    const create = byTestId('create');
    focus(create);
    const allowed = press('Tab');
    expect(allowed).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it('keeps Shift+Tab inside: backward from the first control wraps to the last', () => {
    render(<ShareDialogHarness />);
    openDialog();
    focus(get('.rd-dialog__close'));
    const allowed = press('Tab', { shiftKey: true });
    expect(allowed).toBe(false);
    expect(document.activeElement).toBe(byTestId('create'));
  });

  it('leaves Tab alone between controls in the middle', () => {
    render(<ShareDialogHarness />);
    openDialog();
    focus(byTestId('name'));
    expect(press('Tab')).toBe(true);
  });

  it('pulls focus back in when it escaped to the page behind', () => {
    render(<ShareDialogHarness />);
    openDialog();
    // Bypass act-wrapped helpers: simulate focus landing outside by other means.
    act(() => byTestId('elsewhere').focus());
    expect(document.activeElement).toBe(byTestId('elsewhere'));
    expect(press('Tab')).toBe(false);
    expect(document.activeElement).toBe(get('.rd-dialog__close'));
    act(() => byTestId('elsewhere').focus());
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(byTestId('create'));
  });

  it('closes on Escape and returns focus to the element that opened it', () => {
    const onOpenChange = vi.fn();
    render(<ShareDialogHarness onOpenChange={onOpenChange} />);
    openDialog();
    expect(query('[role="dialog"]')).not.toBeNull();
    press('Escape');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(query('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('opener'));
  });

  it('closes from the close button and from a press on the backdrop', () => {
    render(<ShareDialogHarness />);
    openDialog();
    click(get('.rd-dialog__close'));
    expect(query('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('opener'));

    openDialog();
    click(get('.rd-dialog__backdrop'));
    expect(query('[role="dialog"]')).toBeNull();
  });

  it('does not close when a click ends on the backdrop but started inside', () => {
    render(<ShareDialogHarness />);
    openDialog();
    const backdrop = get('.rd-dialog__backdrop');
    act(() => {
      byTestId('name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(query('[role="dialog"]')).not.toBeNull();
  });

  it('ignores Escape and the backdrop when dismissible is false, and shows no close button', () => {
    const onOpenChange = vi.fn();
    render(<ShareDialogHarness dismissible={false} onOpenChange={onOpenChange} />);
    openDialog();
    onOpenChange.mockClear();
    press('Escape');
    click(get('.rd-dialog__backdrop'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(query('[role="dialog"]')).not.toBeNull();
    expect(query('.rd-dialog__close')).toBeNull();
  });

  it('does not close on Escape pressed during IME composition', () => {
    const onOpenChange = vi.fn();
    render(<ShareDialogHarness onOpenChange={onOpenChange} />);
    openDialog();
    onOpenChange.mockClear();
    press('Escape', { isComposing: true });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('locks page scroll while open and restores it after', () => {
    document.body.style.overflow = 'scroll';
    render(<ShareDialogHarness />);
    openDialog();
    expect(document.body.style.overflow).toBe('hidden');
    press('Escape');
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('only closes the top-most of two stacked dialogs', () => {
    function Stacked() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <Dialog open={outer} onOpenChange={setOuter} title="Outer" data-testid="outer">
          <Button>Outer action</Button>
          <Dialog open={inner} onOpenChange={setInner} title="Inner" data-testid="inner">
            <Button data-testid="inner-action">Inner action</Button>
          </Dialog>
        </Dialog>
      );
    }
    render(<Stacked />);
    expect(document.activeElement).toBe(byTestId('inner-action'));
    press('Escape');
    expect(query('[data-testid="inner"]')).toBeNull();
    expect(query('[data-testid="outer"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="outer"]')).toBeNull();
  });

  it('Escape closes a menu opened inside the dialog before the dialog itself', async () => {
    function WithMenu() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen} title="Document" data-testid="dialog">
          <DropdownMenu trigger={<Button data-testid="menu-trigger">More</Button>}>
            <MenuItem>Rename</MenuItem>
          </DropdownMenu>
        </Dialog>
      );
    }
    render(<WithMenu />);
    click(byTestId('menu-trigger'));
    await flush();
    const menu = get('[role="menu"]');
    // The menu is portalled into the dialog's layer, so it stacks above it.
    expect(get('.rd-dialog-layer').contains(menu)).toBe(true);
    press('Escape');
    expect(query('[role="menu"]')).toBeNull();
    expect(query('[data-testid="dialog"]')).not.toBeNull();
    press('Escape');
    expect(query('[data-testid="dialog"]')).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  it('is an alertdialog described by its message', () => {
    render(
      <ConfirmDialog
        title="Revoke this link?"
        message="People using it are disconnected."
        confirmLabel="Revoke link"
        onConfirm={() => undefined}
        onCancel={() => undefined}
        data-testid="confirm"
      />,
    );
    const dialog = byTestId('confirm');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('People using it are disconnected.');
  });

  it('shows optional detail under the message, without changing what is announced or focused', () => {
    render(
      <ConfirmDialog
        title="Move 2 documents to the trash?"
        message="You can restore them for 30 days."
        confirmLabel="Move to trash"
        danger
        onConfirm={() => undefined}
        onCancel={() => undefined}
        data-testid="confirm"
      >
        <ul data-testid="detail">
          <li>
            <a href="#notes">Quarterly planning notes</a>
          </li>
          <li>Roadmap</li>
        </ul>
      </ConfirmDialog>,
    );
    const dialog = byTestId('confirm');
    // The message is still the dialog's description, in its own paragraph.
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(description?.tagName).toBe('P');
    expect(description?.textContent).toBe('You can restore them for 30 days.');
    // The detail sits in the body: after the message, before the buttons.
    expect(get('.rd-dialog__body').contains(byTestId('detail'))).toBe(true);
    const order = getAll(
      '[data-testid="confirm"] .rd-dialog__description, [data-testid="detail"], [data-testid="confirm"] .rd-dialog__footer',
    ).map((element) => element.className || element.dataset.testid);
    expect(order).toEqual(['rd-dialog__description', 'detail', 'rd-dialog__footer']);
    // A link in the detail does not take the initial focus away from Cancel.
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('renders no body at all without detail', () => {
    render(
      <ConfirmDialog
        title="Revoke?"
        message="Really?"
        confirmLabel="Revoke"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(query('.rd-dialog__body')).toBeNull();
  });

  it('reports a failure below the detail', async () => {
    render(
      <ConfirmDialog
        title="Revoke?"
        message="Really?"
        confirmLabel="Revoke"
        onConfirm={() => Promise.reject(new Error('The server did not respond.'))}
        onCancel={() => undefined}
      >
        <p data-testid="detail">Review link, created 12 March</p>
      </ConfirmDialog>,
    );
    click(get('.rd-btn--primary'));
    await flush();
    const body = get('.rd-dialog__body');
    expect(Array.from(body.children).map((child) => child.textContent)).toEqual([
      'Review link, created 12 March',
      'The server did not respond.',
    ]);
    expect(get('[role="alert"]').className).toBe('rd-dialog__failure');
  });

  it('puts initial focus on Cancel for destructive actions and on confirm otherwise', () => {
    const view = render(
      <ConfirmDialog
        title="Delete forever?"
        message="This cannot be undone."
        confirmLabel="Delete forever"
        danger
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(document.activeElement?.textContent).toBe('Cancel');
    view.unmount();
    render(
      <ConfirmDialog
        title="Restore snapshot?"
        message="The document returns to this version."
        confirmLabel="Restore"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(document.activeElement?.textContent).toBe('Restore');
  });

  it('calls onCancel for Cancel, Escape and the backdrop', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Revoke?"
        message="Really?"
        confirmLabel="Revoke"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    press('Escape');
    click(get('.rd-dialog__backdrop'));
    click(get('.rd-dialog__footer .rd-btn--ghost'));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('shows progress for an async confirm and blocks dismissal until it settles', async () => {
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Revoke?"
        message="Really?"
        confirmLabel="Revoke"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const confirm = get('.rd-btn--danger');
    const cancel = get<HTMLButtonElement>('.rd-dialog__footer .rd-btn--ghost');
    click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(cancel.disabled).toBe(true);

    // A second click, Escape and the backdrop are all ignored while pending.
    click(confirm);
    press('Escape');
    click(get('.rd-dialog__backdrop'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(query('.rd-dialog__close')).toBeNull();

    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(confirm.getAttribute('aria-busy')).toBeNull();
    expect(cancel.disabled).toBe(false);
  });

  it('keeps the dialog open and reports the reason when confirm rejects', async () => {
    render(
      <ConfirmDialog
        title="Revoke?"
        message="Really?"
        confirmLabel="Revoke"
        onConfirm={() => Promise.reject(new Error('The server did not respond.'))}
        onCancel={() => undefined}
      />,
    );
    click(get('.rd-btn--primary'));
    await flush();
    const alert = get('[role="alert"]');
    expect(alert.textContent).toBe('The server did not respond.');
    expect(get('.rd-btn--primary').getAttribute('aria-busy')).toBeNull();
    expect(query('[role="alertdialog"]')).not.toBeNull();
  });

  it('unmounts cleanly when closed by its parent while confirm is pending', async () => {
    let resolve: () => void = () => undefined;
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Button data-testid="force-close" onClick={() => setOpen(false)}>
            Close
          </Button>
          <ConfirmDialog
            open={open}
            title="Revoke?"
            message="Really?"
            confirmLabel="Revoke"
            onConfirm={() =>
              new Promise<void>((done) => {
                resolve = done;
              })
            }
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Harness />);
    click(get('.rd-btn--primary'));
    click(byTestId('force-close'));
    expect(query('[role="alertdialog"]')).toBeNull();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(errors).not.toHaveBeenCalled();
  });
});
