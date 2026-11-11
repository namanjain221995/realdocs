/**
 * The main-side face of the Privacy Test Center: what the IPC handlers call. Detected fields are
 * stamped here, so a renderer cannot claim another OS or app version for a record.
 */
import { VerificationRecord } from '../../shared/privacy/status';
import { toJSON, toMarkdown, type DetectedEnvironment } from '../../shared/privacy/test-center';
import type { ExportFormat } from '../../shared/privacy/ipc';
import type { QuarantinedFile, PrivacyRecordStore } from './record-store';

export interface PrivacySnapshot {
  environment: DetectedEnvironment;
  records: VerificationRecord[];
  quarantined: QuarantinedFile[];
}

export class PrivacyService {
  constructor(
    private readonly store: PrivacyRecordStore,
    private readonly detect: () => DetectedEnvironment,
  ) {}

  async snapshot(): Promise<PrivacySnapshot> {
    const { records, quarantined } = await this.store.list();
    return { environment: this.detect(), records, quarantined };
  }

  async save(record: unknown): Promise<PrivacySnapshot> {
    const parsed = VerificationRecord.parse(record);
    const environment = this.detect();
    await this.store.save({
      ...parsed,
      appVersion: environment.appVersion,
      electronVersion: environment.electronVersion,
      platform: environment.platform,
      osVersion: environment.osVersion,
    });
    return this.snapshot();
  }

  async remove(id: string): Promise<PrivacySnapshot> {
    await this.store.remove(id);
    return this.snapshot();
  }

  async exportText(
    format: ExportFormat,
  ): Promise<{ filename: string; mime: string; text: string }> {
    const { records } = await this.store.list();
    return format === 'json'
      ? {
          filename: 'realtimedocs-privacy-records.json',
          mime: 'application/json',
          text: toJSON(records),
        }
      : {
          filename: 'realtimedocs-privacy-records.md',
          mime: 'text/markdown',
          text: toMarkdown(records),
        };
  }
}
