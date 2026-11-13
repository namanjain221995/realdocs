import { Spinner } from '@realtimedocs/ui';
import { Check } from 'lucide-react';
import {
  INSTALL_STAGES,
  INSTALL_STAGE_LABELS,
  type InstallStage,
  type UpdateSnapshot,
} from '../../shared/updates';
import './update-progress.css';

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/** What is said aloud and shown under the bar for the current stage. */
export function stageSentence(updates: UpdateSnapshot): string {
  const version = updates.offer?.version ?? '';
  switch (updates.stage) {
    case 'downloading': {
      const percent = Math.round((updates.progress ?? 0) * 100);
      const total = updates.offer ? formatBytes(updates.offer.sizeBytes) : '';
      const received = formatBytes(updates.receivedBytes ?? 0);
      return `Downloading version ${version}: ${percent}% (${received}${total ? ` of ${total}` : ''})`;
    }
    case 'verifying':
      return 'Verifying the download (size and SHA-256)';
    case 'unpacking':
      return 'Unpacking the new version next to the installed one';
    case 'installing':
      return 'Checking the new version and preparing the switch';
    case 'restarting':
      return 'Restarting RealtimeDocs…';
    default:
      return '';
  }
}

/**
 * Progress of "Update and restart". Only the download has a measurable progress, so only it gets
 * a determinate bar; the other stages show an indeterminate indicator and their name. The current
 * stage is announced (`role="status"`); with reduced motion the indicators do not move.
 */
export function UpdateProgress({
  updates,
  compact = false,
}: {
  updates: UpdateSnapshot;
  compact?: boolean;
}) {
  const stage = updates.stage;
  if (!stage) return null;
  const current = INSTALL_STAGES.indexOf(stage);
  const percent = Math.round((updates.progress ?? 0) * 100);
  return (
    <div
      className={compact ? 'rdu-progress rdu-progress--compact' : 'rdu-progress'}
      data-testid="rd-update-progress"
      data-stage={stage}
    >
      {!compact && (
        <ol className="rdu-stages" aria-label="Steps of the update">
          {INSTALL_STAGES.map((name: InstallStage, index) => (
            <li
              key={name}
              className="rdu-stage"
              data-state={index < current ? 'done' : index === current ? 'current' : 'todo'}
              aria-current={index === current ? 'step' : undefined}
            >
              <span className="rdu-stage__mark" aria-hidden="true">
                {index < current ? (
                  <Check />
                ) : index === current ? (
                  <Spinner size="sm" label={null} />
                ) : null}
              </span>
              {INSTALL_STAGE_LABELS[name]}
            </li>
          ))}
        </ol>
      )}
      {stage === 'downloading' ? (
        <progress
          className="rdu-bar"
          max={100}
          value={percent}
          aria-label="Download progress"
          data-testid="rd-update-bar"
        />
      ) : (
        <div className="rdu-bar rdu-bar--busy" aria-hidden="true">
          <span />
        </div>
      )}
      <p className="rdu-sentence" role="status" aria-live="polite" data-testid="rd-update-stage">
        {compact && stage !== 'downloading' && <Spinner size="sm" label={null} />}
        {stageSentence(updates)}
      </p>
    </div>
  );
}
