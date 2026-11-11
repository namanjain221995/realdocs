/**
 * Local store for verification records: one JSON file per record in a directory (the caller passes
 * `app.getPath('userData')/privacy`). Records never leave this computer.
 *
 * - Every record is validated with the zod schema on write and on read.
 * - Writes are atomic: temp file in the same directory, flushed, then `rename`.
 * - A file that cannot be parsed, fails the schema, is too large, or whose name does not match its
 *   id is moved into `quarantine/` and reported. It is never silently dropped or partly trusted.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { VerificationRecord } from '../../shared/privacy/status';
import { silentLogger, type Logger } from '../logger';

export const MAX_RECORD_FILE_BYTES = 64 * 1024;
const QUARANTINE_DIRECTORY = 'quarantine';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuarantinedFile {
  /** Original file name (no directory). */
  file: string;
  /** Where it was moved to, or null when even that failed (the file is left untouched). */
  movedTo: string | null;
  reason: string;
}

export interface ListResult {
  records: VerificationRecord[];
  quarantined: QuarantinedFile[];
}

export class InvalidRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecordError';
  }
}

export interface RecordStoreOptions {
  logger?: Logger;
  now?: () => Date;
}

export class PrivacyRecordStore {
  private readonly directory: string;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(directory: string, options: RecordStoreOptions = {}) {
    this.directory = directory;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<ListResult> {
    return this.serial(() => this.listNow());
  }

  /** Validates, then writes atomically. Throws {@link InvalidRecordError} for an invalid record. */
  async save(record: unknown): Promise<VerificationRecord> {
    const parsed = VerificationRecord.safeParse(record);
    if (!parsed.success) {
      throw new InvalidRecordError(
        `record rejected: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
      );
    }
    const valid = parsed.data;
    return this.serial(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const target = this.fileFor(valid.id);
      const temp = `${target}.${randomUUID()}.tmp`;
      const handle = await fs.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(valid, null, 2)}\n`, 'utf8');
        await handle.sync();
      } catch (error) {
        await handle.close();
        await fs.rm(temp, { force: true });
        throw error;
      }
      await handle.close();
      try {
        await fs.rename(temp, target);
      } catch (error) {
        await fs.rm(temp, { force: true });
        throw error;
      }
      return valid;
    });
  }

  /** Returns true when a record was removed. */
  async remove(id: string): Promise<boolean> {
    if (!ID_PATTERN.test(id)) throw new InvalidRecordError('record id is not a UUID');
    return this.serial(async () => {
      try {
        await fs.unlink(this.fileFor(id));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  private fileFor(id: string): string {
    return path.join(this.directory, `${id.toLowerCase()}.json`);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async listNow(): Promise<ListResult> {
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { records: [], quarantined: [] };
      throw error;
    }
    const records: VerificationRecord[] = [];
    const quarantined: QuarantinedFile[] = [];
    for (const name of names.sort()) {
      if (name.endsWith('.tmp')) {
        // Left behind by an interrupted write; the rename never happened, so it was never a record.
        await fs.rm(path.join(this.directory, name), { force: true });
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const full = path.join(this.directory, name);
      const problem = await this.readOne(full, name, records);
      if (problem) quarantined.push(await this.quarantine(full, name, problem));
    }
    return { records, quarantined };
  }

  /** Returns a reason when the file is not trustworthy, otherwise pushes the record. */
  private async readOne(
    full: string,
    name: string,
    into: VerificationRecord[],
  ): Promise<string | null> {
    let text: string;
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) return 'not a regular file';
      if (stat.size > MAX_RECORD_FILE_BYTES) return `larger than ${MAX_RECORD_FILE_BYTES} bytes`;
      text = await fs.readFile(full, 'utf8');
    } catch (error) {
      return `unreadable: ${(error as Error).message}`;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return 'not valid JSON';
    }
    const parsed = VerificationRecord.safeParse(json);
    if (!parsed.success) {
      return `fails the record schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`;
    }
    if (`${parsed.data.id.toLowerCase()}.json` !== name)
      return 'file name does not match the record id';
    into.push(parsed.data);
    return null;
  }

  private async quarantine(full: string, name: string, reason: string): Promise<QuarantinedFile> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const folder = path.join(this.directory, QUARANTINE_DIRECTORY);
    const destination = path.join(folder, `${name}.${stamp}.${randomUUID().slice(0, 8)}.corrupt`);
    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.rename(full, destination);
      this.logger.warn('privacy_record_quarantined', { file: name, reason: reason.slice(0, 200) });
      return { file: name, movedTo: destination, reason };
    } catch (error) {
      this.logger.error('privacy_record_quarantine_failed', {
        file: name,
        reason: (error as Error).message,
      });
      return { file: name, movedTo: null, reason };
    }
  }
}
