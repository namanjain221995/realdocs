import { describe, expect, it } from 'vitest';
import { emptyDraft, validateDraft } from '../../src/shared/privacy/draft';
import { ExportPrivacyRecordsInput, RemovePrivacyRecordInput } from '../../src/shared/privacy/ipc';
import {
  FORBIDDEN_PROTECTION_WORDS,
  OBSERVED_OUTCOME_LABELS,
  PROTECTION_REQUEST_STATES,
  PROTECTION_STATUS_LABELS,
  VERIFICATION_MAX_AGE_DAYS,
  VerificationRecord,
} from '../../src/shared/privacy/status';
import {
  EXPIRY_REASON_LABELS,
  EXPIRY_REASONS,
  MARKDOWN_NOTICE,
  PRIVACY_NOTICE,
  configurationKeyOf,
  evaluateVerification,
  headlineStatus,
  keysEqual,
  summarize,
  toJSON,
  toMarkdown,
  type DetectedEnvironment,
} from '../../src/shared/privacy/test-center';

const ENV: DetectedEnvironment = {
  appVersion: '0.1.0',
  electronVersion: '45.2.3',
  platform: 'win32',
  osVersion: '10.0.26100',
  displayCount: 2,
};
const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    testedAt: '2026-11-10T10:00:00.000Z',
    appVersion: ENV.appVersion,
    electronVersion: ENV.electronVersion,
    platform: 'win32',
    osVersion: ENV.osVersion,
    meetingApp: 'zoom',
    meetingAppVersion: '6.2.0',
    client: { kind: 'native' },
    captureMode: 'window',
    monitors: { count: 2, arrangement: 'panel on display 2' },
    protectionEnabled: true,
    localResult: 'Panel visible on my screen.',
    remote: { observedBy: 'second_device', outcome: 'omitted' },
    ...overrides,
  };
}

describe('privacy: configuration keys', () => {
  it('compares browser names case-insensitively and everything else exactly', () => {
    const a = record({ client: { kind: 'browser', browser: 'Chrome', browserVersion: '140' } });
    const b = record({ client: { kind: 'browser', browser: ' chrome ', browserVersion: '141' } });
    expect(keysEqual(configurationKeyOf(a), configurationKeyOf(b))).toBe(true);
    const edge = record({ client: { kind: 'browser', browser: 'Edge', browserVersion: '140' } });
    expect(keysEqual(configurationKeyOf(a), configurationKeyOf(edge))).toBe(false);
    for (const change of [
      { captureMode: 'tab' as const },
      { meetingApp: 'teams' as const },
      { protectionEnabled: false },
      { monitors: { count: 3 } },
      { platform: 'darwin' as const },
      { client: { kind: 'native' as const } },
    ]) {
      expect(keysEqual(configurationKeyOf(a), configurationKeyOf(record(change)))).toBe(false);
    }
  });

  it('tells two "Other" meeting apps apart by name', () => {
    const a = record({ meetingApp: 'other', meetingAppName: 'Acme Meet' });
    const b = record({ meetingApp: 'other', meetingAppName: 'acme meet' });
    const c = record({ meetingApp: 'other', meetingAppName: 'Other Co' });
    expect(keysEqual(configurationKeyOf(a), configurationKeyOf(b))).toBe(true);
    expect(keysEqual(configurationKeyOf(a), configurationKeyOf(c))).toBe(false);
  });
});

