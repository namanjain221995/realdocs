import { cx } from '@realtimedocs/ui';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { ThemeControl } from './ThemeControl';

export interface PublicShellProps {
  children: ReactNode;
  /** `narrow` for forms, `wide` for messages with more text. */
  width?: 'narrow' | 'wide';
  /** Where the wordmark links to; `null` (default) renders it as plain text. */
  brandTo?: string | null;
  /** Blink the brand caret on first appearance (the sign-in screen). */
  blink?: boolean;
}

/**
 * Frame for screens outside the signed-in app: sign-in, invitations, share
 * links and full-page errors. No navigation, because the visitor may have no
 * account at all.
 */
export function PublicShell({
  children,
  width = 'narrow',
  brandTo = null,
  blink = false,
}: PublicShellProps) {
  return (
    <div className="app-public">
      <header className="app-public__bar">
        <Brand to={brandTo} blink={blink} />
        <ThemeControl compact />
      </header>
      <main id="main" tabIndex={-1} className="app-public__main">
        <div className={cx('app-public__column', width === 'wide' && 'app-public__column--wide')}>
          {children}
        </div>
      </main>
    </div>
  );
}
