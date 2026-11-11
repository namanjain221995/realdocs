import { useEffect, useRef, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigation } from 'react-router';
import { useSession } from '../lib/session';
import { ErrorView } from './ErrorScreen';
import { PublicShell } from './PublicShell';
import { SignOutProvider } from './SignOut';
import { Splash } from './Splash';

/**
 * Moves keyboard focus to the page's main region without scrolling to it.
 * A page that already placed focus inside (an autofocused field) keeps it.
 */
function focusMain(force = false): void {
  const main = document.getElementById('main');
  if (!main) return;
  if (!force && main.contains(document.activeElement)) return;
  main.focus({ preventScroll: true });
}

/**
 * After a navigation to a different page: focus moves to the main region (so
 * the next Tab starts in the new content rather than in the old page's
 * position) and the new title is announced to screen readers. Changes to the
 * query string alone, such as typing in the dashboard search, do neither.
 */
function useRouteFocus(): string {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (previous.current === pathname) return undefined;
    previous.current = pathname;
    // One frame later, so the new page has set its title and rendered its main region.
    const frame = window.requestAnimationFrame(() => {
      focusMain();
      setAnnouncement(document.title);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);
  return announcement;
}

/** A thin bar at the top while the next screen's code is being fetched. */
function NavigationProgress() {
  const navigation = useNavigation();
  const [visible, setVisible] = useState(false);
  const loading = navigation.state === 'loading';
  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return undefined;
    }
    // Fast navigations never show it.
    const handle = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(handle);
  }, [loading]);
  return visible ? (
    <div className="app-progress" role="progressbar" aria-label="Loading page" />
  ) : null;
}

/**
 * Root of every route: skip link, session gate, focus management and the
 * providers that need the router.
 */
export function RootLayout() {
  const session = useSession();
  const announcement = useRouteFocus();

  let content;
  if (session.status === 'loading') {
    content = <Splash />;
  } else if (session.status === 'error') {
    content = (
      <PublicShell width="wide">
        <ErrorView
          error={session.error}
          headingLevel={1}
          onRetry={() => void session.refresh()}
          data-testid="session-error"
        />
      </PublicShell>
    );
  } else {
    content = (
      <SignOutProvider>
        <Outlet />
      </SignOutProvider>
    );
  }

  return (
    <>
      <a
        className="app-skip-link"
        href="#main"
        onClick={(event) => {
          // Move focus without adding "#main" to the address or the history.
          event.preventDefault();
          focusMain(true);
        }}
      >
        Skip to content
      </a>
      <NavigationProgress />
      {content}
      <div className="rd-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <ScrollRestoration />
    </>
  );
}
