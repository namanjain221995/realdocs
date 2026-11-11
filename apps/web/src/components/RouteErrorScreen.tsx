import { Button, ErrorState } from '@realtimedocs/ui';
import { TriangleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { BrandMark } from './Brand';

function isChunkLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically/i.test(
    error.message,
  );
}

/**
 * Last-resort screen. It depends on nothing but the stylesheet, because it is
 * shown when a provider or a route has thrown. Error details stay out of the
 * page: a stack trace helps nobody reading it and could quote document text.
 */
function CrashScreen({ chunk }: { chunk: boolean }) {
  return (
    <div className="app-public">
      <header className="app-public__bar">
        <span className="app-brand">
          <BrandMark />
          <span className="app-brand__name">RealtimeDocs</span>
        </span>
      </header>
      <main id="main" tabIndex={-1} className="app-public__main">
        <div className="app-public__column app-public__column--wide">
          <ErrorState
            data-testid="crash-screen"
            icon={<TriangleAlert />}
            headingLevel={1}
            title={chunk ? 'This page could not be loaded' : 'RealtimeDocs ran into a problem'}
            description={
              chunk
                ? 'Part of the app failed to download. The server may have been updated, or the connection dropped. Reload to try again.'
                : 'Something unexpected happened on this screen. Reload the page; work that was already saved is not affected.'
            }
            action={
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        </div>
      </main>
    </div>
  );
}

/** `ErrorBoundary` of the root route: render errors and failed lazy route loads. */
export function RouteErrorScreen() {
  const error = useRouteError();
  const chunk = !isRouteErrorResponse(error) && isChunkLoadFailure(error);
  return <CrashScreen chunk={chunk} />;
}

interface BoundaryState {
  failed: boolean;
  chunk: boolean;
}

/** Catches errors thrown outside the router (providers, the router itself). */
export class AppCrashBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false, chunk: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, chunk: isChunkLoadFailure(error) };
  }

  override render(): ReactNode {
    if (this.state.failed) return <CrashScreen chunk={this.state.chunk} />;
    return this.props.children;
  }
}
