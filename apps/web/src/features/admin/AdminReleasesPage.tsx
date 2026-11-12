/**
 * Desktop releases (administrators): what the server found in the release directory, what it
 * verified, how often each file was downloaded, and the publishing workflow.
 *
 * Read-only on purpose. Publishing is a filesystem operation done by the operator with
 * `scripts/publish-release.mjs`; the server never writes releases and never decides that a build
 * is signed. The page shows exactly what the operator stated.
 */
import './admin.css';
import type { ReleaseChannel } from '@realtimedocs/contracts';
import { Badge, Banner, EmptyState, Skeleton } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { ErrorView } from '../../components/ErrorScreen';
import { AdminOnly } from '../../components/SignedInLayout';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../lib/hooks';
import { queryKeys } from '../../lib/queryKeys';
import { formatBytes, signatureNotice } from '../landing/downloads';

const CHANNEL_NAMES: Record<ReleaseChannel, string> = { stable: 'Stable', beta: 'Beta' };

function Workflow() {
  return (
    <section aria-labelledby="release-workflow" className="admin-workflow">
      <h2 id="release-workflow" className="admin-subheading">
        How to publish a release
      </h2>
      <p>
        Releases are files on the server&apos;s download volume (<code>DOWNLOAD_DIR</code>). This
        page only shows them; it cannot publish, change or delete anything.
      </p>
      <ol>
        <li>
          Build the packages (<code>pnpm --filter @realtimedocs/desktop run package</code>, or the
          desktop release workflow). Names must be{' '}
          <code>
            RealtimeDocs-&lt;version&gt;-&lt;windows|macos|linux&gt;-&lt;arch&gt;.&lt;ext&gt;
          </code>
          .
        </li>
        <li>
          Run{' '}
          <code>
            node scripts/publish-release.mjs &lt;dir&gt; --channel stable --notes-file NOTES.md
            --target &lt;staging&gt;
          </code>
          . Add <code>--signed-windows</code> or <code>--notarized-macos</code> only if the files
          really are. Without those flags every Windows and macOS file is recorded as unsigned.
        </li>
        <li>
          Copy the staging directory into the <code>rd_downloads</code> volume (see
          docs/deployment.md, &ldquo;Publish desktop downloads&rdquo;). Releases are never
          overwritten; previous versions stay.
        </li>
        <li>
          Staged rollout: <code>--rollout 25</code>. Roll back:{' '}
          <code>--rollback &lt;version&gt;</code>, which moves the channel pointer only.
        </li>
      </ol>
    </section>
  );
}

export function AdminReleasesPage() {
  useDocumentTitle('Desktop releases');
  const query = useQuery({
    queryKey: queryKeys.adminReleases,
    queryFn: () => api.desktopReleases.admin(),
    staleTime: 15_000,
  });

  return (
    <AdminOnly>
      <header className="app-page-header">
        <h1 className="app-page-title">Desktop releases</h1>
      </header>
      <div className="admin-panel">
        {query.isPending ? (
          <div role="status" aria-label="Loading releases">
            <Skeleton height={80} />
          </div>
        ) : query.isError ? (
          <ErrorView
            kind="server_unavailable"
            headingLevel={2}
            title="The releases could not be loaded"
            description="Try again in a moment."
          />
        ) : !query.data.configured ? (
          <EmptyState
            title="No download directory is configured"
            description="Set DOWNLOAD_DIR on the server to publish desktop builds."
          />
        ) : (
          <>
            {query.data.legacyFiles.length > 0 && (
              <Banner tone="warning" data-testid="legacy-files">
                Old-style flat files are still being served ({query.data.legacyFiles.join(', ')}).
                Publish a versioned release to replace them; they keep working until you do.
              </Banner>
            )}
            {query.data.channels.map((channel) => (
              <section
                key={channel.channel}
                aria-labelledby={`channel-${channel.channel}`}
                data-testid={`channel-${channel.channel}`}
              >
                <h2 id={`channel-${channel.channel}`} className="admin-subheading">
                  {CHANNEL_NAMES[channel.channel]} channel
                </h2>
                <p className="admin-lede">
                  {channel.pointer
                    ? `Current: ${channel.pointer.version}${
                        channel.pointer.rolloutPercent !== undefined
                          ? `, staged rollout to ${channel.pointer.rolloutPercent}% of installs`
                          : ''
                      }.`
                    : channel.releases.length > 0
                      ? 'No channel pointer: the newest version is current.'
                      : 'Nothing published.'}
                </p>
                {channel.problems.length > 0 && (
                  <Banner tone="danger" data-testid={`problems-${channel.channel}`}>
                    <strong>Not offered to anyone:</strong>
                    <ul>
                      {channel.problems.map((item) => (
                        <li key={`${item.version}-${item.problem}`}>
                          {item.version}: {item.problem}
                        </li>
                      ))}
                    </ul>
                  </Banner>
                )}
                {channel.releases.map((release) => (
                  <article
                    key={release.version}
                    className="admin-release"
                    data-testid="admin-release"
                    data-version={release.version}
                  >
                    <h3>
                      {release.version} {release.current && <Badge tone="success">Current</Badge>}
                    </h3>
                    <p className="admin-lede">
                      Published {new Date(release.publishedAt).toLocaleString()}
                      {release.minimumSupportedVersion
                        ? ` · older than ${release.minimumSupportedVersion} must update`
                        : ''}{' '}
                      · {release.downloads} download{release.downloads === 1 ? '' : 's'}
                    </p>
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th scope="col">File</th>
                            <th scope="col">Size</th>
                            <th scope="col">Signature (as stated)</th>
                            <th scope="col">SHA-256</th>
                            <th scope="col">Downloads</th>
                          </tr>
                        </thead>
                        <tbody>
                          {release.artifacts.map((artifact) => (
                            <tr key={artifact.fileName}>
                              <th scope="row">{artifact.fileName}</th>
                              <td>{formatBytes(artifact.sizeBytes)}</td>
                              <td>
                                {artifact.signatureStatus} —{' '}
                                {signatureNotice(artifact.signatureStatus, artifact.platform)}
                              </td>
                              <td>
                                <code>{artifact.sha256}</code>
                              </td>
                              <td>{artifact.downloads}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </>
        )}
        <Workflow />
      </div>
    </AdminOnly>
  );
}
