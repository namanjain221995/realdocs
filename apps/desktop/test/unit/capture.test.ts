import { describe, expect, it } from 'vitest';
import {
  CAPTURE_REASONS,
  CAPTURE_STATUS_KINDS,
  MACOS_SINGLE_DISPLAY_WARNING,
  MACOS_WHOLE_DISPLAY_WARNING,
  NO_VERIFICATION,
  captureChip,
  captureTrayLines,
  classifyPlatformCapture,
  computeCaptureStatus,
  parseWindowsBuild,
  platformHasProtectionApi,
  summarizeVerification,
  type CaptureStatus,
  type CaptureStatusInput,
  type WindowProtectionResult,
} from '../../src/shared/capture';
import {
  PROTECTION_REQUEST_STATES,
  PROTECTION_STATUS_LABELS,
  type VerificationRecord,
} from '../../src/shared/privacy/status';
import type { DetectedEnvironment } from '../../src/shared/privacy/test-center';

const WIN11 = '10.0.22631';
const WIN10_22H2 = '10.0.19045';
const WIN10_2004 = '10.0.19041';
const WIN10_1909 = '10.0.18363';

function applied(
  window: WindowProtectionResult['window'],
  overrides: Partial<WindowProtectionResult> = {},
): WindowProtectionResult {
  return {
    window,
    requested: true,
    attempted: true,
    error: null,
    readBack: true,
    affinity: null,
    pendingComposition: false,
    composedAt: '2026-11-10T10:00:00.100Z',
    at: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

function input(overrides: Partial<CaptureStatusInput> = {}): CaptureStatusInput {
  return {
    mode: 'desktop',
    platform: 'win32',
    systemVersion: WIN11,
    requested: true,
    results: [applied('panel'), applied('settings')],
    ...overrides,
  };
}

describe('platform classification', () => {
  it('parses Windows build numbers', () => {
    expect(parseWindowsBuild(WIN11)).toBe(22631);
    expect(parseWindowsBuild('10.0.19041.1')).toBe(19041);
    expect(parseWindowsBuild('6.3.9600')).toBe(0);
    expect(parseWindowsBuild('unknown')).toBeNull();
    expect(parseWindowsBuild('')).toBeNull();
  });

  it('uses Windows 10 version 2004 (build 19041) as the exclusion boundary', () => {
    expect(classifyPlatformCapture('win32', WIN10_2004)).toEqual({
      kind: 'exclusion',
      windowsBuild: 19041,
    });
    expect(classifyPlatformCapture('win32', WIN10_22H2).kind).toBe('exclusion');
    expect(classifyPlatformCapture('win32', WIN11).kind).toBe('exclusion');
    expect(classifyPlatformCapture('win32', WIN10_1909)).toEqual({
      kind: 'black_window',
      windowsBuild: 18363,
    });
    expect(classifyPlatformCapture('win32', '10.0.19040').kind).toBe('black_window');
    expect(classifyPlatformCapture('win32', 'garbage').kind).toBe('windows_unknown');
  });

  it('never treats macOS or Linux as reliable exclusion', () => {
    for (const version of ['13.6.1', '14.6.1', '15.1', '26.0']) {
      expect(classifyPlatformCapture('darwin', version).kind).toBe('screencapturekit_unreliable');
    }
    expect(classifyPlatformCapture('linux', '6.8.0').kind).toBe('unavailable');
    expect(classifyPlatformCapture('freebsd', '14').kind).toBe('unavailable');
    expect(platformHasProtectionApi('win32')).toBe(true);
    expect(platformHasProtectionApi('darwin')).toBe(true);
    expect(platformHasProtectionApi('linux')).toBe(false);
  });
});

describe('request layer', () => {
  it('labels every status with the contract label of its request state', () => {
    const status = computeCaptureStatus(input());
    expect(status.request).toBe('os_accepted');
    expect(status.label).toBe(PROTECTION_STATUS_LABELS.os_accepted);
  });

  it('reports browser mode as unsupported, whatever else is set', () => {
    const status = computeCaptureStatus(input({ mode: 'browser', requested: true }));
    expect(status).toMatchObject({ request: 'unsupported', kind: 'browser_unavailable' });
    expect(status.label).toBe('Unsupported');
  });

  it('is off only when the user turned it off', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const status = computeCaptureStatus(input({ platform, requested: false, results: [] }));
      expect(status).toMatchObject({ request: 'off', kind: 'off', label: 'Protection off' });
      expect(status.detail).toContain('can appear in screen shares');
      expect(status.verification).toBeNull();
    }
  });

  it('Windows 10 2004+: accepted, read back and drawn once is "OS protection accepted"', () => {
    for (const systemVersion of [WIN10_2004, WIN10_22H2, WIN11]) {
      const status = computeCaptureStatus(input({ systemVersion }));
      expect(status).toMatchObject({ request: 'os_accepted', kind: 'requested', tone: 'info' });
      expect(status.warnings.join(' ')).toContain('second device');
      expect(status.warnings.join(' ')).toContain('next desktop composition');
      expect(status.verification).toEqual(NO_VERIFICATION);
    }
  });

  it('is never "accepted" before every visible window has been drawn since the request', () => {
    const status = computeCaptureStatus(
      input({ results: [applied('panel', { pendingComposition: true }), applied('settings')] }),
    );
    expect(status).toMatchObject({ request: 'unavailable', kind: 'pending' });
    expect(status.label).toBe('Protection unavailable');
    expect(status.verification).toBeNull();
  });

  it('Windows before 10 2004: unavailable, the OS replaces the window with a black area', () => {
    const status = computeCaptureStatus(input({ systemVersion: WIN10_1909 }));
    expect(status).toMatchObject({
      request: 'unavailable',
      kind: 'unreliable_platform',
      reason: 'windows_before_2004',
    });
    expect(status.detail).toContain('This Windows version replaces the window with a black area');
  });

  it('the diagnostics module decides when it is present', () => {
    expect(
      computeCaptureStatus(
        input({ results: [applied('panel', { affinity: 'exclude_from_capture' })] }),
      ).request,
    ).toBe('os_accepted');
    expect(
      computeCaptureStatus(input({ results: [applied('panel', { affinity: 'monitor' })] })),
    ).toMatchObject({ request: 'unavailable', reason: 'windows_before_2004' });
    for (const affinity of ['none', 'unknown'] as const) {
      expect(
        computeCaptureStatus(input({ results: [applied('panel', { affinity })] })).request,
      ).toBe('request_failed');
    }
  });

  it('unidentified Windows build: accepted, with the black-area caveat in the detail', () => {
    const status = computeCaptureStatus(input({ systemVersion: '' }));
    expect(status).toMatchObject({ request: 'os_accepted', reason: 'windows_build_unknown' });
    expect(status.detail).toContain('black area');
  });

  it('macOS: accepted is a best-effort request; the whole-display warning is always shown', () => {
    const status = computeCaptureStatus(
      input({ platform: 'darwin', systemVersion: '15.1', displayCount: 2 }),
    );
    expect(status).toMatchObject({
      request: 'os_accepted',
      kind: 'unreliable_platform',
      reason: 'macos_screencapturekit',
      tone: 'warning',
      singleDisplay: false,
    });
    expect(status.detail).toContain('ScreenCaptureKit');
    expect(status.warnings[0]).toBe(MACOS_WHOLE_DISPLAY_WARNING);
    expect(status.warnings).not.toContain(MACOS_SINGLE_DISPLAY_WARNING);
    // Also when private mode is off, and when the request failed.
    expect(
      computeCaptureStatus(input({ platform: 'darwin', systemVersion: '15.1', requested: false }))
        .warnings,
    ).toContain(MACOS_WHOLE_DISPLAY_WARNING);
    expect(
      computeCaptureStatus(
        input({
          platform: 'darwin',
          systemVersion: '15.1',
          results: [applied('panel', { readBack: false })],
        }),
      ).warnings,
    ).toContain(MACOS_WHOLE_DISPLAY_WARNING);
  });

  it('macOS with one display adds the single-display hint, after the whole-display warning', () => {
    const status = computeCaptureStatus(
      input({ platform: 'darwin', systemVersion: '15.1', displayCount: 1 }),
    );
    expect(status).toMatchObject({ singleDisplay: true, tone: 'danger' });
    expect(status.warnings.slice(0, 2)).toEqual([
      MACOS_WHOLE_DISPLAY_WARNING,
      MACOS_SINGLE_DISPLAY_WARNING,
    ]);
  });

  it('Linux: unsupported, and no OS call is expected', () => {
    const status = computeCaptureStatus(
      input({ platform: 'linux', systemVersion: '6.8.0', results: [] }),
    );
    expect(status).toMatchObject({ request: 'unsupported', reason: 'linux_unavailable' });
  });

  it('a thrown OS error is a failed request and names the windows', () => {
    const status = computeCaptureStatus(
      input({
        results: [
          applied('panel'),
          applied('settings', { error: 'SetWindowDisplayAffinity failed', readBack: null }),
        ],
      }),
    );
    expect(status).toMatchObject({
      request: 'request_failed',
      kind: 'request_failed',
      reason: 'os_call_failed',
      tone: 'danger',
      failedWindows: ['settings'],
    });
    expect(status.label).toBe('Protection request failed');
    expect(status.detail).toContain('settings');
  });

  it('a request that did not stick is a failed request, on macOS as well', () => {
    expect(
      computeCaptureStatus(input({ results: [applied('panel', { readBack: false })] })),
    ).toMatchObject({ request: 'request_failed', reason: 'not_applied', failedWindows: ['panel'] });
    expect(
      computeCaptureStatus(
        input({
          platform: 'darwin',
          systemVersion: '15.1',
          results: [applied('panel', { readBack: false })],
        }),
      ).request,
    ).toBe('request_failed');
  });

  it('one unprotected content window is enough to fail the whole status', () => {
    const status = computeCaptureStatus(
      input({
        results: [
          applied('panel'),
          applied('settings'),
          applied('probe', { attempted: false, readBack: null }),
        ],
      }),
    );
    expect(status.request).toBe('request_failed');
    expect(status.failedWindows).toEqual(['probe']);
  });
});

