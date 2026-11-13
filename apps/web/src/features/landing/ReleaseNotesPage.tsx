import { ApiError } from '@realtimedocs/contracts';
import { Skeleton } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import './distribution.css';
import { Brand } from '../../components/Brand';
import { NotFoundPage } from '../../components/NotFoundPage';
import { ThemeControl } from '../../components/ThemeControl';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../lib/hooks';
import { renderMarkdown } from '../guides/markdown';
import { fromRelease, signatureNotice, formatBytes, buildLabel, orderBuilds } from './downloads';

/** `/releases/:version`: the notes of one release and its files. Public. */
export function ReleaseNotesPage() {
  const { version = '' } = useParams();
  useDocumentTitle(`RealtimeDocs Desktop ${version}`);
  const query = useQuery({
    queryKey: ['desktop-release-notes', version],
    queryFn: () => api.desktopReleases.get(version),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  if (query.isError && query.error instanceof ApiError && query.error.status === 404) {
    return <NotFoundPage />;
  }
  const release = query.data ? fromRelease(query.data) : null;

  return (
    <div className="dl-page">
      <header className="dl-page__bar">
        <Brand to="/product" />
        <ThemeControl compact />
      </header>
      <main id="main" tabIndex={-1} className="dl-page__main">
        <p>
          <Link to="/download">All downloads</Link>
        </p>
        <h1>RealtimeDocs Desktop {version}</h1>
        {query.isPending ? (
          <div role="status" aria-label="Loading the release notes">
            <Skeleton height={80} />
          </div>
        ) : query.isError || !release ? (
          <p role="alert" data-testid="release-error">
            The release notes could not be loaded just now.
          </p>
        ) : (
          <>
            {release.publishedAt && (
              <p className="dl-hint">
                Published {new Date(release.publishedAt).toLocaleDateString()}
              </p>
            )}
            <article className="dl-notes" data-testid="release-notes-body">
              {release.notes.trim() === ''
                ? 'No release notes were published for this version.'
                : renderMarkdown(release.notes, {
                    // Operator-written text: only absolute https links open, in a new tab.
                    resolveLink: (href) =>
                      /^https:\/\//i.test(href) ? { kind: 'external', href } : { kind: 'none' },
                  })}
            </article>
            <h2>Files</h2>
            {release.artifacts.length === 0 ? (
              <p>No files are available for this version.</p>
            ) : (
              <ul className="dl-builds">
                {orderBuilds(release.artifacts).map((item) => (
                  <li key={item.fileName} className="dl-build" data-testid="download-build">
                    <div>
                      <strong>{buildLabel(item)}</strong>
                      <span className="dl-hint">
                        {' '}
                        · {formatBytes(item.sizeBytes)} ·{' '}
                        {signatureNotice(item.signatureStatus, item.platform)}
                      </span>
                      <div className="dl-hash">
                        SHA-256 <code>{item.sha256}</code>
                      </div>
                    </div>
                    <a className="rd-link" href={item.downloadUrl}>
                      Download
                    </a>
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
