/**
 * Recommended IPC contract for the Privacy Test Center. The host registers these in
 * `channels.ts` / `ipc-schemas.ts` conventions (strict objects, bounded values, allow-listed
 * windows only). No raw window handle and no file path ever crosses these channels.
 */
import { z } from 'zod';
import { VerificationRecord } from './status';

export const PRIVACY_CH = {
  /** invoke, no input -> PrivacySnapshot */
  snapshot: 'rd:privacy:snapshot',
  /** invoke, SavePrivacyRecordInput -> PrivacySnapshot */
  save: 'rd:privacy:save',
  /** invoke, RemovePrivacyRecordInput -> PrivacySnapshot */
  remove: 'rd:privacy:remove',
  /** invoke, ExportPrivacyRecordsInput -> { ok, path? } (main shows a save dialog; renderer gets no path to read) */
  export: 'rd:privacy:export',
} as const;

export const SavePrivacyRecordInput = z.strictObject({ record: VerificationRecord });
export type SavePrivacyRecordInput = z.infer<typeof SavePrivacyRecordInput>;

export const RemovePrivacyRecordInput = z.strictObject({ id: z.uuid() });
export type RemovePrivacyRecordInput = z.infer<typeof RemovePrivacyRecordInput>;

export const EXPORT_FORMATS = ['markdown', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const ExportPrivacyRecordsInput = z.strictObject({ format: z.enum(EXPORT_FORMATS) });
export type ExportPrivacyRecordsInput = z.infer<typeof ExportPrivacyRecordsInput>;
