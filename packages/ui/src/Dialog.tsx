import { X } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';
import {
  focusElement,
  type FocusTarget,
  getActiveElement,
  getTabbable,
  resolveFocusTarget,
  trapTabKey,
} from './internal/focus';
import { useIsomorphicLayoutEffect, useLatest, useMergedRefs } from './internal/hooks';
import {
  isTopModal,
  LayerContext,
  lockScroll,
  PortalContext,
  pushModal,
  useLayer,
  usePortalContainer,
} from './internal/layers';
import { cx } from './utils';

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps extends Omit<ComponentProps<'div'>, 'title' | 'role'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dialog. Rendered as its heading. */
  title: ReactNode;
  /** One or two sentences under the title, announced with it. */
  description?: ReactNode;
  /** Actions, right-aligned. Put the main action last. */
  footer?: ReactNode;
  /** `sm` 380px, `md` 520px (default), `lg` 720px. Never wider than the screen. */
  size?: DialogSize;
  /**
   * Whether Escape, a press on the backdrop and the close button dismiss the
   * dialog. Turn off while an action is in flight. Defaults to true.
   */
  dismissible?: boolean;
  /**
   * Where focus goes on open: a ref, or a function that returns the element
   * (called once the dialog is in the DOM). Without it, or when it yields
   * nothing: `[data-autofocus]`, then the first control in the body, then the
   * first one in the footer.
   */
  initialFocus?: FocusTarget;
  /** Accessible name of the close button. Defaults to `Close`. */
  closeLabel?: string;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
}

/**
 * A modal dialog. Focus moves in on open, Tab cycles inside it, and focus
 * returns to where it was when the dialog closes.
 */
export function Dialog({ open, ...rest }: DialogProps) {
  // Mounted only while open, so each opening starts from a clean state.
  return open ? <DialogSurface {...rest} /> : null;
}

function DialogSurface({
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  dismissible = true,
  initialFocus,
  closeLabel = 'Close',
  role = 'dialog',
  className,
  children,
  ref,
  ...rest
}: Omit<DialogProps, 'open'>) {
  const container = usePortalContainer();
  const [layerElement, setLayerElement] = useState<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mergedPanelRef = useMergedRefs<HTMLDivElement>(ref, panelRef);
  // Captured during render: `autoFocus` children take focus before effects run.
  const [focusedBefore] = useState(getActiveElement);
  const [modalId] = useState(() => Symbol('rd-dialog'));
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  const onOpenChangeRef = useLatest(onOpenChange);
  const dismissibleRef = useLatest(dismissible);
  const initialFocusRef = useLatest(initialFocus);

  const layer = useLayer(layerElement, (event) => {
    // The top-most modal owns Escape even when it refuses to close.
    event.preventDefault();
    if (dismissibleRef.current) onOpenChangeRef.current(false);
  });

  useEffect(() => lockScroll(), []);

  // Move focus in on open and hand it back on close.
  useIsomorphicLayoutEffect(() => {
    const panel = panelRef.current;
    if (!layerElement || !panel) return;
    const active = getActiveElement();
    const focusedAtMount = active && !panel.contains(active) ? active : null;
    if (!active || !panel.contains(active)) {
      const requested = resolveFocusTarget(initialFocusRef.current);
      const marked = panel.querySelector<HTMLElement>('[data-autofocus]');
      const body = panel.querySelector<HTMLElement>('.rd-dialog__body');
      const footerElement = panel.querySelector<HTMLElement>('.rd-dialog__footer');
      focusElement(
        requested ??
          marked ??
          (body ? getTabbable(body)[0] : undefined) ??
          (footerElement ? getTabbable(footerElement)[0] : undefined) ??
          panel,
      );
    }
    return () => {
      // The element focused before may be gone (a menu item that opened us).
      const target = [focusedBefore, focusedAtMount].find((element) => element?.isConnected);
      focusElement(target);
    };
  }, [layerElement, focusedBefore, initialFocusRef]);

  // Keep Tab inside the dialog while it is the top-most modal.
  useEffect(() => {
    if (!layerElement) return;
    const release = pushModal(modalId);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTopModal(modalId)) trapTabKey(event, layerElement, panelRef.current);
    };
    // Bubble phase: a popover inside the dialog handles its own Tab first.
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      release();
    };
  }, [layerElement, modalId]);

  if (!container) return null;
  return createPortal(
    <div ref={setLayerElement} className="rd-dialog-layer">
      {/*
        The content renders once the layer element exists (same frame, before
        paint), so overlays inside the dialog always portal into this layer.
      */}
      {layerElement ? (
        <PortalContext value={layerElement}>
          <LayerContext value={layer}>
            <div
              className="rd-dialog__backdrop"
              onPointerDown={(event) => {
                pressStartedOnBackdrop.current = event.target === event.currentTarget;
              }}
              onClick={(event) => {
                // Ignore a drag that started inside the dialog and ended out here.
                const pressed = pressStartedOnBackdrop.current;
                pressStartedOnBackdrop.current = false;
                if (pressed && event.target === event.currentTarget && dismissible) {
                  onOpenChange(false);
                }
              }}
            />
            <div
              {...rest}
              ref={mergedPanelRef}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descriptionId : undefined}
              tabIndex={-1}
              className={cx('rd-dialog', `rd-dialog--${size}`, className)}
            >
              <header className="rd-dialog__header">
                <h2 id={titleId} className="rd-dialog__title">
                  {title}
                </h2>
                {dismissible ? (
                  <IconButton
                    label={closeLabel}
                    size="sm"
                    className="rd-dialog__close"
                    onClick={() => onOpenChange(false)}
                  >
                    <X />
                  </IconButton>
                ) : null}
              </header>
              {description ? (
                <p id={descriptionId} className="rd-dialog__description">
                  {description}
                </p>
              ) : null}
              {children !== undefined && children !== null && children !== false ? (
                <div className="rd-dialog__body">{children}</div>
              ) : null}
              {footer ? <footer className="rd-dialog__footer">{footer}</footer> : null}
            </div>
          </LayerContext>
        </PortalContext>
      ) : null}
    </div>,
    container,
  );
}

