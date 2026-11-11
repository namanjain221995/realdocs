import { Badge, Button, Card, copyText } from '@realtimedocs/ui';
import { useCallback, useEffect, useState } from 'react';
import type { Diagnostics } from '../../shared/state';
import { desktop } from '../shared/desktop';
import { formatDateTime } from '../shared/labels';
import { platformName, type TabProps } from './SettingsApp';

const PROBE_LABELS = {
  works: 'Native resizing worked',
  glitches: 'Resized, with visual glitches',
  broken: 'Could not be resized natively',
} as const;

function rect(bounds: { x: number; y: number; width: number; height: number }): string {
  return `${bounds.width} × ${bounds.height} at ${bounds.x}, ${bounds.y}`;
}

/** Plain-text report for support. Contains no token, link, secret or document content. */
function toReport(diagnostics: Diagnostics): string {
  const lines: string[] = [
    `RealtimeDocs Desktop ${diagnostics.app.version} (${diagnostics.app.packaged ? 'packaged' : 'development build'})`,
    `Generated: ${diagnostics.generatedAt}`,
    `Platform: ${diagnostics.app.platform} ${diagnostics.app.systemVersion} (${diagnostics.app.arch}), ${diagnostics.osRelease}`,
    `Electron ${diagnostics.app.electronVersion}, Chromium ${diagnostics.app.chromeVersion}, Node ${diagnostics.versions.node}, V8 ${diagnostics.versions.v8}`,
    `Locale: ${diagnostics.locale}`,
    `Server: ${diagnostics.serverOrigin ?? '(none)'}`,
    `Credential storage: ${diagnostics.credentials.mode}${diagnostics.credentials.backend ? ` (${diagnostics.credentials.backend})` : ''}`,
    `Tray: ${diagnostics.tray.available ? 'available' : `unavailable (${diagnostics.tray.error ?? 'unknown'})`}`,
    '',
    'Capture exclusion (an operating-system request; not proof of what a participant sees):',
    `  requested: ${diagnostics.capture.requested}; OS request available: ${diagnostics.capture.apiAvailable}`,
    `  status: ${diagnostics.capture.status.label} [${diagnostics.capture.status.request} / ${diagnostics.capture.status.kind}${diagnostics.capture.status.reason ? `, ${diagnostics.capture.status.reason}` : ''}]`,
    ...(diagnostics.capture.status.verification
      ? [`  verification: ${diagnostics.capture.status.verification.line}`]
      : []),
    ...diagnostics.capture.results.map(
      (result) =>
        `  ${result.window}: attempted=${result.attempted} requested=${result.requested} readBack=${String(result.readBack)} affinity=${result.affinity ?? 'n/a'} drawnSince=${result.pendingComposition ? 'no' : (result.composedAt ?? 'not shown')}${result.error ? ` error=${result.error}` : ''}`,
    ),
    `  diagnostics module: ${nativeLine(diagnostics.capture.native)}`,
    '',
    'Windows:',
    ...diagnostics.windows.map(
      (window) =>
        `  ${window.kind}: ${rect(window.bounds)} visible=${window.visible} alwaysOnTop=${window.alwaysOnTop} resizable=${window.resizable} contentProtected=${String(window.contentProtected)}`,
    ),
    '',
    'Displays:',
    ...diagnostics.displays.map(
      (display) =>
        `  ${display.id}${display.primary ? ' (primary)' : ''}: ${rect(display.bounds)}, work area ${rect(display.workArea)}, scale ${display.scaleFactor}, rotation ${display.rotation ?? 0}`,
    ),
    '',
    'Global shortcuts:',
    ...diagnostics.shortcuts.map(
      (shortcut) =>
        `  ${shortcut.action}: ${shortcut.accelerator} — ${shortcut.registered ? 'registered' : `not registered (${shortcut.error ?? 'unknown'})`}`,
    ),
    '',
    `Native transparent resize probe: ${
      diagnostics.nativeResizeProbe
        ? `${diagnostics.nativeResizeProbe.result} on ${diagnostics.nativeResizeProbe.osPlatform} ${diagnostics.nativeResizeProbe.osVersion} (${diagnostics.nativeResizeProbe.recordedAt})`
        : 'not recorded'
    }`,
    '',
    `Content-Security-Policy violations in this run: ${diagnostics.policyViolations.length === 0 ? 'none' : ''}`,
    ...diagnostics.policyViolations.map(
      (violation) =>
        `  ${violation.window}: ${violation.directive} refused ${violation.blocked}${violation.source ? ` (${violation.source}:${violation.line})` : ''}`,
    ),
    '',
    'GPU feature status:',
    ...Object.entries(diagnostics.gpu).map(([feature, value]) => `  ${feature}: ${value}`),
  ];
  return lines.join('\n');
}

