import { Badge, Banner, Button, Card } from '@realtimedocs/ui';
import { Download, FolderOpen, RefreshCw } from 'lucide-react';
import { SIGNATURE_WORDS } from '../../shared/updates';
import { desktop } from '../shared/desktop';
import { formatDateTime } from '../shared/labels';
import type { TabProps } from './SettingsApp';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/**
 * Settings → Updates. The app checks, downloads on request and verifies the file; it never
 * installs or restarts itself. The user decides when to open the installer.
 */
export function UpdatesTab({ state, run }: TabProps) {
  const { updates, connection } = state;
  const { offer } = updates;
  const busy = updates.status === 'checking' || updates.status === 'downloading';
  const noServer = !connection.server.origin;

  return (
    <div className="rds-stack">
      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Updates</h2>
        <p className="rds-lead">
          You have RealtimeDocs Desktop {updates.currentVersion} ({updates.channel} channel). The
          app asks your server about new versions when it starts and every 6 hours. It never
          installs or restarts by itself: you download an update, and open it when you choose.
          Unsaved work stays on this computer either way.
        </p>

        {updates.required && (
          <Banner tone="danger" data-testid="rd-update-required">
            Update required. This version is too old for your server. Download the current version
            and install it to keep editing documents.
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
          {updates.status === 'downloading' && (
            <p role="status">Downloading… {Math.round((updates.progress ?? 0) * 100)}%</p>
          )}
          {updates.status === 'downloaded' && (
            <p role="status" data-testid="rd-update-verified">
              Downloaded to your Downloads folder and verified (size and SHA-256 match). Nothing has
              been installed yet.
            </p>
          )}
          <div className="rds-actions">
            {updates.status === 'downloaded' ? (
              <>
                <Button
                  variant="primary"
                  iconLeft={<FolderOpen />}
                  onClick={() => void run(desktop?.updates.open('show-in-folder'))}
                  data-testid="rd-update-show"
                >
                  Show in folder
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void run(desktop?.updates.open('open-installer'))}
                  data-testid="rd-update-open"
                >
                  {offer.kind === 'installer' ? 'Open installer' : 'Open download'}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                iconLeft={<Download />}
                loading={updates.status === 'downloading'}
                disabled={busy}
                onClick={() => void run(desktop?.updates.download())}
                data-testid="rd-update-download"
              >
                Download update
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
    case 'failed':
      return 'Problem';
    case 'unavailable':
      return 'Not available from this server';
    default:
      return 'Not checked yet';
  }
}
