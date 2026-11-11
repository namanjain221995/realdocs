/**
 * Settings → Privacy Test Center: the second agent's presentational component
 * (`renderer/privacy/PrivacyTestCenter.tsx`, no IPC inside), fed from the
 * main process through the settings-only `rdDesktop.privacy` bridge. Records
 * are written by the main process, which stamps the detected OS, Electron and
 * app version itself; exports go through the main process's own save dialog.
 */
import { Banner, Spinner } from '@realtimedocs/ui';
import { useCallback, useEffect, useState } from 'react';
import type { PrivacyView } from '../../shared/bridge';
import type { ExportFormat } from '../../shared/privacy/ipc';
import type { VerificationRecord } from '../../shared/privacy/status';
import { PrivacyTestCenter } from '../privacy/PrivacyTestCenter';
import { desktop } from '../shared/desktop';
import type { TabProps } from './SettingsApp';

export function PrivacyTestCenterTab({ state, run }: TabProps) {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await desktop?.privacy.snapshot();
    if (!result) return;
    if (result.ok) {
      setView(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const requestState = state.capture.status.request;

  const onSave = async (record: VerificationRecord) => {
    const result = await desktop?.privacy.save(record);
    if (result?.ok) setView(result.data);
    else if (result) throw new Error(result.error.message);
  };
  const onDelete = async (id: string) => {
    const result = await desktop?.privacy.remove(id);
    if (result?.ok) setView(result.data);
    else if (result) throw new Error(result.error.message);
  };
  const onExport = async (format: ExportFormat) => {
    await run(desktop?.privacy.exportRecords(format));
  };

  if (error) {
    return (
      <Banner tone="danger" data-testid="rd-test-center-error">
        {error}
      </Banner>
    );
  }
  if (!view) return <Spinner />;
  return (
    <div className="rds-stack" data-testid="rd-test-center">
      {view.quarantined.length > 0 && (
        <Banner tone="warning" data-testid="rd-test-center-quarantined">
          {view.quarantined.length === 1
            ? '1 record file could not be read and was set aside.'
            : `${view.quarantined.length} record files could not be read and were set aside.`}
        </Banner>
      )}
      <PrivacyTestCenter
        environment={view.environment}
        requestState={requestState}
        records={view.records}
        onSave={onSave}
        onDelete={onDelete}
        onExport={onExport}
      />
    </div>
  );
}