describe('privacy: evaluateVerification', () => {
  const key = configurationKeyOf(record());

  it('requires manual verification when nothing matches', () => {
    expect(evaluateVerification([], key, ENV, NOW)).toEqual({
      state: 'manual_verification_required',
    });
    const other = record({ captureMode: 'tab' });
    expect(evaluateVerification([other], key, ENV, NOW).state).toBe('manual_verification_required');
  });

  it('is verified for the newest matching current record', () => {
    const older = record({ testedAt: '2026-11-01T00:00:00.000Z' });
    const newer = record({
      testedAt: '2026-11-10T00:00:00.000Z',
      remote: { observedBy: 'second_participant', outcome: 'black' },
    });
    const result = evaluateVerification([older, newer], key, ENV, NOW);
    expect(result.state).toBe('verified');
    expect(result.record?.id).toBe(newer.id);
  });

  it('judges the newest record, not an older current one', () => {
    const old = record({ testedAt: '2026-10-01T00:00:00.000Z' });
    const stale = record({ testedAt: '2026-11-10T00:00:00.000Z', osVersion: '10.0.19045' });
    const result = evaluateVerification([old, stale], key, ENV, NOW);
    expect(result).toMatchObject({ state: 'verification_expired', reason: 'os_changed' });
  });

  it('expires for every reason', () => {
    const cases: Array<[string, VerificationRecord, DetectedEnvironment, object]> = [
      ['os_changed', record({ osVersion: '10.0.1' }), ENV, {}],
      ['electron_changed', record({ electronVersion: '44.0.0' }), ENV, {}],
      ['app_changed', record({ appVersion: '0.0.9' }), ENV, {}],
      ['meeting_app_version_changed', record(), ENV, { meetingAppVersion: '6.3.0' }],
      [
        'browser_version_changed',
        record({ client: { kind: 'browser', browser: 'Chrome', browserVersion: '140' } }),
        ENV,
        { browserVersion: '141' },
      ],
      ['too_old', record({ testedAt: new Date(NOW.getTime() - 31 * DAY).toISOString() }), ENV, {}],
    ];
    expect(cases.map(([reason]) => reason).sort()).toEqual([...EXPIRY_REASONS].sort());
    for (const [reason, rec, env, current] of cases) {
      const result = evaluateVerification([rec], configurationKeyOf(rec), env, NOW, current);
      expect(result.state).toBe('verification_expired');
      expect(result.reason).toBe(reason);
      expect(result.record?.id).toBe(rec.id);
      expect(EXPIRY_REASON_LABELS[result.reason!]).toBeTruthy();
    }
  });

  it('does not compare typed versions unless the caller passes them', () => {
    const rec = record({ client: { kind: 'browser', browser: 'Chrome', browserVersion: '140' } });
    expect(evaluateVerification([rec], configurationKeyOf(rec), ENV, NOW).state).toBe('verified');
    expect(
      evaluateVerification([rec], configurationKeyOf(rec), ENV, NOW, {
        meetingAppVersion: ' 6.2.0 ',
        browserVersion: '140',
      }).state,
    ).toBe('verified');
  });

  it('treats exactly the maximum age as current and one millisecond more as expired', () => {
    const edge = new Date(NOW.getTime() - VERIFICATION_MAX_AGE_DAYS * DAY);
    const at = record({ testedAt: edge.toISOString() });
    const over = record({ testedAt: new Date(edge.getTime() - 1).toISOString() });
    expect(evaluateVerification([at], configurationKeyOf(at), ENV, NOW).state).toBe('verified');
    expect(evaluateVerification([over], configurationKeyOf(over), ENV, NOW)).toMatchObject({
      state: 'verification_expired',
      reason: 'too_old',
    });
  });
});