export interface ConfirmDialogProps extends Omit<
  DialogProps,
  'open' | 'onOpenChange' | 'title' | 'description' | 'footer' | 'role'
> {
  /** Defaults to true, so the dialog can also be rendered conditionally. */
  open?: boolean;
  /** The question, for example `Revoke this link?`. */
  title: ReactNode;
  /** What will happen, and whether it can be undone. Announced with the title. */
  message: ReactNode;
  /**
   * Optional detail shown under the message, such as the list of things the
   * action affects. Initial focus stays on the buttons.
   */
  children?: ReactNode;
  /** Names the action, matching the title: `Revoke link`. */
  confirmLabel: ReactNode;
  /** Defaults to `Cancel`. */
  cancelLabel?: ReactNode;
  /** Styles the action as destructive and puts initial focus on Cancel. */
  danger?: boolean;
  /**
   * Runs the action. Return a promise to show progress on the button and
   * block dismissal until it settles; a rejection is shown inside the dialog.
   * Close the dialog yourself once it resolves.
   */
  onConfirm: () => unknown;
  /** Called for Cancel, Escape, the close button and a press on the backdrop. */
  onCancel: () => void;
}

/** Asks the user to confirm one action before it runs. */
export function ConfirmDialog({ open = true, ...rest }: ConfirmDialogProps) {
  return open ? <ConfirmDialogSurface {...rest} /> : null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function ConfirmDialogSurface({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
  size = 'sm',
  children,
  ...rest
}: Omit<ConfirmDialogProps, 'open'>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = (): void => {
    if (pending) return;
    const result = onConfirm();
    if (!isPromiseLike(result)) return;
    setPending(true);
    setFailure(null);
    result.then(
      () => {
        if (mounted.current) setPending(false);
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setPending(false);
        setFailure(
          error instanceof Error && error.message ? error.message : 'That did not work. Try again.',
        );
      },
    );
  };

  const hasDetail = children !== undefined && children !== null && children !== false;

  return (
    <Dialog
      {...rest}
      open
      role="alertdialog"
      size={size}
      title={title}
      description={message}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
            data-autofocus={danger ? '' : undefined}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            onClick={confirm}
            data-autofocus={danger ? undefined : ''}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {hasDetail || failure ? (
        <>
          {hasDetail ? children : null}
          {failure ? (
            <p role="alert" className="rd-dialog__failure">
              {failure}
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
