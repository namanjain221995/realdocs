import { cx } from '@realtimedocs/ui';
import { Link } from 'react-router';
import { APP_NAME } from '../lib/hooks';

/** Three lines of text with a caret after the last one: someone is typing. */
export function BrandMark({ className, blink = false }: { className?: string; blink?: boolean }) {
  return (
    <svg
      className={cx('app-brand__mark', className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="4" width="12" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="2" y="10.7" width="20" height="2.6" rx="1.3" fill="currentColor" />
      <rect x="2" y="17.4" width="8" height="2.6" rx="1.3" fill="currentColor" />
      <rect
        className={cx('app-brand__caret', blink && 'app-brand__caret--blink')}
        x="12.4"
        y="15"
        width="2.8"
        height="7.4"
        rx="1.4"
      />
    </svg>
  );
}

export interface BrandProps {
  /** Where the wordmark links to. `null` renders it as plain text. */
  to?: string | null;
  size?: 'md' | 'lg';
  /** Blink the caret a few times when the mark first appears. */
  blink?: boolean;
  className?: string;
}

export function Brand({ to = '/', size = 'md', blink = false, className }: BrandProps) {
  const content = (
    <>
      <BrandMark blink={blink} />
      <span className="app-brand__name">{APP_NAME}</span>
    </>
  );
  const classes = cx('app-brand', size === 'lg' && 'app-brand--lg', className);
  if (to === null) return <span className={classes}>{content}</span>;
  return (
    <Link to={to} className={classes} aria-label={`${APP_NAME} home`}>
      {content}
    </Link>
  );
}
