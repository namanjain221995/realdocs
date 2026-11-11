import type { ComponentProps } from 'react';
import { cx } from './utils';

export interface LinkProps extends ComponentProps<'a'> {
  /**
   * `always` (the default) keeps the link underlined, which is what running
   * text needs: colour alone does not mark a link. `hover` underlines on
   * hover and focus only; use it where position already says "link", such as
   * a list of navigation links.
   */
  underline?: 'always' | 'hover';
  /** `neutral` takes the colour of the surrounding text instead of the accent. */
  tone?: 'accent' | 'neutral';
}

/**
 * A text link. Opt-in: the kit does not style bare `<a>` elements. The same
 * look is available as the class `rd-link` (with `rd-link--quiet` and
 * `rd-link--neutral`) for a router's own link component or for a `<button>`.
 */
export function Link({
  underline = 'always',
  tone = 'accent',
  className,
  target,
  rel,
  ...rest
}: LinkProps) {
  return (
    <a
      {...rest}
      target={target}
      // Links that open a new tab must not hand over `window.opener` or the referrer.
      rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
      className={cx(
        'rd-link',
        underline === 'hover' && 'rd-link--quiet',
        tone === 'neutral' && 'rd-link--neutral',
        className,
      )}
    />
  );
}
