import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  SegmentedControl,
  Select,
  TextArea,
  TextField,
  type Tone,
} from '@realtimedocs/ui';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { emptyDraft, validateDraft, type Draft, type DraftField } from '../../shared/privacy/draft';
import type { ExportFormat } from '../../shared/privacy/ipc';
import {
  CAPTURE_MODES,
  CAPTURE_MODE_LABELS,
  MEETING_APPS,
  MEETING_APP_LABELS,
  OBSERVED_OUTCOMES,
  OBSERVED_OUTCOME_LABELS,
  OBSERVERS,
  PROTECTION_STATUS_LABELS,
  type ProtectionRequestState,
  type ProtectionStatus,
  type VerificationRecord,
} from '../../shared/privacy/status';
import {
  EXPIRY_REASON_LABELS,
  PRIVACY_NOTICE,
  configurationKeyOf,
  describeKey,
  evaluateVerification,
  headlineStatus,
  keyId,
  observerLabel,
  sortNewestFirst,
  summarize,
  type DetectedEnvironment,
  type HeadlineStatus,
} from '../../shared/privacy/test-center';
import './privacy.css';

export interface PrivacyTestCenterProps {
  environment: DetectedEnvironment;
  requestState: ProtectionRequestState;
  records: readonly VerificationRecord[];
  onSave: (record: VerificationRecord) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onExport: (format: ExportFormat) => void | Promise<void>;
  /** For tests and previews; defaults to the current time. */
  now?: Date;
}

const OBSERVER_CHOICES = OBSERVERS.map((value) => ({ value, label: observerLabel(value) }));

export function toneFor(headline: HeadlineStatus): Tone {
  const status: ProtectionStatus = headline.status;
  switch (status) {
    case 'verified':
      return headline.negative ? 'warning' : 'success';
    case 'verification_expired':
      return 'warning';
    case 'request_failed':
      return 'danger';
    case 'os_accepted':
      return 'info';
    default:
      return 'neutral';
  }
}

