import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  TriangleExclamationPoint,
  X,
} from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { IconButton } from './Button';
import { cx } from './utils';

/** Colour roles shared by badges, status dots, banners and toasts. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

function hasText(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** The icon that stands for a tone, or null where a tone has none. */
export function ToneIcon({ tone }: { tone: Tone }) {
  switch (tone) {
    case 'success':
      return <CircleCheck />;
    case 'warning':
      return <TriangleExclamationPoint />;
    case 'danger':
      return <CircleExclamationPoint />;
    case 'info':
    case 'accent':
      return <Info />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ Badge */

export interface BadgeProps extends ComponentProps<'span'> {
  /** `neutral` by default. */
  tone?: Tone;
  icon?: ReactNode;
}

/** A short label for a state or a count, such as a role or `Expired`. */
export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx('rd-badge', `rd-tone-${tone}`, className)}>
      {icon ? (
        <span className="rd-badge__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- StatusDot */

export interface StatusDotProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** `neutral` by default. Green for live or saved, amber for reconnecting, red for offline. */
  tone?: Tone;
  /** Ripple around the dot while something is in progress or live. */
  pulse?: boolean;
  /** The state in words. Colour alone does not carry meaning. */
  label?: ReactNode;
}

/** A coloured dot with the state written next to it. */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  label,
  className,
  ...rest
}: StatusDotProps) {
  return (
    <span {...rest} className={cx('rd-status', `rd-tone-${tone}`, className)}>
      <span className="rd-status__dot" data-pulse={pulse ? '' : undefined} aria-hidden="true" />
      {hasText(label) ? <span className="rd-status__label">{label}</span> : null}
    </span>
  );
}

/* --------------------------------------------------------------- Skeleton */

export interface SkeletonProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** In px or any CSS length. Defaults to the full width. */
  width?: number | string;
  /** In px or any CSS length. Defaults to one line of text. */
  height?: number | string;
  /** Render this many text lines; the last one is shorter. */
  lines?: number;
  /** A circle, for avatars. */
  circle?: boolean;
}

/** A placeholder in the shape of content that is still loading. */
export function Skeleton({
  width,
  height,
  lines,
  circle = false,
  className,
  style,
  ...rest
}: SkeletonProps) {
  if (lines !== undefined && lines > 1) {
    const sizing: CSSProperties = { width, ...style };
    return (
      <span
        {...rest}
        aria-hidden="true"
        className={cx('rd-skeleton-lines', className)}
        style={sizing}
      >
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className="rd-skeleton"
            style={{ height, width: index === lines - 1 ? '62%' : undefined }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      {...rest}
      aria-hidden="true"
      className={cx('rd-skeleton', circle && 'rd-skeleton--circle', className)}
      style={{ width, height, ...style }}
    />
  );
}

/* ------------------------------------------------- EmptyState, ErrorState */

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface StateTexts {
  /** What is (or is not) here, in a few words. */
  title: ReactNode;
  /** What the user can do about it. */
  description?: ReactNode;
  /** A button or link for the next step. */
  action?: ReactNode;
  /** Heading level of the title, to fit the page outline. Defaults to 2. */
  headingLevel?: HeadingLevel;
  /** Tighter spacing and left alignment, for panels and side sheets. */
  compact?: boolean;
}

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'>, StateTexts {
  icon?: ReactNode;
}

/** Shown where a list or page has no content yet. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 2,
  compact = false,
  className,
  ...rest
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div {...rest} className={cx('rd-state', compact && 'rd-state--compact', className)}>
      {icon ? (
        <div className="rd-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <Heading className="rd-state__title">{title}</Heading>
      {hasText(description) ? <p className="rd-state__description">{description}</p> : null}
      {hasText(action) ? <div className="rd-state__action">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends Omit<ComponentProps<'div'>, 'title'>, StateTexts {
  /** A code support can search for, such as `LINK_REVOKED`. */
  code?: ReactNode;
  /** Replaces the default warning icon. */
  icon?: ReactNode;
}

/** Shown where content could not be loaded or the user has no access. */
export function ErrorState({
  icon,
  title,
  description,
  code,
  action,
  headingLevel = 2,
  compact = false,
  className,
  ...rest
}: ErrorStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      role="alert"
      {...rest}
      className={cx('rd-state', 'rd-state--error', compact && 'rd-state--compact', className)}
    >
      <div className="rd-state__icon" aria-hidden="true">
        {icon ?? <TriangleExclamationPoint />}
      </div>
      <Heading className="rd-state__title">{title}</Heading>
      {hasText(description) ? <p className="rd-state__description">{description}</p> : null}
      {hasText(code) ? <code className="rd-state__code">{code}</code> : null}
      {hasText(action) ? <div className="rd-state__action">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Banner */

export interface BannerProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** `info` by default. */
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button or link at the end of the message. */
  action?: ReactNode;
  /** Shows a dismiss button and is called when it is pressed. */
  onDismiss?: () => void;
  /** Replaces the tone's icon, or `false` to show none. */
  icon?: ReactNode | false;
  /** Accessible name of the dismiss button. Defaults to `Dismiss`. */
  dismissLabel?: string;
}

/** A message that stays in the page: a warning, a notice, a lost connection. */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  icon,
  dismissLabel = 'Dismiss',
  className,
  ...rest
}: BannerProps) {
  // The neutral tone has no icon of its own.
  const showIcon = icon !== false && (icon !== undefined || tone !== 'neutral');
  return (
    <div
      // Problems interrupt; everything else waits for a pause in speech.
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      {...rest}
      className={cx('rd-banner', `rd-tone-${tone}`, className)}
    >
      {showIcon ? (
        <span className="rd-banner__icon" aria-hidden="true">
          {icon ?? <ToneIcon tone={tone} />}
        </span>
      ) : null}
      <div className="rd-banner__content">
        {hasText(title) ? <p className="rd-banner__title">{title}</p> : null}
        {hasText(children) ? <div className="rd-banner__body">{children}</div> : null}
      </div>
      {hasText(action) ? <div className="rd-banner__action">{action}</div> : null}
      {onDismiss ? (
        <IconButton
          label={dismissLabel}
          size="sm"
          className="rd-banner__dismiss"
          onClick={onDismiss}
        >
          <X />
        </IconButton>
      ) : null}
    </div>
  );
}
