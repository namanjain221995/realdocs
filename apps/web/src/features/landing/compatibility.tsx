import verifiedFile from './verified-configurations.json';

export type Platform = 'windows' | 'macos';
export type CaptureMode = 'tab' | 'window' | 'application' | 'entire_display';

/**
 * One manually tested configuration. The owner adds these after real tests on real
 * computers, each pointing at its evidence record in `docs/capture-compatibility.md`.
 */
export interface VerifiedConfiguration {
  platform: Platform;
  osVersion: string;
  /** `zoom`, `teams`, `meet`, `webex`, `lark` or `chime` (the display name works too). */
  meetingApp: string;
  /** Native app or browser, with its version. */
  client: string;
  captureMode: CaptureMode;
  monitors: string | number;
  protectionEnabled: boolean;
  /** What the second participant saw, in the words of the evidence record. */
  outcome: string;
  /** ISO date of the test. */
  testedAt: string;
  appVersion: string;
  /** Where the evidence is, e.g. `docs/capture-compatibility.md#windows-zoom-window`. */
  evidence: string;
}

export const MEETING_APPS = [
  { id: 'zoom', label: 'Zoom' },
  { id: 'teams', label: 'Microsoft Teams' },
  { id: 'meet', label: 'Google Meet' },
  { id: 'webex', label: 'Webex' },
  { id: 'lark', label: 'Lark' },
  { id: 'chime', label: 'Amazon Chime' },
] as const;

export const CAPTURE_MODES: readonly { id: CaptureMode; label: string }[] = [
  { id: 'tab', label: 'Tab' },
  { id: 'window', label: 'Window' },
  { id: 'application', label: 'Application' },
  { id: 'entire_display', label: 'Entire display' },
];

const PLATFORMS: readonly { id: Platform; label: string }[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos', label: 'macOS' },
];

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Entries that are not complete records are ignored: a half-filled entry proves nothing. */
export function isVerifiedConfiguration(value: unknown): value is VerifiedConfiguration {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.platform === 'windows' || entry.platform === 'macos') &&
    CAPTURE_MODES.some((mode) => mode.id === entry.captureMode) &&
    isText(entry.meetingApp) &&
    isText(entry.osVersion) &&
    isText(entry.client) &&
    isText(entry.outcome) &&
    isText(entry.testedAt) &&
    isText(entry.appVersion) &&
    isText(entry.evidence) &&
    (isText(entry.monitors) || typeof entry.monitors === 'number') &&
    typeof entry.protectionEnabled === 'boolean'
  );
}

export const VERIFIED_CONFIGURATIONS: readonly VerifiedConfiguration[] = (
  verifiedFile as unknown[]
).filter(isVerifiedConfiguration);

export function entriesFor(
  entries: readonly VerifiedConfiguration[],
  platform: Platform,
  appId: string,
  mode: CaptureMode,
): VerifiedConfiguration[] {
  const app = MEETING_APPS.find((item) => item.id === appId);
  return entries.filter(
    (entry) =>
      entry.platform === platform &&
      entry.captureMode === mode &&
      [app?.id, app?.label.toLowerCase()].includes(entry.meetingApp.toLowerCase()),
  );
}

function Cell({ entries }: { entries: readonly VerifiedConfiguration[] }) {
  if (entries.length === 0) {
    return <span className="land-matrix__none">Not tested</span>;
  }
  return (
    <ul className="land-matrix__results">
      {entries.map((entry) => (
        <li key={`${entry.testedAt}-${entry.evidence}-${entry.protectionEnabled}`}>
          <strong>
            {entry.outcome} ({entry.protectionEnabled ? 'private mode on' : 'private mode off'})
          </strong>
          <span>
            {entry.osVersion}; {entry.client}; {entry.monitors} monitor
            {entry.monitors === 1 ? '' : 's'}; app {entry.appVersion}; tested {entry.testedAt}
          </span>
          <span>Evidence: {entry.evidence}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The compatibility matrix. A cell shows a result only when a verified entry exists for exactly
 * that platform, meeting app and capture mode; every other cell says "Not tested". Nothing here
 * is ever a general statement that something works.
 */
export function CompatibilityMatrix({
  entries = VERIFIED_CONFIGURATIONS,
}: {
  entries?: readonly VerifiedConfiguration[];
}) {
  return (
    <div className="land-matrix" data-testid="compatibility-matrix">
      {PLATFORMS.map((platform) => (
        <div
          key={platform.id}
          className="land-matrix__scroll"
          role="region"
          aria-label={`${platform.label} compatibility results`}
          tabIndex={0}
        >
          <table>
            <caption>{platform.label}</caption>
            <thead>
              <tr>
                <th scope="col">Meeting app</th>
                {CAPTURE_MODES.map((mode) => (
                  <th key={mode.id} scope="col">
                    {mode.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEETING_APPS.map((app) => (
                <tr key={app.id}>
                  <th scope="row">{app.label}</th>
                  {CAPTURE_MODES.map((mode) => {
                    const found = entriesFor(entries, platform.id, app.id, mode.id);
                    return (
                      <td
                        key={mode.id}
                        data-verified={found.length > 0 ? 'true' : undefined}
                        data-testid="matrix-cell"
                      >
                        <Cell entries={found} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