function formatWhen(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function draftFromRecord(record: VerificationRecord, environment: DetectedEnvironment): Draft {
  const base = emptyDraft(environment, record.protectionEnabled);
  return {
    ...base,
    meetingApp: record.meetingApp,
    meetingAppName: record.meetingAppName ?? '',
    meetingAppVersion: record.meetingAppVersion,
    clientKind: record.client.kind,
    browser: record.client.kind === 'browser' ? record.client.browser : '',
    browserVersion: record.client.kind === 'browser' ? record.client.browserVersion : '',
    captureMode: record.captureMode,
    monitorCount: String(record.monitors.count),
    arrangement: record.monitors.arrangement ?? '',
    // The new test needs its own remote observation: nothing carries over.
  };
}

export function PrivacyTestCenter(props: PrivacyTestCenterProps) {
  const { environment, requestState, records, onSave, onDelete, onExport } = props;
  const now = props.now ?? new Date();
  const protectionOn = requestState !== 'off';
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(environment, protectionOn));
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VerificationRecord | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const ids = { form: useId(), summary: useId(), records: useId() };

  const set = <K extends DraftField>(field: K, value: Draft[K]): void => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (submitted) {
      const result = validateDraft(next, environment, '00000000-0000-4000-8000-000000000000', now);
      setErrors(result.ok ? {} : result.errors);
    }
  };

  const summary = summarize(records, environment, requestState, now);

  const groups = useMemo(() => {
    const map = new Map<string, VerificationRecord[]>();
    for (const record of sortNewestFirst(records)) {
      const id = keyId(configurationKeyOf(record));
      map.set(id, [...(map.get(id) ?? []), record]);
    }
    return [...map.values()];
  }, [records]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitted(true);
    const result = validateDraft(draft, environment, newId(), new Date());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSave(result.record);
      setSubmitted(false);
      setDraft(emptyDraft(environment, protectionOn));
    } finally {
      setSaving(false);
    }
  }

  const errorList = Object.entries(errors);

  return (
    <div className="rdp-root">
      <Banner tone="info" title="What this test can show" className="rdp-notice" role="note">
        {PRIVACY_NOTICE}
      </Banner>

      <section aria-labelledby={ids.summary} className="rdp-section">
        <h2 id={ids.summary} className="rdp-h2">
          This computer now
        </h2>
        {summary.length === 0 ? (
          <p className="rdp-muted">
            Nothing has been tested on this computer yet. Current status:{' '}
            {PROTECTION_STATUS_LABELS[requestState]}.
          </p>
        ) : (
          <ul className="rdp-list">
            {summary.map((row) => (
              <li key={row.id} className="rdp-row">
                <span className="rdp-row__title">{row.title}</span>
                <StatusBadge headline={row.headline} />
                <OutcomeText headline={row.headline} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={ids.form} className="rdp-section">
        <h2 id={ids.form} className="rdp-h2" tabIndex={-1} ref={formHeading}>
          Record a test
        </h2>
        <form className="rdp-form" noValidate onSubmit={(event) => void submit(event)}>
          <Card className="rdp-card">
            <h3 className="rdp-h3">Detected on this computer</h3>
            <div className="rdp-grid">
              <TextField
                label="Operating system and build"
                value={`${environment.platform} ${environment.osVersion}`}
                readOnly
              />
              <TextField label="RealtimeDocs version" value={environment.appVersion} readOnly />
              <TextField label="Electron version" value={environment.electronVersion} readOnly />
            </div>
          </Card>

          <Card className="rdp-card">
            <h3 className="rdp-h3">Meeting setup</h3>
            <div className="rdp-grid">
              <Select
                label="Meeting app"
                value={draft.meetingApp}
                onValueChange={(value) => set('meetingApp', value as Draft['meetingApp'])}
                options={MEETING_APPS.map((value) => ({ value, label: MEETING_APP_LABELS[value] }))}
              />
              {draft.meetingApp === 'other' && (
                <TextField
                  label="Name of the meeting app"
                  value={draft.meetingAppName}
                  error={errors.meetingAppName}
                  onChange={(event) => set('meetingAppName', event.target.value)}
                  required
                />
              )}
              <TextField
                label="Meeting app version"
                value={draft.meetingAppVersion}
                error={errors.meetingAppVersion}
                onChange={(event) => set('meetingAppVersion', event.target.value)}
                required
              />
              <Select
                label="Client"
                value={draft.clientKind}
                onValueChange={(value) => set('clientKind', value as Draft['clientKind'])}
                options={[
                  { value: 'native', label: 'Native app' },
                  { value: 'browser', label: 'In a browser' },
                ]}
              />
              {draft.clientKind === 'browser' && (
                <>
                  <TextField
                    label="Browser"
                    value={draft.browser}
                    error={errors.browser}
                    onChange={(event) => set('browser', event.target.value)}
                    required
                  />
                  <TextField
                    label="Browser version"
                    value={draft.browserVersion}
                    error={errors.browserVersion}
                    onChange={(event) => set('browserVersion', event.target.value)}
                    required
                  />
                </>
              )}
              <Select
                label="What was shared"
                value={draft.captureMode}
                onValueChange={(value) => set('captureMode', value as Draft['captureMode'])}
                options={CAPTURE_MODES.map((value) => ({
                  value,
                  label: CAPTURE_MODE_LABELS[value],
                }))}
              />
              <TextField
                label="Number of displays"
                type="number"
                inputMode="numeric"
                min={1}
                max={16}
                value={draft.monitorCount}
                error={errors.monitorCount}
                onChange={(event) => set('monitorCount', event.target.value)}
                required
              />
              <TextField
                label="Display arrangement"
                hint="For example: panel on display 2, sharing display 1."
                value={draft.arrangement}
                onChange={(event) => set('arrangement', event.target.value)}
              />
            </div>
            <Checkbox
              label="Protection was on in RealtimeDocs during this test"
              checked={draft.protectionEnabled}
              onCheckedChange={(checked) => set('protectionEnabled', checked)}
            />
          </Card>

          <Card className="rdp-card">
            <h3 className="rdp-h3">Results</h3>
            <TextArea
              label="What you saw on this computer"
              value={draft.localResult}
              error={errors.localResult}
              onChange={(event) => set('localResult', event.target.value)}
              rows={2}
              required
            />
            <Select
              label="What the second participant or device received (required)"
              value={draft.outcome}
              placeholder="Choose the observed result"
              error={errors.outcome}
              onValueChange={(value) => set('outcome', value as Draft['outcome'])}
              options={OBSERVED_OUTCOMES.map((value) => ({
                value,
                label: OBSERVED_OUTCOME_LABELS[value],
              }))}
              required
            />
            <div className="rdp-observer">
              <SegmentedControl
                ariaLabel="Observed by (required)"
                options={OBSERVER_CHOICES}
                value={(draft.observedBy || '') as 'second_participant'}
                onValueChange={(value) => set('observedBy', value)}
              />
              {errors.observedBy && (
                <p className="rdp-error" role="alert">
                  {errors.observedBy}
                </p>
              )}
              {!draft.observedBy && !errors.observedBy && (
                <p className="rdp-muted">Observed by: not chosen yet (required).</p>
              )}
            </div>
            <TextArea
              label="Note from the observer"
              value={draft.note}
              onChange={(event) => set('note', event.target.value)}
              rows={2}
            />
            <TextField
              label="Where the evidence is kept"
              hint="For example the file name of a photo taken on the second device."
              value={draft.evidence}
              onChange={(event) => set('evidence', event.target.value)}
            />
            <TextArea
              label="Behaviour during startup, document switch, resize, hide/show and protection toggle"
              value={draft.transitions}
              onChange={(event) => set('transitions', event.target.value)}
              rows={2}
            />
          </Card>

          {submitted && errorList.length > 0 && (
            <Banner tone="danger" title="This test cannot be saved yet" role="alert">
              <ul className="rdp-errors">
                {errorList.map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            </Banner>
          )}
          <div className="rdp-actions">
            <Button type="submit" variant="primary" loading={saving}>
              Save test result
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby={ids.records} className="rdp-section">
        <div className="rdp-head">
          <h2 id={ids.records} className="rdp-h2">
            Recorded tests
          </h2>
          <div className="rdp-actions">
            <Button size="sm" onClick={() => void onExport('markdown')}>
              Export as Markdown
            </Button>
            <Button size="sm" onClick={() => void onExport('json')}>
              Export as JSON
            </Button>
          </div>
        </div>
        {groups.length === 0 && <p className="rdp-muted">No tests recorded.</p>}
        {groups.map((group) => {
          const first = group[0];
          if (!first) return null;
          const key = configurationKeyOf(first);
          const headline = headlineStatus(
            requestState,
            evaluateVerification(group, key, environment, now),
          );
          return (
            <Card key={keyId(key)} className="rdp-card" aria-label={describeKey(key)}>
              <h3 className="rdp-h3">{describeKey(key)}</h3>
              <p className="rdp-statusline">
                <StatusBadge headline={headline} /> <OutcomeText headline={headline} />
              </p>
              <ul className="rdp-list">
                {group.map((record) => (
                  <li key={record.id} className="rdp-record">
                    <div className="rdp-record__text">
                      <span>{formatWhen(record.testedAt)}</span>
                      <span>{OBSERVED_OUTCOME_LABELS[record.remote.outcome]}</span>
                      <span className="rdp-muted">
                        Observed by: {observerLabel(record.remote.observedBy)}
                      </span>
                    </div>
                    <div className="rdp-actions">
                      <Button
                        size="sm"
                        onClick={() => {
                          setDraft(draftFromRecord(record, environment));
                          setErrors({});
                          setSubmitted(false);
                          formHeading.current?.focus();
                          formHeading.current?.scrollIntoView?.({ block: 'start' });
                        }}
                      >
                        Verify again
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setPendingDelete(record)}>
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this test result?"
          message="The record is removed from this computer. This cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            await onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
        >
          <p className="rdp-muted">
            {formatWhen(pendingDelete.testedAt)}:{' '}
            {OBSERVED_OUTCOME_LABELS[pendingDelete.remote.outcome]}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function StatusBadge({ headline }: { headline: HeadlineStatus }) {
  return <Badge tone={toneFor(headline)}>{headline.label}</Badge>;
}

/** The observed outcome (or the reason for expiry) that goes with a status. */
function OutcomeText({ headline }: { headline: HeadlineStatus }) {
  if (headline.status === 'verified' && headline.outcomeLabel) {
    return <span className="rdp-outcome">{headline.outcomeLabel}</span>;
  }
  if (headline.status === 'verification_expired' && headline.reason) {
    const last = headline.outcomeLabel ? ` Last observed: ${headline.outcomeLabel}.` : '';
    return (
      <span className="rdp-outcome">
        {EXPIRY_REASON_LABELS[headline.reason]}
        {last}
      </span>
    );
  }
  return null;
}
