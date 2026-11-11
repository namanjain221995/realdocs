/**
 * Preferences on disk: `<userData>/preferences.json`.
 *
 * - Loading never throws. A missing file gives defaults; unreadable JSON is
 *   moved aside to `preferences.corrupt.json` (one backup) and defaults are
 *   used; a readable but damaged file is repaired field by field, and a file
 *   written by an older version is brought up to date (`sanitizePreferences`).
 * - Writes are atomic (temp file + rename), serialised and debounced, because
 *   bounds change many times per second while the panel is dragged or resized.
 *
 * No Electron import: the path and platform are passed in.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizePreferences, type Preferences } from '../shared/preferences';
import type { DesktopPlatform } from '../shared/shortcuts';
import { silentLogger, type Logger } from './logger';

export type LoadStatus = 'created' | 'loaded' | 'migrated' | 'repaired' | 'corrupt_reset';

const MAX_FILE_BYTES = 1024 * 1024;

export interface PreferencesStoreOptions {
  filePath: string;
  platform: DesktopPlatform;
  debounceMs?: number;
  logger?: Logger;
}

export class PreferencesStore {
  private readonly filePath: string;
  private readonly platform: DesktopPlatform;
  private readonly debounceMs: number;
  private readonly logger: Logger;
  private current: Preferences;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  private loadStatus: LoadStatus = 'created';

  constructor(options: PreferencesStoreOptions) {
    this.filePath = options.filePath;
    this.platform = options.platform;
    this.debounceMs = options.debounceMs ?? 400;
    this.logger = options.logger ?? silentLogger;
    this.current = sanitizePreferences(null, this.platform).preferences;
  }

  get status(): LoadStatus {
    return this.loadStatus;
  }

  get(): Preferences {
    return this.current;
  }

  async load(): Promise<LoadStatus> {
    let text: string;
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size > MAX_FILE_BYTES) throw new SyntaxError('preference file too large');
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        this.loadStatus = 'created';
        return this.loadStatus;
      }
      if (!(error instanceof SyntaxError)) {
        // Unreadable (permissions, I/O): keep defaults in memory, do not overwrite the file.
        this.logger.warn('preferences.unreadable', { reason: errorName(error) });
        this.loadStatus = 'corrupt_reset';
        return this.loadStatus;
      }
      await this.moveAside();
      this.loadStatus = 'corrupt_reset';
      return this.loadStatus;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn('preferences.corrupt', {});
      await this.moveAside();
      this.loadStatus = 'corrupt_reset';
      this.dirty = true;
      await this.flush();
      return this.loadStatus;
    }

    const { preferences, repaired, migratedFrom } = sanitizePreferences(parsed, this.platform);
    this.current = preferences;
    this.loadStatus = repaired ? 'repaired' : migratedFrom !== null ? 'migrated' : 'loaded';
    if (repaired || migratedFrom !== null) {
      this.dirty = true;
      await this.flush();
    }
    return this.loadStatus;
  }

  /** Replaces the preferences with a sanitised version of what `change` returns. */
  update(change: (current: Preferences) => Preferences): Preferences {
    const next = sanitizePreferences(change(this.current), this.platform).preferences;
    this.current = next;
    this.dirty = true;
    this.schedule();
    return next;
  }

  /** Writes pending changes now (called on quit and by tests). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) {
      await this.writing;
      return;
    }
    this.dirty = false;
    const snapshot = JSON.stringify(this.current, null, 2);
    this.writing = this.writing.then(() => this.write(snapshot));
    await this.writing;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    // A pending preference write must not keep the process alive.
    this.timer.unref?.();
  }

  private async write(contents: string): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      this.logger.error('preferences.write_failed', { reason: errorName(error) });
      this.dirty = true;
    }
  }

  private async moveAside(): Promise<void> {
    const backup = path.join(path.dirname(this.filePath), 'preferences.corrupt.json');
    try {
      await fs.rename(this.filePath, backup);
    } catch (error) {
      this.logger.warn('preferences.backup_failed', { reason: errorName(error) });
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (error instanceof Error) return error.name;
  }
  return 'unknown';
}