describe('verification layer', () => {
  const environment: DetectedEnvironment = {
    appVersion: '0.1.0',
    electronVersion: '45.2.3',
    platform: 'win32',
    osVersion: WIN11,
    displayCount: 2,
  };
  const now = new Date('2026-11-11T12:00:00.000Z');
  let counter = 0;
  function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
    counter += 1;
    return {
      id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
      testedAt: '2026-11-10T10:00:00.000Z',
      appVersion: '0.1.0',
      electronVersion: '45.2.3',
      platform: 'win32',
      osVersion: WIN11,
      meetingApp: 'zoom',
      meetingAppVersion: '6.4.1',
      client: { kind: 'native' },
      captureMode: 'entire_display',
      monitors: { count: 2 },
      protectionEnabled: true,
      localResult: 'Panel visible here',
      remote: { observedBy: 'second_device', outcome: 'omitted' },
      ...overrides,
    };
  }

  it('without a current record for this computer: "Manual verification required"', () => {
    expect(summarizeVerification([], environment, now)).toEqual(NO_VERIFICATION);
    expect(NO_VERIFICATION.line).toBe(PROTECTION_STATUS_LABELS.manual_verification_required);
    // Another platform, or a test made with protection off, says nothing about this one.
    expect(
      summarizeVerification(
        [record({ platform: 'darwin', osVersion: '15.1' }), record({ protectionEnabled: false })],
        environment,
        now,
      ).line,
    ).toBe('Manual verification required');
  });

  it('counts configurations, never claims one, and points to the Test Center', () => {
    const summary = summarizeVerification(
      [record(), record({ captureMode: 'window' }), record({ meetingApp: 'teams' })],
      environment,
      now,
    );
    expect(summary).toMatchObject({ state: 'verified', verified: 3, expired: 0, negative: 0 });
    expect(summary.line).toBe('Verified for 3 configurations — see Privacy Test Center');
    expect(summarizeVerification([record()], environment, now).line).toBe(
      'Verified for 1 configuration — see Privacy Test Center',
    );
  });

  it('says when verifications expired, in the contract words', () => {
    const onlyExpired = summarizeVerification(
      [record({ osVersion: '10.0.22621' })],
      environment,
      now,
    );
    expect(onlyExpired).toMatchObject({ verified: 0, expired: 1, state: 'verification_expired' });
    expect(onlyExpired.line).toBe('Manual verification required');
    expect(onlyExpired.warnings).toEqual([
      `${PROTECTION_STATUS_LABELS.verification_expired} (1 configuration)`,
    ]);
    const mixed = summarizeVerification(
      [record(), record({ captureMode: 'tab', testedAt: '2026-09-01T10:00:00.000Z' })],
      environment,
      now,
    );
    expect(mixed).toMatchObject({ verified: 1, expired: 1 });
    expect(mixed.warnings[0]).toContain(PROTECTION_STATUS_LABELS.verification_expired);
  });

  it('does not let a test in which the panel was seen read like reassurance', () => {
    const summary = summarizeVerification(
      [
        record(),
        record({
          captureMode: 'window',
          remote: { observedBy: 'second_participant', outcome: 'visible' },
        }),
      ],
      environment,
      now,
    );
    expect(summary).toMatchObject({ verified: 2, negative: 1 });
    expect(summary.warnings.join(' ')).toContain('still saw the panel');
  });

  it('shows the verification line only under "OS protection accepted"', () => {
    const verification = summarizeVerification([record()], environment, now);
    expect(computeCaptureStatus(input({ verification })).verification).toEqual(verification);
    for (const other of [
      input({ verification, requested: false }),
      input({ verification, systemVersion: WIN10_1909 }),
      input({ verification, results: [applied('panel', { readBack: false })] }),
      input({ verification, platform: 'linux', results: [] }),
    ]) {
      expect(computeCaptureStatus(other).verification).toBeNull();
    }
  });
});