describe('privacy: headlineStatus', () => {
  const verified = evaluateVerification([record()], configurationKeyOf(record()), ENV, NOW);
  const none = evaluateVerification([], configurationKeyOf(record()), ENV, NOW);

  it('returns the request state for every state except os_accepted', () => {
    for (const state of PROTECTION_REQUEST_STATES) {
      if (state === 'os_accepted') continue;
      const headline = headlineStatus(state, verified);
      expect(headline.status).toBe(state);
      expect(headline.label).toBe(PROTECTION_STATUS_LABELS[state]);
      expect(headline.outcome).toBeUndefined();
      expect(headline.current).toBe(false);
    }
  });

  it('returns the verification state for os_accepted, with the observed outcome', () => {
    expect(headlineStatus('os_accepted', none)).toMatchObject({
      status: 'manual_verification_required',
      label: PROTECTION_STATUS_LABELS.manual_verification_required,
    });
    const ok = headlineStatus('os_accepted', verified);
    expect(ok).toMatchObject({
      status: 'verified',
      outcome: 'omitted',
      current: true,
      negative: false,
    });
    expect(ok.text).toContain(OBSERVED_OUTCOME_LABELS.omitted);
  });

  it('reads a verified "visible" result as a verified negative, never as an omission', () => {
    const rec = record({ remote: { observedBy: 'second_participant', outcome: 'visible' } });
    const headline = headlineStatus(
      'os_accepted',
      evaluateVerification([rec], configurationKeyOf(rec), ENV, NOW),
    );
    expect(headline).toMatchObject({ status: 'verified', outcome: 'visible', negative: true });
    expect(headline.text).toContain(OBSERVED_OUTCOME_LABELS.visible);
    expect(headline.text).not.toContain(OBSERVED_OUTCOME_LABELS.omitted);
    for (const outcome of ['black', 'artifact'] as const) {
      const r = record({ remote: { observedBy: 'second_device', outcome } });
      const h = headlineStatus(
        'os_accepted',
        evaluateVerification([r], configurationKeyOf(r), ENV, NOW),
      );
      expect(h.negative).toBe(true);
      expect(h.outcome).toBe(outcome);
    }
  });

  it('shows the reason and the last outcome for an expired record, marked not current', () => {
    const rec = record({ appVersion: '0.0.1' });
    const headline = headlineStatus(
      'os_accepted',
      evaluateVerification([rec], configurationKeyOf(rec), ENV, NOW),
    );
    expect(headline).toMatchObject({
      status: 'verification_expired',
      reason: 'app_changed',
      current: false,
      negative: false,
      outcome: 'omitted',
    });
    expect(headline.text).toContain(EXPIRY_REASON_LABELS.app_changed);
  });
});

describe('privacy: summarize', () => {
  it('lists each configuration tested on this computer, with its own headline', () => {
    const zoom = record();
    const teamsStale = record({
      meetingApp: 'teams',
      osVersion: '10.0.1',
      testedAt: '2026-11-09T00:00:00.000Z',
    });
    const mac = record({ platform: 'darwin' });
    const rows = summarize([zoom, teamsStale, mac], ENV, 'os_accepted', NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.headline.status).toBe('verified');
    expect(rows[0]?.title).toContain('Zoom');
    expect(rows[1]?.headline.status).toBe('verification_expired');
  });

  it('shows the request state when the OS did not accept', () => {
    const rows = summarize([record()], ENV, 'request_failed', NOW);
    expect(rows[0]?.headline.status).toBe('request_failed');
  });

  it('groups repeated tests of one configuration', () => {
    const rows = summarize(
      [record(), record({ testedAt: '2026-11-05T00:00:00.000Z' })],
      ENV,
      'os_accepted',
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordCount).toBe(2);
  });
});

