import { LinkButton, type LinkButtonProps } from '@realtimedocs/ui';
import type { MouseEvent } from 'react';
import { type To, useHref, useLinkClickHandler } from 'react-router';

export interface RouterLinkOptions {
  replace?: boolean;
  state?: unknown;
}

/**
 * `href` and `onClick` for an anchor rendered by something other than
 * `<Link>` (a kit `LinkButton` or `MenuItem`). Plain clicks navigate inside
 * the app; modified clicks keep the browser's behaviour (new tab, new window).
 */
export function useRouterLink(
  to: To,
  options: RouterLinkOptions = {},
): {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
} {
  const href = useHref(to);
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to, options);
  return { href, onClick };
}

export interface RouterLinkButtonProps extends Omit<LinkButtonProps, 'href'>, RouterLinkOptions {
  to: To;
}

/** A kit button that navigates inside the app. */
export function RouterLinkButton({ to, replace, state, onClick, ...rest }: RouterLinkButtonProps) {
  const link = useRouterLink(to, { replace, state });
  return (
    <LinkButton
      {...rest}
      href={link.href}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) link.onClick(event);
      }}
    />
  );
}