describe('chip, tray and settings say the same thing', () => {
  const verified = {
    ...NO_VERIFICATION,
    state: 'verified' as const,
    line: 'Verified for 2 configurations — see Privacy Test Center',
    verified: 2,
  };
  // One input for every state the status can be in: every kind, every reason,
  // every request state, with and without verification records.
  const cases: [string, CaptureStatusInput][] = [
    ['browser', input({ mode: 'browser' })],
    ['off', input({ requested: false })],
    ['accepted on Windows 11', input()],
    ['accepted, verified', input({ verification: verified })],
    [
      'waiting for a composition',
      input({ results: [applied('panel', { pendingComposition: true })] }),
    ],
    ['Windows before 10 2004', input({ systemVersion: WIN10_1909 })],
    ['Windows build unknown', input({ systemVersion: '' })],
    ['macOS', input({ platform: 'darwin', systemVersion: '15.1', displayCount: 2 })],
    ['macOS, one display', input({ platform: 'darwin', systemVersion: '15.1', displayCount: 1 })],
    ['Linux', input({ platform: 'linux', systemVersion: '6.8', results: [] })],
    ['another platform', input({ platform: 'freebsd', systemVersion: '14.1', results: [] })],
    ['OS call failed', input({ results: [applied('panel', { error: 'boom', readBack: null })] })],
    ['request did not stick', input({ results: [applied('panel', { readBack: false })] })],
  ];
  const samples = cases.map(([name, value]) => ({ name, status: computeCaptureStatus(value) }));
  const statuses: CaptureStatus[] = samples.map((sample) => sample.status);

  it('covers every request state, every kind and every reason', () => {
    expect(new Set(statuses.map((status) => status.request))).toEqual(
      new Set(PROTECTION_REQUEST_STATES),
    );
    expect(new Set(statuses.map((status) => status.kind))).toEqual(new Set(CAPTURE_STATUS_KINDS));
    expect(
      new Set(statuses.map((status) => status.reason).filter((reason) => reason !== null)),
    ).toEqual(new Set(CAPTURE_REASONS));
  });

  it.each(samples)('the same label and line on all three surfaces: $name', ({ status }) => {
    const chip = captureChip(status);
    const tray = captureTrayLines(status);
    // Settings shows `status.label` and, when there is one, `status.verification.line`.
    const settings = status.verification
      ? [status.label, status.verification.line]
      : [status.label];
    expect(status.label).toBe(PROTECTION_STATUS_LABELS[status.request]);
    expect(chip.label).toBe(status.label);
    expect(tray).toEqual(settings);
    expect(chip.secondary === null ? [chip.label] : [chip.label, chip.secondary]).toEqual(settings);
    // The verification line exists exactly when the OS accepted the request.
    expect(status.verification !== null).toBe(status.request === 'os_accepted');
    // The chip's explanation carries every caveat Settings lists.
    for (const warning of status.warnings) expect(chip.explanation).toContain(warning);
    expect(chip.explanation[0]).toBe(status.detail);
    expect(chip.tone).toBe(status.tone);
  });

  it('two states share a label only if they share a request state', () => {
    const byLabel = new Map<string, Set<string>>();
    for (const status of statuses) {
      byLabel.set(status.label, (byLabel.get(status.label) ?? new Set()).add(status.request));
    }
    for (const [label, requests] of byLabel) expect([...requests], label).toHaveLength(1);
  });
});
