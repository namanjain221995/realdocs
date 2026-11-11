// No DOM environment (happy-dom / jsdom) is configured for the desktop project, so the component is
// rendered to static HTML with react-dom/server. Interaction rules (required remote outcome and
// observer) are tested on the shared `validateDraft` that the component calls on submit.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrivacyTestCenter } from '../../src/renderer/privacy/PrivacyTestCenter';
import {
  FORBIDDEN_PROTECTION_WORDS,
  OBSERVED_OUTCOME_LABELS,
  PROTECTION_STATUS_LABELS,
  type VerificationRecord,
} from '../../src/shared/privacy/status';
import { PRIVACY_NOTICE, type DetectedEnvironment } from '../../src/shared/privacy/test-center';

const ENV: DetectedEnvironment = {
  appVersion: '0.1.0',
  electronVersion: '45.2.3',
  platform: 'win32',
  osVersion: '10.0.26100',
  displayCount: 2,
};
const NOW = new Date('2026-11-11T12:00:00.000Z');

function record(id: string, overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id,
    testedAt: '2026-11-10T10:00:00.000Z',
    appVersion: ENV.appVersion,
    electronVersion: ENV.electronVersion,
    platform: 'win32',
    osVersion: ENV.osVersion,
    meetingApp: 'zoom',
    meetingAppVersion: '6.2.0',
    client: { kind: 'native' },
    captureMode: 'window',
    monitors: { count: 2 },
    protectionEnabled: true,
    localResult: 'ok',
    remote: { observedBy: 'second_device', outcome: 'visible' },
    ...overrides,
  };
}

function render(
  records: VerificationRecord[],
  requestState: Parameters<typeof PrivacyTestCenter>[0]['requestState'] = 'os_accepted',
): string {
  return renderToStaticMarkup(
    createElement(PrivacyTestCenter, {
      environment: ENV,
      requestState,
      records,
      onSave: () => undefined,
      onDelete: () => undefined,
      onExport: () => undefined,
      now: NOW,
    }),
  );
}

describe('privacy component', () => {
  const html = render([
    record('11111111-1111-4111-8111-111111111111'),
    record('22222222-2222-4222-8222-222222222222', {
      meetingApp: 'teams',
      testedAt: '2026-10-01T10:00:00.000Z',
      remote: { observedBy: 'second_participant', outcome: 'omitted' },
    }),
  ]);
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

  it('always shows the notice, verbatim', () => {
    expect(text).toContain(PRIVACY_NOTICE);
  });

  it('renders the form with detected values read-only and required remote fields', () => {
    expect(html).toContain('Operating system and build');
    expect(html).toContain('win32 10.0.26100');
    expect(html).toMatch(/readOnly|readonly/i);
    expect(text).toContain('What the second participant or device received (required)');
    expect(html).toContain('aria-label="Observed by (required)"');
    expect(text).toContain('Save test result');
    expect(text).toContain(
      'Behaviour during startup, document switch, resize, hide/show and protection toggle',
    );
  });

  it('shows no remote outcome preselected', () => {
    // The only selected outcome option is the disabled placeholder; no observer radio is checked.
    expect(html).toContain(
      '<option value="" disabled="" hidden="" selected="">Choose the observed result</option>',
    );
    expect(html).not.toContain('aria-checked="true"');
  });

  it('renders the summary, status labels, outcomes, actions and exports', () => {
    expect(text).toContain('This computer now');
    expect(text).toContain(PROTECTION_STATUS_LABELS.verified);
    expect(text).toContain(PROTECTION_STATUS_LABELS.verification_expired);
    expect(text).toContain(OBSERVED_OUTCOME_LABELS.visible);
    expect(text).toContain(OBSERVED_OUTCOME_LABELS.omitted);
    expect(text).toContain('Verify again');
    expect(text).toContain('Delete');
    expect(text).toContain('Export as Markdown');
    expect(text).toContain('Export as JSON');
  });

  it('shows the request state, not a verification, when the OS did not accept', () => {
    const failed = render(
      [record('11111111-1111-4111-8111-111111111111')],
      'request_failed',
    ).replace(/<[^>]+>/g, ' ');
    expect(failed).toContain(PROTECTION_STATUS_LABELS.request_failed);
    expect(failed).not.toContain(PROTECTION_STATUS_LABELS.verified);
  });

  it('explains an empty state', () => {
    expect(render([]).replace(/<[^>]+>/g, ' ')).toContain('No tests recorded.');
  });

  it('contains no forbidden protection word in any rendered text', () => {
    const everything = [html, render([], 'unsupported'), render([], 'off')].join(' ').toLowerCase();
    for (const word of FORBIDDEN_PROTECTION_WORDS) expect(everything).not.toContain(word);
  });
});
