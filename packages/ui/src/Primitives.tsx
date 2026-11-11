import type { ComponentProps, CSSProperties } from 'react';
import { cx } from './utils';

/**
 * Content for assistive technology only. Inside a scroll container, give it a
 * positioned ancestor (`position: relative`) so it scrolls with the content.
 */
export function VisuallyHidden({ className, ...rest }: ComponentProps<'span'>) {
  return <span {...rest} className={cx('rd-visually-hidden', className)} />;
}

export interface CardProps extends ComponentProps<'div'> {
  /** Inner spacing: `none` 0, `sm` 12px, `md` 16px (default), `lg` 24px. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Lift the card off the page with a shadow. */
  raised?: boolean;
}

/** A bordered surface that groups related content. */
export function Card({ padding = 'md', raised = false, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={cx('rd-card', `rd-card--pad-${padding}`, raised && 'rd-card--raised', className)}
    />
  );
}

export interface DividerProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** `horizontal` by default. A vertical divider needs a parent with a height. */
  orientation?: 'horizontal' | 'vertical';
}

/** A hairline between sections. */
export function Divider({ orientation = 'horizontal', className, ...rest }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      {...rest}
      className={cx('rd-divider', `rd-divider--${orientation}`, className)}
    />
  );
}

export interface ScrollAreaProps extends ComponentProps<'div'> {
  /** Which way the content may scroll. Defaults to `y`. */
  axis?: 'x' | 'y' | 'both';
  /** Height limit, in px or any CSS length. */
  maxHeight?: number | string;
}

/**
 * An overflow container with the kit's slim scrollbars. Give it a `tabIndex`
 * and a label when its content has nothing focusable, so it can be scrolled
 * from the keyboard.
 */
export function ScrollArea({ axis = 'y', maxHeight, className, style, ...rest }: ScrollAreaProps) {
  const sizing: CSSProperties | undefined = maxHeight === undefined ? undefined : { maxHeight };
  return (
    <div
      {...rest}
      className={cx('rd-scroll-area', `rd-scroll-area--${axis}`, className)}
      style={sizing ? { ...sizing, ...style } : style}
    />
  );
}

/** A keyboard key, for shortcut hints. */
export function Kbd({ className, ...rest }: ComponentProps<'kbd'>) {
  return <kbd {...rest} className={cx('rd-kbd', className)} />;
}
