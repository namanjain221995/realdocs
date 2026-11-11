/**
 * The Privacy Test Center form as plain data, plus the validation that turns it into a
 * `VerificationRecord`. Pure: the component and the tests share it, and the main process validates
 * again with the zod schema before anything is written.
 */
import {
  OBSERVED_OUTCOMES,
  OBSERVERS,
  VerificationRecord,
  type CaptureMode,
  type ClientKind,
  type MeetingApp,
  type ObservedOutcome,
  type Observer,
} from './status';
import type { DetectedEnvironment } from './test-center';

export interface Draft {
  meetingApp: MeetingApp;
  meetingAppName: string;
  meetingAppVersion: string;
  clientKind: ClientKind;
  browser: string;
  browserVersion: string;
  captureMode: CaptureMode;
  monitorCount: string;
  arrangement: string;
  protectionEnabled: boolean;
  localResult: string;
  /** Empty until the person chooses: there is deliberately no default. */
  outcome: ObservedOutcome | '';
  observedBy: Observer | '';
  note: string;
  evidence: string;
  transitions: string;
}

export type DraftField = keyof Draft;

export const REQUIRED_FIELD_MESSAGES = {
  meetingAppName: 'Enter the name of the meeting app.',
  meetingAppVersion: 'Enter the meeting app version.',
  browser: 'Enter the browser name.',
  browserVersion: 'Enter the browser version.',
  monitorCount: 'Enter a number of displays from 1 to 16.',
  localResult: 'Describe what you saw on this computer.',
  outcome:
    'Choose what the second participant or device received. Without it the result cannot be saved.',
  observedBy: 'Say who confirmed it: a second participant or a second device.',
} as const;

export function emptyDraft(environment: DetectedEnvironment, protectionEnabled: boolean): Draft {
  return {
    meetingApp: 'zoom',
    meetingAppName: '',
    meetingAppVersion: '',
    clientKind: 'native',
    browser: '',
    browserVersion: '',
    captureMode: 'window',
    monitorCount: String(Math.min(16, Math.max(1, environment.displayCount))),
    arrangement: '',
    protectionEnabled,
    localResult: '',
    outcome: '',
    observedBy: '',
    note: '',
    evidence: '',
    transitions: '',
  };
}

export type DraftResult =
  | { ok: true; record: VerificationRecord }
  | { ok: false; errors: Partial<Record<DraftField, string>> };

const blank = (value: string): boolean => value.trim().length === 0;
const optional = (value: string): string | undefined => (blank(value) ? undefined : value.trim());

export function validateDraft(
  draft: Draft,
  environment: DetectedEnvironment,
  id: string,
  now: Date,
): DraftResult {
  const errors: Partial<Record<DraftField, string>> = {};
  const need = (field: keyof typeof REQUIRED_FIELD_MESSAGES, missing: boolean): void => {
    if (missing) errors[field] = REQUIRED_FIELD_MESSAGES[field];
  };
  need('meetingAppName', draft.meetingApp === 'other' && blank(draft.meetingAppName));
  need('meetingAppVersion', blank(draft.meetingAppVersion));
  need('browser', draft.clientKind === 'browser' && blank(draft.browser));
  need('browserVersion', draft.clientKind === 'browser' && blank(draft.browserVersion));
  const count = Number(draft.monitorCount);
  need('monitorCount', !Number.isInteger(count) || count < 1 || count > 16);
  need('localResult', blank(draft.localResult));
  need('outcome', !(OBSERVED_OUTCOMES as readonly string[]).includes(draft.outcome));
  need('observedBy', !(OBSERVERS as readonly string[]).includes(draft.observedBy));
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const candidate = {
    id,
    testedAt: now.toISOString(),
    appVersion: environment.appVersion,
    electronVersion: environment.electronVersion,
    platform: environment.platform,
    osVersion: environment.osVersion,
    meetingApp: draft.meetingApp,
    ...(draft.meetingApp === 'other' ? { meetingAppName: draft.meetingAppName.trim() } : {}),
    meetingAppVersion: draft.meetingAppVersion.trim(),
    client:
      draft.clientKind === 'native'
        ? { kind: 'native' as const }
        : {
            kind: 'browser' as const,
            browser: draft.browser.trim(),
            browserVersion: draft.browserVersion.trim(),
          },
    captureMode: draft.captureMode,
    monitors: { count, arrangement: optional(draft.arrangement) },
    protectionEnabled: draft.protectionEnabled,
    localResult: draft.localResult.trim(),
    remote: { observedBy: draft.observedBy, outcome: draft.outcome, note: optional(draft.note) },
    evidence: optional(draft.evidence),
    transitions: optional(draft.transitions),
  };
  const parsed = VerificationRecord.safeParse(JSON.parse(JSON.stringify(candidate)));
  if (!parsed.success) {
    // Length limits and the like: report on the first offending field.
    const errors2: Partial<Record<DraftField, string>> = {};
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      const field = mapPath(issue.path);
      if (field && !errors2[field]) errors2[field] = issue.message;
      else if (!field && typeof head === 'string' && !errors2.localResult) {
        errors2.localResult = `${head}: ${issue.message}`;
      }
    }
    return { ok: false, errors: errors2 };
  }
  return { ok: true, record: parsed.data };
}

function mapPath(path: readonly PropertyKey[]): DraftField | undefined {
  const [a, b] = path;
  if (a === 'remote')
    return b === 'outcome' ? 'outcome' : b === 'observedBy' ? 'observedBy' : 'note';
  if (a === 'client') return b === 'browser' ? 'browser' : 'browserVersion';
  if (a === 'monitors') return b === 'arrangement' ? 'arrangement' : 'monitorCount';
  const direct: Partial<Record<string, DraftField>> = {
    meetingAppName: 'meetingAppName',
    meetingAppVersion: 'meetingAppVersion',
    localResult: 'localResult',
    evidence: 'evidence',
    transitions: 'transitions',
  };
  return typeof a === 'string' ? direct[a] : undefined;
}
