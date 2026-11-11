/**
 * Privacy Test Center logic: pure, no Electron, no DOM. It decides which of the contract's statuses
 * applies to one exact configuration and renders records for export. Nothing here ever reads what
 * another participant sees: it only evaluates what a person recorded after checking on a second
 * device or with a second participant.
 */
import {
  CAPTURE_MODE_LABELS,
  MEETING_APP_LABELS,
  OBSERVED_OUTCOME_LABELS,
  PROTECTION_STATUS_LABELS,
  VERIFICATION_MAX_AGE_DAYS,
  type ConfigurationKey,
  type ObservedOutcome,
  type Observer,
  type ProtectionRequestState,
  type ProtectionStatus,
  type VerificationRecord,
  type VerificationState,
} from './status';

/** Values detected automatically by the main process. */
export interface DetectedEnvironment {
  appVersion: string;
  electronVersion: string;
  platform: VerificationRecord['platform'];
  /** `process.getSystemVersion()`, for example `10.0.26100`. */
  osVersion: string;
  displayCount: number;
}

/** Versions the person currently has, typed in by them; RealtimeDocs cannot detect them. */
export interface CurrentVersions {
  meetingAppVersion?: string;
  browserVersion?: string;
}

/** A configuration key that also tells apart two meeting apps both filed under "Other". */
export interface ExactConfigurationKey extends ConfigurationKey {
  meetingAppName?: string;
}

export const EXPIRY_REASONS = [
  'os_changed',
  'electron_changed',
  'app_changed',
  'meeting_app_version_changed',
  'browser_version_changed',
  'too_old',
] as const;
export type ExpiryReason = (typeof EXPIRY_REASONS)[number];

export const EXPIRY_REASON_LABELS: Readonly<Record<ExpiryReason, string>> = {
  os_changed: 'The operating system build changed since this test.',
  electron_changed: 'The Electron version changed since this test.',
  app_changed: 'RealtimeDocs was updated since this test.',
  meeting_app_version_changed: 'The meeting app version changed since this test.',
  browser_version_changed: 'The browser version changed since this test.',
  too_old: `This test is older than ${VERIFICATION_MAX_AGE_DAYS} days; browsers and meeting apps update silently.`,
};

