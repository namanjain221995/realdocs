/**
 * Desktop session credential: held in main-process memory, and persisted only
 * as an OS-encrypted blob (`<userData>/session.bin`) when real OS-backed
 * encryption is available. Otherwise nothing is written and the session ends
 * with the process — the settings window says so.
 *
 * The persisted blob is the "last document" reference: server origin,
 * document id and the document-scoped token, encrypted together. Preferences
 * never contain any of it.
 *
 * No Electron import: `safeStorage` is supplied through `EncryptionAdapter`
 * (see `safe-storage-adapter.ts`), so the rules are unit-tested with a fake.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { EffectiveRole } from '@realtimedocs/contracts';
import { z } from 'zod';
import { isCanonicalHttpOrigin } from '../shared/server-origin';
import type { CredentialStorageInfo } from '../shared/state';
import { silentLogger, type Logger } from './logger';

export interface EncryptionAvailability {
  available: boolean;
  /** Linux secret-store backend name; null on other platforms. */
  backend: string | null;
  /** Displayable explanation (why it is or is not available). */
  detail: string;
}

export interface EncryptionAdapter {
  availability(): Promise<EncryptionAvailability>;
  encrypt(plainText: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}

export const StoredSession = z.strictObject({
  version: z.literal(1),
  serverOrigin: z.string().refine(isCanonicalHttpOrigin),
  documentId: z.uuid(),
  token: z.string().min(16).max(4096),
  title: z.string().max(400),
  role: EffectiveRole,
  expiresAt: z.iso.datetime().nullable(),
  accountId: z.uuid().nullable(),
  via: z.enum(['handoff', 'share_link']),
  savedAt: z.iso.datetime(),
});
export type StoredSession = z.infer<typeof StoredSession>;

const MAX_BLOB_BYTES = 64 * 1024;

export type RestoreOutcome =
  | { status: 'restored'; session: StoredSession }
  | { status: 'none' }
  | {
      status: 'discarded';
      reason: 'undecryptable' | 'invalid' | 'other_server' | 'expired' | 'unavailable';
    };

export interface CredentialStoreOptions {
  filePath: string;
  encryption: EncryptionAdapter;
  logger?: Logger;
  now?: () => number;
}

export class CredentialStore {
  private readonly filePath: string;
  private readonly encryption: EncryptionAdapter;
  private readonly logger: Logger;
  private readonly now: () => number;
  private session: StoredSession | null = null;
  private info: CredentialStorageInfo = {
    mode: 'memory_only',
    backend: null,
    detail: 'Secure storage has not been checked yet.',
  };

  constructor(options: CredentialStoreOptions) {
    this.filePath = options.filePath;
    this.encryption = options.encryption;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? Date.now;
  }

  /** Determines whether sessions can be persisted. Never throws. */
  async init(): Promise<CredentialStorageInfo> {
    let availability: EncryptionAvailability;
    try {
      availability = await this.encryption.availability();
    } catch {
      availability = {
        available: false,
        backend: null,
        detail: 'The operating system did not report whether secure storage is available.',
      };
    }
    this.info = availability.available
      ? { mode: 'os_encrypted', backend: availability.backend, detail: availability.detail }
      : { mode: 'memory_only', backend: availability.backend, detail: availability.detail };
    if (this.info.mode === 'memory_only') {
      // Never leave an old blob behind when we cannot protect a new one.
      await this.removeFile();
    }
    return this.info;
  }

  getStorageInfo(): CredentialStorageInfo {
    return this.info;
  }

  getSession(): StoredSession | null {
    return this.session;
  }

  /** The bearer token for the configured server, or null. Main process only. */
  getToken(): string | null {
    return this.session?.token ?? null;
  }

  async set(session: StoredSession): Promise<void> {
    this.session = StoredSession.parse(session);
    if (this.info.mode !== 'os_encrypted') return;
    try {
      const blob = await this.encryption.encrypt(JSON.stringify(this.session));
      const temporary = `${this.filePath}.tmp`;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(temporary, blob, { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      // Keep working from memory; say so honestly instead of pretending it was saved.
      this.logger.warn('credentials.persist_failed', { reason: nameOf(error) });
      this.info = {
        mode: 'memory_only',
        backend: this.info.backend,
        detail:
          'The session could not be written to secure storage, so it is kept in memory for this run only.',
      };
      await this.removeFile();
    }
  }

  async clear(): Promise<void> {
    this.session = null;
    await this.removeFile();
  }

  /**
   * Loads the persisted session, if any. It is used only when it decrypts,
   * validates, has not expired and belongs to the configured server; in every
   * other case the blob is deleted.
   */
  async restore(configuredOrigin: string | null): Promise<RestoreOutcome> {
    if (this.info.mode !== 'os_encrypted') return { status: 'none' };
    let blob: Buffer;
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size === 0 || stat.size > MAX_BLOB_BYTES) {
        await this.removeFile();
        return { status: 'discarded', reason: 'invalid' };
      }
      blob = await fs.readFile(this.filePath);
    } catch (error) {
      if (isNotFound(error)) return { status: 'none' };
      this.logger.warn('credentials.read_failed', { reason: nameOf(error) });
      return { status: 'discarded', reason: 'unavailable' };
    }

    let plain: string;
    try {
      plain = await this.encryption.decrypt(blob);
    } catch {
      await this.removeFile();
      return { status: 'discarded', reason: 'undecryptable' };
    }

    let parsed: StoredSession;
    try {
      parsed = StoredSession.parse(JSON.parse(plain));
    } catch {
      await this.removeFile();
      return { status: 'discarded', reason: 'invalid' };
    }
    if (!configuredOrigin || parsed.serverOrigin !== configuredOrigin) {
      await this.removeFile();
      return { status: 'discarded', reason: 'other_server' };
    }
    if (parsed.expiresAt !== null && Date.parse(parsed.expiresAt) <= this.now()) {
      await this.removeFile();
      return { status: 'discarded', reason: 'expired' };
    }
    this.session = parsed;
    return { status: 'restored', session: parsed };
  }

  private async removeFile(): Promise<void> {
    for (const target of [this.filePath, `${this.filePath}.tmp`]) {
      try {
        await fs.rm(target, { force: true });
      } catch (error) {
        this.logger.warn('credentials.remove_failed', { reason: nameOf(error) });
      }
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

function nameOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (error instanceof Error) return error.name;
  }
  return 'unknown';
}
