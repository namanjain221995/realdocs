import { Button, LinkButton, Skeleton } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { buildLabel, formatBytes, isDownloadPath, orderBuilds } from './downloads';

function UnsignedNotice() {
  return (
    <div className="land-notice" role="note" data-testid="unsigned-notice">
      <h3>The desktop builds are not signed yet</h3>
      <p>
        Windows SmartScreen and macOS Gatekeeper will warn you the first time you open the app,
        because it does not have a publisher certificate yet. Leave those protections switched on.
        The guides explain what you will see and how to open the app step by step:{' '}
        <Link to="/docs/windows-client">Windows guide</Link> and{' '}
        <Link to="/docs/macos-client">macOS guide</Link>.
      </p>
    </div>
  );
}

/** `#download`: the desktop builds this server actually publishes, and nothing else. */
export function DownloadSection() {
  const downloads = useQuery({
    queryKey: ['downloads'],
    queryFn: () => api.downloads(),
    staleTime: 60_000,
    retry: 1,
  });
  const data = downloads.data;
  const builds = data ? orderBuilds(data.artifacts).filter((item) => isDownloadPath(item.url)) : [];
  const signed = data?.release?.signed === true;

  return (
    <section id="download" className="land-section land-download" aria-labelledby="download-title">
      <div className="land-wrap">
        <h2 id="download-title" className="land-h2">
          Download the desktop app
        </h2>
        <p className="land-lead">
          The desktop app adds the floating notes panel. Pick the build that matches your computer.
        </p>

        {downloads.isPending ? (
          <div role="status" aria-label="Checking which builds are published">
            <Skeleton height={64} style={{ marginTop: 20 }} />
          </div>
        ) : downloads.isError ? (
          <div className="land-empty" role="alert" data-testid="downloads-error">
            <p>The list of desktop builds could not be loaded just now.</p>
            <Button size="sm" onClick={() => void downloads.refetch()}>
              Try again
            </Button>
          </div>
        ) : builds.length === 0 ? (
          <p className="land-empty" data-testid="downloads-empty">
            Release not published — build the desktop app locally (see the{' '}
            <Link to="/docs/windows-client">Windows</Link> and{' '}
            <Link to="/docs/macos-client">macOS</Link> guides).
          </p>
        ) : (
          <>
            {data?.release?.version ? (
              <p className="land-release" data-testid="release-version">
                Version {data.release.version}
              </p>
            ) : null}
            {data?.release?.notes ? (
              <p className="land-release__notes" data-testid="release-notes">
                {data.release.notes}
              </p>
            ) : null}
            <ul className="land-builds">
              {builds.map((artifact) => {
                const label = buildLabel(artifact);
                return (
                  <li
                    key={artifact.file}
                    className="land-build"
                    data-testid="download-build"
                    data-file={artifact.file}
                  >
                    <div className="land-build__text">
                      <span className="land-build__label">{label}</span>
                      <span className="land-build__detail">{formatBytes(artifact.bytes)}</span>
                      <span className="land-build__hash">
                        SHA-256 <code data-testid="download-sha256">{artifact.sha256}</code>
                      </span>
                    </div>
                    <LinkButton
                      variant="primary"
                      href={artifact.url}
                      iconLeft={<Download />}
                      aria-label={`Download ${label}`}
                      data-testid="download-link"
                    >
                      Download ({formatBytes(artifact.bytes)})
                    </LinkButton>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {data && !signed ? <UnsignedNotice /> : null}
        <p className="land-browser">No install? Open your share link in any modern browser.</p>
        <p className="land-browser">
          Or just use it in your browser — <Link to="/login">Sign in</Link>.
        </p>
      </div>
    </section>
  );
}
