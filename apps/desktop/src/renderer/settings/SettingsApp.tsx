import { Banner, EmptyState, Spinner, TabPanel, Tabs, useToast } from '@realtimedocs/ui';
import {
  Activity,
  ClipboardCheck,
  Download,
  Keyboard,
  Palette,
  PlugZap,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SETTINGS_TABS, type AppState, type SettingsTab } from '../../shared/state';
import { attempt, desktop, onAppEvent, useAppState } from '../shared/desktop';
import { AppearanceTab } from './AppearanceTab';
import { BehaviourTab } from './BehaviourTab';
import { ConnectionTab } from './ConnectionTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { PrivacyTab } from './PrivacyTab';
import { PrivacyTestCenterTab } from './PrivacyTestCenterTab';
import { UpdatesTab } from './UpdatesTab';

export type RunAction = (
  action: Promise<unknown> | undefined,
  success?: string,
) => Promise<boolean>;

export interface TabProps {
  state: AppState;
  run: RunAction;
}

const TAB_ITEMS = [
  { id: 'connection', label: 'Connection', icon: <PlugZap /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette /> },
  { id: 'behaviour', label: 'Behaviour & Shortcuts', icon: <Keyboard /> },
  { id: 'privacy', label: 'Privacy & Capture', icon: <ShieldCheck /> },
  { id: 'privacy-test-center', label: 'Privacy Test Center', icon: <ClipboardCheck /> },
  { id: 'updates', label: 'Updates', icon: <Download /> },
  { id: 'diagnostics', label: 'Diagnostics & About', icon: <Activity /> },
] as const satisfies readonly { id: SettingsTab; label: string; icon: React.ReactNode }[];

function initialTab(): SettingsTab {
  const fromHash = window.location.hash.slice(1);
  return (SETTINGS_TABS as readonly string[]).includes(fromHash)
    ? (fromHash as SettingsTab)
    : 'connection';
}

export function SettingsApp() {
  const state = useAppState();
  const toast = useToast();
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const theme = state?.appearance.foreground === 'dark' ? 'light' : 'dark';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The main process can ask for a specific tab (tray "Privacy and capture…").
  const requestedTab = state?.settings.tab;
  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
  }, [requestedTab]);
  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.type === 'settings-tab') setTab(event.tab);
      }),
    [],
  );

  const run = useCallback<RunAction>(
    async (action, success) => {
      const error = await attempt(action as Parameters<typeof attempt>[0]);
      if (error) {
        toast.show({ title: error, tone: 'danger', durationMs: 7000 });
        return false;
      }
      if (success) toast.show({ title: success, tone: 'success', durationMs: 2500 });
      return true;
    },
    [toast],
  );

  if (!desktop) {
    return (
      <div className="rds-shell rds-shell--center">
        <EmptyState
          title="Desktop app required"
          description="These settings belong to the RealtimeDocs desktop app and only work inside it."
        />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="rds-shell rds-shell--center">
        <Spinner />
      </div>
    );
  }

  const props: TabProps = { state, run };
  return (
    <div className="rds-shell" data-testid="rd-settings">
      <header className="rds-top">
        <h1 className="rds-heading">Settings</h1>
        <span className="rds-version">
          RealtimeDocs Desktop {state.app.version} · {platformName(state.app.platform)}
        </span>
      </header>
      {state.preferencesRepaired && (
        <Banner tone="warning" className="rds-top-banner" data-testid="rd-prefs-repaired">
          Your saved preferences were damaged or outdated and have been repaired. Check that the
          settings below are what you expect.
        </Banner>
      )}
      <Tabs
        className="rds-tabs"
        ariaLabel="Settings sections"
        tabs={TAB_ITEMS}
        value={tab}
        onValueChange={setTab}
        data-testid="rd-settings-tabs"
      >
        <TabPanel id="connection" className="rds-panel">
          <ConnectionTab {...props} />
        </TabPanel>
        <TabPanel id="appearance" className="rds-panel">
          <AppearanceTab {...props} />
        </TabPanel>
        <TabPanel id="behaviour" className="rds-panel">
          <BehaviourTab {...props} />
        </TabPanel>
        <TabPanel id="privacy" className="rds-panel">
          <PrivacyTab {...props} />
        </TabPanel>
        <TabPanel id="privacy-test-center" className="rds-panel">
          <PrivacyTestCenterTab {...props} />
        </TabPanel>
        <TabPanel id="updates" className="rds-panel">
          <UpdatesTab {...props} />
        </TabPanel>
        <TabPanel id="diagnostics" className="rds-panel">
          <DiagnosticsTab {...props} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

export function platformName(platform: AppState['app']['platform']): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  return 'Linux';
}
