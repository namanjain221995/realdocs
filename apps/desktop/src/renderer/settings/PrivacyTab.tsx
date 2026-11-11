import { Badge, Banner, Button, Card, Switch, type Tone } from '@realtimedocs/ui';
import {
  FALLBACK_ADVICE,
  MACOS_WHOLE_DISPLAY_WARNING,
  type CaptureStatus,
} from '../../shared/capture';
import { desktop } from '../shared/desktop';
import { ShareGuideView } from '../shared/ShareGuideView';
import { platformName, type TabProps } from './SettingsApp';

const TONES: Record<CaptureStatus['tone'], Tone> = {
  neutral: 'neutral',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
};

export function PrivacyTab({ state, run }: TabProps) {
  const { capture, app } = state;
  const { status } = capture;

  return (
    <div className="rds-stack">
      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Private Presenter Mode: capture exclusion</h2>
        <p className="rds-lead">
          Asks the operating system to leave RealtimeDocs windows out of screen capture. This is a
          request about our own windows; it does not change, inspect or interfere with any meeting
          or recording application.
        </p>
        <Switch
          checked={capture.requested}
          onCheckedChange={(enabled) => void run(desktop?.capture.setEnabled(enabled))}
          label="Private mode: request capture exclusion for RealtimeDocs windows"
          hint={
            capture.apiAvailable
              ? 'On by default. Applied to the panel, the normal document window, this settings window and the resize probe, before each is shown.'
              : `${platformName(app.platform)} has no supported way to make this request. Private mode still keeps document titles out of the taskbar and the tray, and hides the panel instead of moving it when its display goes away.`
          }
          data-testid="rd-capture-switch"
        />

        <div
          className="rds-capture-status"
          data-testid="rd-capture-status"
          data-kind={status.kind}
          data-request={status.request}
          data-reason={status.reason ?? ''}
        >
          <div className="rds-capture-labels">
            <Badge tone={TONES[status.tone]} data-testid="rd-capture-label">
              {status.label}
            </Badge>
            {status.verification ? (
              <span className="rds-capture-secondary" data-testid="rd-capture-secondary">
                {status.verification.line}
              </span>
            ) : null}
          </div>
          <p>{status.detail}</p>
          {(status.verification?.warnings.length ?? 0) + status.warnings.length > 0 && (
            <ul className="rds-list">
              {[...(status.verification?.warnings ?? []), ...status.warnings].map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="rds-button-row">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void run(desktop?.window.action('open-settings', { tab: 'privacy-test-center' }))
              }
              data-testid="rd-open-test-center"
            >
              Open the Privacy Test Center
            </Button>
          </div>
        </div>

        {app.platform === 'darwin' && (
          <Banner tone="warning" data-testid="rd-macos-capture-warning">
            {MACOS_WHOLE_DISPLAY_WARNING}
          </Banner>
        )}
      </Card>

      <Card padding="lg" className="rds-card" data-testid="rd-settings-share-guide">
        <ShareGuideView state={state} headingLevel={2} />
        <div className="rds-button-row">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void run(desktop?.window.action('show-share-guide'))}
            data-testid="rd-settings-show-guide"
          >
            Show it in the panel
          </Button>
        </div>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">What to rely on instead</h2>
        <p>{FALLBACK_ADVICE}</p>
        <ul className="rds-list">
          <li>Share one application window or one browser tab, not the entire screen.</li>
          <li>Keep the panel on a monitor or device that is not being shared.</li>
          <li>Ask a participant what they see, or join from a second device and look yourself.</li>
          <li>
            Anything outside this app — a browser tab with the document, an exported file, a phone
            camera — is not covered by private mode.
          </li>
        </ul>
      </Card>
    </div>
  );
}
