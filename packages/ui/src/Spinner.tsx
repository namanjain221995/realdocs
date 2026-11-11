import type { ComponentProps } from 'react';
import { cx } from './utils';

export type SpinnerSize = 'sm' | 'md' | 'lg' | number;

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** `sm` 14px, `md` 18px, `lg` 28px, or a size in px. */
  size?: SpinnerSize;
  /**
   * Announced to assistive technology. Pass `null` when the surrounding
   * element already says what is loading.
   */
  label?: string | null;
}

const SPINNER_SIZES = { sm: 14, md: 18, lg: 28 } as const;

/** Indeterminate progress. Inherits the text colour. */
export function Spinner({
  size = 'md',
  label = 'Loading',
  className,
  style,
  ...rest
}: SpinnerProps) {
  const pixels = typeof size === 'number' ? size : SPINNER_SIZES[size];
  const decorative = label === null || label === '';
  return (
    <span
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative ? true : undefined}
      {...rest}
      className={cx('rd-spinner', className)}
      style={{ width: pixels, height: pixels, ...style }}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle className="rd-spinner__track" cx="12" cy="12" r="9" />
        <path className="rd-spinner__arc" d="M21 12a9 9 0 0 0-9-9" />
      </svg>
      {decorative ? null : <span className="rd-visually-hidden">{label}</span>}
    </span>
  );
}
