import type { ComponentProps, ReactNode } from 'react';
import { Spinner } from './Spinner';
import { Tooltip, type TooltipSide } from './Tooltip';
import { cx } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';
export type IconButtonVariant = 'ghost' | 'solid' | 'danger';

interface ButtonAppearance {
  /** `secondary` by default. Use one `primary` per view. */
  variant?: ButtonVariant;
  /** `md` is 32px tall, `sm` 28px. */
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** Stretch to the width of the container. */
  fullWidth?: boolean;
}

export interface ButtonProps extends ComponentProps<'button'>, ButtonAppearance {
  /** Shows a spinner and ignores clicks while keeping focus and width. */
  loading?: boolean;
  /**
   * Makes this a toggle button: sets `aria-pressed` and, while true, shows
   * the pressed style. Passing `aria-pressed` yourself works the same way.
   */
  pressed?: boolean;
}

export interface LinkButtonProps extends ComponentProps<'a'>, ButtonAppearance {}

export interface IconButtonProps extends ComponentProps<'button'> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  /** The icon. `children` works too. */
  icon?: ReactNode;
  /** Makes this a toggle button and sets `aria-pressed`. */
  pressed?: boolean;
  size?: ButtonSize;
  /** `ghost` by default. */
  variant?: IconButtonVariant;
  /** Replaces the tooltip text, or `false` to show none. */
  tooltip?: ReactNode | false;
  tooltipSide?: TooltipSide;
}

function buttonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean,
  className: string | undefined,
): string {
  return cx(
    'rd-btn',
    `rd-btn--${variant}`,
    `rd-btn--${size}`,
    fullWidth && 'rd-btn--full',
    className,
  );
}

function ButtonContent({
  iconLeft,
  iconRight,
  children,
}: {
  iconLeft: ReactNode;
  iconRight: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {iconLeft ? <span className="rd-btn__icon">{iconLeft}</span> : null}
      {children !== undefined && children !== null && children !== false ? (
        <span className="rd-btn__label">{children}</span>
      ) : null}
      {iconRight ? <span className="rd-btn__icon">{iconRight}</span> : null}
    </>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  pressed,
  iconLeft,
  iconRight,
  fullWidth = false,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      aria-pressed={pressed}
      {...rest}
      type={type}
      className={buttonClassName(variant, size, fullWidth, className)}
      // `aria-disabled` rather than `disabled` so focus is not lost mid-action.
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      data-loading={loading ? '' : undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading ? <Spinner className="rd-btn__spinner" size="sm" label={null} /> : null}
      <ButtonContent iconLeft={iconLeft} iconRight={iconRight}>
        {children}
      </ButtonContent>
    </button>
  );
}

/** An anchor that looks like a button. Use it for navigation and downloads. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = false,
  className,
  children,
  target,
  rel,
  ...rest
}: LinkButtonProps) {
  return (
    <a
      {...rest}
      target={target}
      // Links that open a new tab must not hand over `window.opener` or the referrer.
      rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
      className={buttonClassName(variant, size, fullWidth, className)}
    >
      <ButtonContent iconLeft={iconLeft} iconRight={iconRight}>
        {children}
      </ButtonContent>
    </a>
  );
}

/** A square, icon-only button. `label` names it for assistive technology. */
export function IconButton({
  label,
  icon,
  pressed,
  size = 'md',
  variant = 'ghost',
  tooltip,
  tooltipSide,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx('rd-icon-btn', `rd-icon-btn--${variant}`, `rd-icon-btn--${size}`, className)}
    >
      {icon ?? children}
    </button>
  );
  if (tooltip === false) return button;
  const custom = tooltip !== undefined && tooltip !== null && tooltip !== label;
  return (
    <Tooltip content={custom ? tooltip : label} side={tooltipSide} describe={custom}>
      {button}
    </Tooltip>
  );
}
