import { Button, Skeleton } from '@realtimedocs/ui';
import { Link } from 'react-router';
import './distribution.css';
import { DownloadPicker } from './DownloadPicker';
import { useDesktopRelease } from './useDesktopRelease';

/** `#download`: the desktop builds this server actually publishes, and nothing else. */
export function DownloadSection() {
  const releases = useDesktopRelease();
  const release = releases.data?.current ?? null;

  return (
    <section id="download" className="land-section land-download" aria-labelledby="download-title">
      <div className="land-wrap">
        <h2 id="download-title" className="land-h2">
          Download the desktop app
        </h2>
        <p className="land-lead">
          The desktop app adds the floating notes panel. We suggest the build for your computer; you
          download and install it yourself, nothing is installed automatically.
        </p>

        {releases.isPending ? (
          <div role="status" aria-label="Checking which builds are published">
            <Skeleton height={64} style={{ marginTop: 20 }} />
          </div>
        ) : releases.isError ? (
          <div className="land-empty" role="alert" data-testid="downloads-error">
            <p>The list of desktop builds could not be loaded just now.</p>
            <Button size="sm" onClick={() => void releases.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <DownloadPicker release={release} headingLevel={3} />
            {release?.notes && (
              <p className="land-release__notes" data-testid="release-notes">
                {release.notes.length > 400 ? `${release.notes.slice(0, 400)}…` : release.notes}
              </p>
            )}
            <p className="dl-hint">
              <Link to="/download">All downloads, system requirements and release notes</Link>
            </p>
          </>
        )}

        <p className="land-browser">No install? Open your share link in any modern browser.</p>
        <p className="land-browser">
          Or just use it in your browser: <Link to="/documents">open your documents</Link>.
        </p>
      </div>
    </section>
  );
}
