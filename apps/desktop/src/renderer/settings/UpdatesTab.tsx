import { Badge, Banner, Button, Card } from '@realtimedocs/ui';
import { Check, Download, FolderOpen, RefreshCw, RotateCw } from 'lucide-react';
import { SIGNATURE_WORDS } from '../../shared/updates';
import { desktop } from '../shared/desktop';
import { formatDateTime } from '../shared/labels';
import { UpdateProgress, formatBytes } from '../shared/UpdateProgress';
import type { TabProps } from './SettingsApp';

/**
 * Settings → Updates. The app checks by itself. "Update and restart" downloads, verifies, unpacks,
 * checks and restarts into the new version; nothing is installed without that click. Where the
 * installation cannot replace itself, the verified download is offered instead.
 */
export function UpdatesTab({ state, run }: TabProps) {
  const { updates, connection } = state;
  const { offer } = updates;
  const installing = updates.stage !== null;
  const busy =
    updates.status === 'checking' ||
    updates.status === 'downloading' ||
    updates.status === 'installing' ||
    installing;
  const noServer = !connection.server.origin;

  return (
    <div className="rds-stack">
      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Updates</h2>
        <p className="rds-lead">
          You have RealtimeDocs Desktop {updates.currentVersion} ({updates.channel} channel). The
          app asks your server about new versions when it starts and every 6 hours. Nothing is
          installed until you choose "Update and restart"; the app then downloads the new version,
          checks it, and restarts into it. Unsaved work stays on this computer either way.
        </p>

        {updates.notice?.kind === 'updated' && (
          <Banner
            tone="success"
            data-testid="rd-update-done"
            onDismiss={() => void run(desktop?.updates.dismissNotice())}
          >
            <span className="rdu-updated">
              <Check aria-hidden="true" />
              Updated to {updates.notice.version}.
            </span>
          </Banner>
        )}
        {updates.notice?.kind === 'failed' && (
          <Banner
            tone="warning"
            data-testid="rd-update-not-installed"
            onDismiss={() => void run(desktop?.updates.dismissNotice())}
          >
            The update to {updates.notice.version} was not installed. {updates.notice.message}
          </Banner>
        )}

        {updates.required && (
          <Banner tone="danger" data-testid="rd-update-required">
            Update required. This version is too old for your server. Update to the current version
            to keep editing documents.
          </Banner>
        )}

        <div className="rds-row" data-testid="rd-update-status" data-status={updates.status}>
          <Badge
            tone={
              updates.status === 'failed'
                ? 'danger'
                : updates.status === 'available' || updates.status === 'downloaded'
                  ? 'info'
                  : 'neutral'
            }
          >
            {statusLabel(updates.status, noServer)}
          </Badge>
          {updates.checkedAt && (
            <span className="rds-hint">Last checked {formatDateTime(updates.checkedAt)}</span>
          )}
        </div>
        {updates.message && (
          <p className="rds-hint" data-testid="rd-update-message">
            {updates.message}
          </p>
        )}

        <div className="rds-actions">
          <Button
            variant="secondary"
            iconLeft={<RefreshCw />}
            disabled={busy || noServer}
            onClick={() => void run(desktop?.updates.check())}
            data-testid="rd-update-check"
          >
            Check for updates
          </Button>
        </div>
      </Card>

      {offer && (
        <Card padding="lg" className="rds-card" data-testid="rd-update-offer">
          <h2 className="rds-h2">Version {offer.version} is available</h2>
          <dl className="rds-facts">
            <dt>Download</dt>
            <dd>
              {offer.fileName} ({formatBytes(offer.sizeBytes)})
            </dd>
            <dt>Signature</dt>
            <dd data-testid="rd-update-signature">{SIGNATURE_WORDS[offer.signatureStatus]}</dd>
            <dt>SHA-256</dt>
            <dd>
              <code>{offer.sha256}</code>
            </dd>
          </dl>
          {offer.notes && (
            <details>
              <summary>What is new</summary>
              <pre className="rds-notes" data-testid="rd-update-notes">
                {offer.notes}
              </pre>
            </details>
          )}
          {installing ? (
            <UpdateProgress updates={updates} />
          ) : (
            updates.status === 'downloading' && (
              <p role="status">
                Downloading… {Math.round((updates.progress ?? 0) * 100)}% (
                {formatBytes(updates.receivedBytes ?? 0)} of {formatBytes(offer.sizeBytes)})
              </p>
            )
          )}
          {updates.status === 'downloaded' && !installing && (
            <p role="status" data-testid="rd-update-verified">
              Downloaded to your Downloads folder and verified (size and SHA-256 match). Nothing has
              been installed yet.
            </p>
          )}
          {updates.installBlocker && (
            <p className="rds-hint" data-testid="rd-update-manual-reason">
              This copy cannot replace itself: {updates.installBlocker} You can still download the
              new version here and replace the app yourself.
            </p>
          )}
          <div className="rds-actions">
            {!updates.installBlocker && (
              <Button
                variant="primary"
                iconLeft={<RotateCw />}
                loading={installing}
                disabled={busy}
                onClick={() => void run(desktop?.updates.install())}
                data-testid="rd-update-install"
              >
                Update and restart
              </Button>
            )}
            {updates.status === 'downloaded' ? (
              <>
                <Button
                  variant={updates.installBlocker ? 'primary' : 'secondary'}
                  iconLeft={<FolderOpen />}
                  disabled={installing}
                  onClick={() => void run(desktop?.updates.open('show-in-folder'))}
                  data-testid="rd-update-show"
                >
                  Show in folder
                </Button>
                <Button
                  variant="secondary"
                  disabled={installing}
                  onClick={() => void run(desktop?.updates.open('open-installer'))}
                  data-testid="rd-update-open"
                >
                  {offer.kind === 'installer' ? 'Open installer' : 'Open download'}
                </Button>
              </>
            ) : (
              <Button
                variant={updates.installBlocker ? 'primary' : 'secondary'}
                iconLeft={<Download />}
                loading={updates.status === 'downloading' && !installing}
                disabled={busy}
                onClick={() => void run(desktop?.updates.download())}
                data-testid="rd-update-download"
              >
                Download only
              </Button>
            )}
            {!updates.required && !updates.deferred && (
              <Button
                variant="ghost"
                onClick={() => void run(desktop?.updates.defer())}
                data-testid="rd-update-defer"
              >
                Remind me later
              </Button>
            )}
          </div>
          {updates.deferred && !updates.required && (
            <p className="rds-hint">You chose to be reminded later about this version.</p>
          )}
        </Card>
      )}
    </div>
  );
}

function statusLabel(status: string, noServer: boolean): string {
  if (noServer) return 'No server set';
  switch (status) {
    case 'checking':
      return 'Checking…';
    case 'up_to_date':
      return 'You have the latest version';
    case 'available':
      return 'Update available';
    case 'downloading':
      return 'Downloading';
    case 'downloaded':
      return 'Downloaded and verified';
    case 'installing':
      return 'Updating';
    case 'failed':
      return 'Problem';
    case 'unavailable':
      return 'Not available from this server';
    default:
      return 'Not checked yet';
  }
}
