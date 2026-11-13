import { Skeleton, Button } from '@realtimedocs/ui';
import { Link } from 'react-router';
import './distribution.css';
import { Brand } from '../../components/Brand';
import { ThemeControl } from '../../components/ThemeControl';
import { useDocumentTitle } from '../../lib/hooks';
import { DownloadPicker } from './DownloadPicker';
import { PLATFORM_NAMES, PLATFORMS } from './downloads';
import { useDesktopRelease } from './useDesktopRelease';

/** `/download`: every published build, the requirements and where the release notes are. Public. */
export function DownloadPage() {
  useDocumentTitle('Download RealtimeDocs Desktop');
  const releases = useDesktopRelease();
  const current = releases.data?.current ?? null;
  const history = releases.data?.history ?? [];

  return (
    <div className="dl-page">
      <header className="dl-page__bar">
        <Brand to="/product" />
        <ThemeControl compact />
      </header>
      <main id="main" tabIndex={-1} className="dl-page__main">
        <h1>Download RealtimeDocs Desktop</h1>
        <p>
          You download the file, check its SHA-256 checksum if you like, and install it yourself.
          Nothing is installed or changed automatically. Builds that are not code-signed say so, and
          your operating system will warn you when you open them: leave those protections on.
        </p>

        {releases.isPending ? (
          <div role="status" aria-label="Checking which builds are published">
            <Skeleton height={80} />
          </div>
        ) : releases.isError ? (
          <div role="alert" data-testid="downloads-error">
            <p>The list of desktop builds could not be loaded just now.</p>
            <Button size="sm" onClick={() => void releases.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <DownloadPicker release={current} headingLevel={2} />

            <h2>System requirements</h2>
            <table className="dl-table" data-testid="download-requirements">
              <thead>
                <tr>
                  <th scope="col">Platform</th>
                  <th scope="col">Requirements</th>
                  <th scope="col">Guide</th>
                </tr>
              </thead>
              <tbody>
                {PLATFORMS.map((platform) => {
                  const files = current?.artifacts.filter((a) => a.platform === platform) ?? [];
                  const needs = [...new Set(files.map((a) => a.minimumOsVersion).filter(Boolean))];
                  return (
                    <tr key={platform}>
                      <th scope="row">{PLATFORM_NAMES[platform]}</th>
                      <td>
                        {files.length === 0
                          ? `No release published for ${PLATFORM_NAMES[platform]} yet.`
                          : needs.length > 0
                            ? needs.join('; ')
                            : 'Not stated by this server.'}
                      </td>
                      <td>
                        <Link to={`/guides/${platform}-client`}>
                          {PLATFORM_NAMES[platform]} guide
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h2>Release notes</h2>
            {history.length === 0 ? (
              <p data-testid="release-history-empty">
                {current?.legacy
                  ? 'This server publishes builds without release notes.'
                  : 'No releases published yet.'}
              </p>
            ) : (
              <ul className="dl-history" data-testid="release-history">
                {history.map((release) => (
                  <li key={release.version}>
                    <Link to={`/releases/${release.version}`}>Version {release.version}</Link>
                    {release.publishedAt && (
                      <span className="dl-hint">
                        {' '}
                        · {new Date(release.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