describe('privacy: schema and draft', () => {
  it('rejects a record without a remote observation', () => {
    const { remote: _remote, ...without } = record();
    expect(VerificationRecord.safeParse(without).success).toBe(false);
    expect(VerificationRecord.safeParse({ ...without, remote: {} }).success).toBe(false);
    expect(
      VerificationRecord.safeParse({ ...without, remote: { outcome: 'omitted' } }).success,
    ).toBe(false);
    expect(
      VerificationRecord.safeParse({
        ...without,
        remote: { observedBy: 'this_computer', outcome: 'omitted' },
      }).success,
    ).toBe(false);
    expect(VerificationRecord.safeParse(record()).success).toBe(true);
  });

  it('refuses to build a record without a remote outcome and observer, and says why', () => {
    const draft = {
      ...emptyDraft(ENV, true),
      meetingAppVersion: '6.2.0',
      localResult: 'Visible locally',
    };
    const result = validateDraft(draft, ENV, '00000000-0000-4000-8000-0000000000aa', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.outcome).toMatch(/cannot be saved/);
      expect(result.errors.observedBy).toBeTruthy();
    }
    const withOutcome = validateDraft(
      { ...draft, outcome: 'omitted' },
      ENV,
      '00000000-0000-4000-8000-0000000000aa',
      NOW,
    );
    expect(withOutcome.ok).toBe(false);
    const complete = validateDraft(
      { ...draft, outcome: 'omitted', observedBy: 'second_device' },
      ENV,
      '00000000-0000-4000-8000-0000000000aa',
      NOW,
    );
    expect(complete.ok).toBe(true);
    if (complete.ok) expect(complete.record.appVersion).toBe(ENV.appVersion);
  });

  it('enforces the other required fields', () => {
    const base = {
      ...emptyDraft(ENV, true),
      outcome: 'black' as const,
      observedBy: 'second_participant' as const,
    };
    const result = validateDraft(
      { ...base, meetingApp: 'other', clientKind: 'browser', monitorCount: '0' },
      ENV,
      '00000000-0000-4000-8000-0000000000aa',
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        [
          'browser',
          'browserVersion',
          'localResult',
          'meetingAppName',
          'meetingAppVersion',
          'monitorCount',
        ].sort(),
      );
    }
  });

  it('validates the recommended IPC inputs strictly', () => {
    expect(ExportPrivacyRecordsInput.safeParse({ format: 'json' }).success).toBe(true);
    expect(ExportPrivacyRecordsInput.safeParse({ format: 'html' }).success).toBe(false);
    expect(ExportPrivacyRecordsInput.safeParse({ format: 'json', path: '/etc' }).success).toBe(
      false,
    );
    expect(RemovePrivacyRecordInput.safeParse({ id: '../x' }).success).toBe(false);
  });
});

describe('privacy: export', () => {
  const records = [
    record({
      testedAt: '2026-11-09T10:00:00.000Z',
      evidence: 'photo-1.jpg',
      transitions: 'Held on resize',
    }),
    record({
      testedAt: '2026-11-10T10:00:00.000Z',
      meetingApp: 'other',
      meetingAppName: 'Acme | Meet',
      client: { kind: 'browser', browser: 'Firefox', browserVersion: '150' },
      remote: { observedBy: 'second_participant', outcome: 'visible', note: 'Clearly shown' },
    }),
  ];

  it('writes a table and one evidence block per record, newest first', () => {
    const md = toMarkdown(records);
    expect(md).toContain('| Tested | Meeting app |');
    expect(md.match(/^## /gm)).toHaveLength(2);
    expect(md.indexOf('2026-11-10')).toBeLessThan(md.indexOf('2026-11-09'));
    expect(md).toContain('Acme \\| Meet');
    expect(md).toContain(OBSERVED_OUTCOME_LABELS.visible);
    expect(md).toContain('Observed by: Second participant');
    expect(md).toContain('Evidence: photo-1.jpg');
    expect(md).toContain('Evidence: not recorded');
    expect(md).toContain(
      'Startup, document switch, resize, hide/show, protection toggle: Held on resize',
    );
    expect(toMarkdown([])).toContain('No records.');
  });

  it('round-trips through JSON and the schema', () => {
    const parsed = JSON.parse(toJSON(records)) as { format: string; records: unknown[] };
    expect(parsed.format).toBe('realtimedocs-privacy-records');
    expect(parsed.records.map((r) => VerificationRecord.parse(r).id).sort()).toEqual(
      records.map((r) => r.id).sort(),
    );
  });

  it('never uses a forbidden protection word in its own text', () => {
    const texts = [
      toMarkdown(records),
      toJSON(records),
      MARKDOWN_NOTICE,
      PRIVACY_NOTICE,
      ...Object.values(EXPIRY_REASON_LABELS),
      ...Object.values(PROTECTION_STATUS_LABELS),
      ...Object.values(OBSERVED_OUTCOME_LABELS),
    ].map((t) => t.toLowerCase());
    for (const text of texts) {
      for (const word of FORBIDDEN_PROTECTION_WORDS) expect(text).not.toContain(word);
    }
    expect(
      PRIVACY_NOTICE.startsWith('RealtimeDocs cannot see what other participants receive.'),
    ).toBe(true);
  });
});