export interface VerificationEvaluation {
  state: VerificationState;
  /** The record that decided the state (the newest one matching the configuration). */
  record?: VerificationRecord;
  reason?: ExpiryReason;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const fold = (value: string): string => value.trim().toLowerCase();

export function configurationKeyOf(record: VerificationRecord): ExactConfigurationKey {
  const key: ExactConfigurationKey = {
    platform: record.platform,
    meetingApp: record.meetingApp,
    clientKind: record.client.kind,
    captureMode: record.captureMode,
    monitorCount: record.monitors.count,
    protectionEnabled: record.protectionEnabled,
  };
  if (record.client.kind === 'browser') key.browser = record.client.browser.trim();
  if (record.meetingApp === 'other' && record.meetingAppName) {
    key.meetingAppName = record.meetingAppName.trim();
  }
  return key;
}

/** Exact equality. Browser names (and the name of an "Other" meeting app) ignore letter case. */
export function keysEqual(a: ExactConfigurationKey, b: ExactConfigurationKey): boolean {
  return (
    a.platform === b.platform &&
    a.meetingApp === b.meetingApp &&
    a.clientKind === b.clientKind &&
    a.captureMode === b.captureMode &&
    a.monitorCount === b.monitorCount &&
    a.protectionEnabled === b.protectionEnabled &&
    fold(a.browser ?? '') === fold(b.browser ?? '') &&
    fold(a.meetingAppName ?? '') === fold(b.meetingAppName ?? '')
  );
}

/** A stable string for grouping. Equal keys give equal strings. */
export function keyId(key: ExactConfigurationKey): string {
  return JSON.stringify([
    key.platform,
    key.meetingApp,
    fold(key.meetingAppName ?? ''),
    key.clientKind,
    fold(key.browser ?? ''),
    key.captureMode,
    key.monitorCount,
    key.protectionEnabled,
  ]);
}

function timeOf(record: VerificationRecord): number {
  const value = Date.parse(record.testedAt);
  return Number.isNaN(value) ? 0 : value;
}

/** Newest first. */
export function sortNewestFirst(records: readonly VerificationRecord[]): VerificationRecord[] {
  return [...records].sort((a, b) => timeOf(b) - timeOf(a));
}

function expiryReason(
  record: VerificationRecord,
  environment: DetectedEnvironment,
  now: Date,
  current: CurrentVersions,
): ExpiryReason | undefined {
  if (record.osVersion !== environment.osVersion) return 'os_changed';
  if (record.electronVersion !== environment.electronVersion) return 'electron_changed';
  if (record.appVersion !== environment.appVersion) return 'app_changed';
  if (
    current.meetingAppVersion !== undefined &&
    current.meetingAppVersion.trim() !== record.meetingAppVersion.trim()
  ) {
    return 'meeting_app_version_changed';
  }
  if (
    current.browserVersion !== undefined &&
    record.client.kind === 'browser' &&
    current.browserVersion.trim() !== record.client.browserVersion.trim()
  ) {
    return 'browser_version_changed';
  }
  // Exactly VERIFICATION_MAX_AGE_DAYS days old is still current.
  if (now.getTime() - timeOf(record) > VERIFICATION_MAX_AGE_DAYS * DAY_MS) return 'too_old';
  return undefined;
}

export function evaluateVerification(
  records: readonly VerificationRecord[],
  key: ExactConfigurationKey,
  environment: DetectedEnvironment,
  now: Date,
  current: CurrentVersions = {},
): VerificationEvaluation {
  const newest = sortNewestFirst(records).find((record) =>
    keysEqual(configurationKeyOf(record), key),
  );
  if (!newest) return { state: 'manual_verification_required' };
  const reason = expiryReason(newest, environment, now, current);
  if (reason) return { state: 'verification_expired', record: newest, reason };
  return { state: 'verified', record: newest };
}

export interface HeadlineStatus {
  status: ProtectionStatus;
  label: string;
  /** What the second participant observed, whenever a record decided the status. */
  outcome?: ObservedOutcome;
  outcomeLabel?: string;
  /** True when the record is current. A stale record's outcome is shown as history only. */
  current: boolean;
  /** True for a verified result that is not `omitted`: the panel WAS seen, which is a verified negative. */
  negative: boolean;
  reason?: ExpiryReason;
  /** One sentence for display and export. */
  text: string;
}

export function headlineStatus(
  requestState: ProtectionRequestState,
  verification: VerificationEvaluation,
): HeadlineStatus {
  if (requestState !== 'os_accepted') {
    const label = PROTECTION_STATUS_LABELS[requestState];
    return { status: requestState, label, current: false, negative: false, text: label };
  }
  const status = verification.state;
  const label = PROTECTION_STATUS_LABELS[status];
  const outcome = verification.record?.remote.outcome;
  const result: HeadlineStatus = {
    status,
    label,
    current: status === 'verified',
    negative: status === 'verified' && outcome !== undefined && outcome !== 'omitted',
    text: label,
  };
  if (outcome) {
    result.outcome = outcome;
    result.outcomeLabel = OBSERVED_OUTCOME_LABELS[outcome];
  }
  if (verification.reason) result.reason = verification.reason;
  if (status === 'verified' && result.outcomeLabel) {
    result.text = `${label}: ${result.outcomeLabel}`;
  } else if (status === 'verification_expired' && verification.reason) {
    result.text = `${label}. ${EXPIRY_REASON_LABELS[verification.reason]}`;
  }
  return result;
}

export interface SummaryRow {
  id: string;
  key: ExactConfigurationKey;
  /** For example `Zoom, native client, Application`. */
  title: string;
  headline: HeadlineStatus;
  recordCount: number;
  latestTestedAt: string;
}

export function describeKey(key: ExactConfigurationKey): string {
  const app =
    key.meetingApp === 'other' && key.meetingAppName
      ? key.meetingAppName
      : MEETING_APP_LABELS[key.meetingApp];
  const client = key.clientKind === 'native' ? 'native client' : `${key.browser ?? 'browser'}`;
  const protection = key.protectionEnabled ? 'protection on' : 'protection off';
  const monitors = `${key.monitorCount} ${key.monitorCount === 1 ? 'display' : 'displays'}`;
  return `${app}, ${client}, ${CAPTURE_MODE_LABELS[key.captureMode]}, ${monitors}, ${protection}`;
}

/** "This computer now": the headline for every configuration tested on this operating system. */
export function summarize(
  records: readonly VerificationRecord[],
  environment: DetectedEnvironment,
  requestState: ProtectionRequestState,
  now: Date,
  current: CurrentVersions = {},
): SummaryRow[] {
  const groups = new Map<string, { key: ExactConfigurationKey; records: VerificationRecord[] }>();
  for (const record of records) {
    if (record.platform !== environment.platform) continue;
    const key = configurationKeyOf(record);
    const id = keyId(key);
    const group = groups.get(id);
    if (group) group.records.push(record);
    else groups.set(id, { key, records: [record] });
  }
  const rows: SummaryRow[] = [];
  for (const [id, group] of groups) {
    const newest = sortNewestFirst(group.records)[0];
    if (!newest) continue;
    rows.push({
      id,
      key: group.key,
      title: describeKey(group.key),
      headline: headlineStatus(
        requestState,
        evaluateVerification(group.records, group.key, environment, now, current),
      ),
      recordCount: group.records.length,
      latestTestedAt: newest.testedAt,
    });
  }
  return rows.sort((a, b) => b.latestTestedAt.localeCompare(a.latestTestedAt));
}

// ── Export ─────────────────────────────────────────────────────────────────────────────────────

const OBSERVER_LABELS: Readonly<Record<Observer, string>> = {
  second_participant: 'Second participant',
  second_device: 'Second device',
};

export function observerLabel(observer: Observer): string {
  return OBSERVER_LABELS[observer];
}

export const MARKDOWN_NOTICE =
  'RealtimeDocs cannot see what other participants receive. Each result below was entered by a person who checked on a second device or with another participant.';

function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function line(value: string | undefined): string {
  return value ? value.replace(/\r?\n/g, ' ').trim() : 'not recorded';
}

function clientText(record: VerificationRecord): string {
  return record.client.kind === 'native'
    ? 'Native client'
    : `${record.client.browser} ${record.client.browserVersion}`;
}

function appText(record: VerificationRecord): string {
  const name =
    record.meetingApp === 'other' && record.meetingAppName
      ? record.meetingAppName
      : MEETING_APP_LABELS[record.meetingApp];
  return `${name} ${record.meetingAppVersion}`;
}

export function toMarkdown(records: readonly VerificationRecord[]): string {
  const sorted = sortNewestFirst(records);
  const out: string[] = ['# RealtimeDocs Privacy Test Center records', '', MARKDOWN_NOTICE, ''];
  if (sorted.length === 0) {
    out.push('No records.', '');
    return out.join('\n');
  }
  out.push(
    '| Tested | Meeting app | Client | Capture mode | Displays | Protection | Remote outcome | Observed by |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const record of sorted) {
    out.push(
      `| ${cell(record.testedAt)} | ${cell(appText(record))} | ${cell(clientText(record))} | ${cell(
        CAPTURE_MODE_LABELS[record.captureMode],
      )} | ${record.monitors.count} | ${record.protectionEnabled ? 'on' : 'off'} | ${cell(
        OBSERVED_OUTCOME_LABELS[record.remote.outcome],
      )} | ${cell(OBSERVER_LABELS[record.remote.observedBy])} |`,
    );
  }
  out.push('');
  for (const record of sorted) {
    out.push(
      `## ${record.testedAt} — ${line(appText(record))}`,
      '',
      `- Record id: ${record.id}`,
      `- RealtimeDocs version: ${record.appVersion}`,
      `- Electron version: ${record.electronVersion}`,
      `- Operating system: ${record.platform} ${record.osVersion}`,
      `- Meeting app: ${line(appText(record))}`,
      `- Client: ${line(clientText(record))}`,
      `- Capture mode: ${CAPTURE_MODE_LABELS[record.captureMode]}`,
      `- Displays: ${record.monitors.count}; arrangement: ${line(record.monitors.arrangement)}`,
      `- Protection in RealtimeDocs: ${record.protectionEnabled ? 'on' : 'off'}`,
      `- Local result: ${line(record.localResult)}`,
      `- Remote outcome: ${OBSERVED_OUTCOME_LABELS[record.remote.outcome]}`,
      `- Observed by: ${OBSERVER_LABELS[record.remote.observedBy]}`,
      `- Observer note: ${line(record.remote.note)}`,
      `- Evidence: ${line(record.evidence)}`,
      `- Startup, document switch, resize, hide/show, protection toggle: ${line(record.transitions)}`,
      '',
    );
  }
  return out.join('\n');
}

export function toJSON(records: readonly VerificationRecord[]): string {
  return JSON.stringify(
    { format: 'realtimedocs-privacy-records', version: 1, records: sortNewestFirst(records) },
    null,
    2,
  );
}

/** Always visible in the Privacy Test Center. */
export const PRIVACY_NOTICE =
  'RealtimeDocs cannot see what other participants receive. A result counts as verified only when you confirmed it on a second device or with another participant. A local screenshot, an operating-system return value or this app’s own preview does not count.';