/** One line about the optional Windows diagnostics module. */
function nativeLine(native: Diagnostics['capture']['native']): string {
  if (!native) return 'unknown';
  if (native.present) {
    return `present (SHA-256 ${native.sha256Prefix ?? '?'}…), affinity ${native.affinity ?? 'not read yet'}, composition ${native.compositionEnabled === null ? 'unknown' : native.compositionEnabled ? 'enabled' : 'disabled'}`;
  }
  return `${native.label ?? 'not present'} (${native.reason ?? 'unknown'})`;
}

export function DiagnosticsTab({ state, run }: TabProps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const result = await desktop?.diagnostics.get();
    if (result?.ok) setDiagnostics(result.data);
  }, []);

  // Refresh when something that the report shows has changed.
  const revision = `${state.capture.status.kind}|${state.panel.pinned}|${state.probe.open}|${state.displays.length}|${state.shortcuts.items.map((item) => item.registered).join()}`;
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const { app, probe } = state;
  return (
    <div className="rds-stack">
      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">About</h2>
        <dl className="rds-facts" data-testid="rd-about">
          <dt>Application</dt>
          <dd>
            RealtimeDocs Desktop {app.version} {app.packaged ? '' : '(development build)'}
          </dd>
          <dt>System</dt>
          <dd>
            {platformName(app.platform)} {app.systemVersion} · {app.arch}
          </dd>
          <dt>Runtime</dt>
          <dd>
            Electron {app.electronVersion} · Chromium {app.chromeVersion}
            {diagnostics ? ` · Node.js ${diagnostics.versions.node}` : ''}
          </dd>
          {diagnostics && (
            <>
              <dt>Settings folder</dt>
              <dd className="rds-path">{diagnostics.userDataPath}</dd>
            </>
          )}
          <dt>Windows diagnostics module</dt>
          <dd data-testid="rd-native-module">{nativeLine(state.capture.native)}</dd>
          <dt>Panel display affinity</dt>
          <dd>{state.capture.native?.affinity ?? 'not read (no diagnostics module)'}</dd>
        </dl>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Native transparent resize probe</h2>
        <p className="rds-lead">
          The panel is resized by its own grips because Electron documents that transparent windows
          are not resizable. This probe opens a small transparent window that <em>is</em> natively
          resizable, so you can see how your system handles it and record the result. It does not
          change how the panel works.
        </p>
        <div className="rds-button-row">
          <Button
            onClick={() =>
              void run(
                probe.open ? desktop?.diagnostics.closeProbe() : desktop?.diagnostics.openProbe(),
              )
            }
            data-testid="rd-probe-toggle"
          >
            {probe.open ? 'Close probe window' : 'Open probe window'}
          </Button>
        </div>
        <p data-testid="rd-probe-record">
          {probe.record ? (
            <>
              <Badge tone={probe.record.result === 'works' ? 'success' : 'warning'}>
                {PROBE_LABELS[probe.record.result]}
              </Badge>{' '}
              recorded {formatDateTime(probe.record.recordedAt)} on {probe.record.osPlatform}{' '}
              {probe.record.osVersion}, Electron {probe.record.electronVersion}
              {probe.record.notes ? ` — ${probe.record.notes}` : ''}
            </>
          ) : (
            <span className="rds-muted">No result recorded on this computer yet.</span>
          )}
        </p>
      </Card>

      <Card padding="lg" className="rds-card">
        <div className="rds-card-head">
          <h2 className="rds-h2">Technical details</h2>
          <div className="rds-button-row">
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              Refresh
            </Button>
            <Button
              size="sm"
              disabled={!diagnostics}
              onClick={() => {
                if (diagnostics) void copyText(toReport(diagnostics)).then(setCopied);
              }}
              data-testid="rd-copy-diagnostics"
            >
              {copied === true ? 'Copied' : copied === false ? 'Copy failed' : 'Copy report'}
            </Button>
          </div>
        </div>
        <p className="rds-muted rds-small">
          The report contains versions, window and display geometry and registration results. It
          never contains your session, share links or document text.
        </p>
        {diagnostics ? (
          <pre className="rds-report" data-testid="rd-diagnostics-report" tabIndex={0}>
            {toReport(diagnostics)}
          </pre>
        ) : (
          <p className="rds-muted">Collecting…</p>
        )}
      </Card>
    </div>
  );
}
