/**
 * Asset byte storage behind a small adapter interface. The only implementation
 * is a private local directory (a Docker volume in deployments); another
 * backend can be added without touching the upload or download code.
 */
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

export interface AssetStorage {
  /** Prepares the storage (creates directories). Throws when it is not usable. */
  init(): Promise<void>;
  /** Path of a new, not yet existing staging file on the same filesystem. */
  newTempPath(): string;
  /** Durably moves a completely written staging file into place under `key`. */
  commit(tempPath: string, key: string): Promise<void>;
  createReadStream(key: string): Readable;
  size(key: string): Promise<number | null>;
  copy(sourceKey: string, targetKey: string): Promise<void>;
  /** Removes the bytes of `key`. Succeeds when they are already gone. */
  remove(key: string): Promise<void>;
  /** Deletes staging files older than `olderThanMs`. Returns how many were removed. */
  removeStaleTemp(olderThanMs: number): Promise<number>;
}

const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{40}$/;

/** A random storage key. Never derived from file names, content or user input. */
export function newStorageKey(): string {
  const hex = randomBytes(22).toString('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4)}`;
}

async function fsyncPath(target: string): Promise<void> {
  const handle = await open(target, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class LocalDiskStorage implements AssetStorage {
  private readonly root: string;
  private readonly objects: string;
  private readonly temp: string;

  constructor(directory: string) {
    this.root = path.resolve(directory);
    this.objects = path.join(this.root, 'objects');
    this.temp = path.join(this.root, 'tmp');
  }

  async init(): Promise<void> {
    await mkdir(this.objects, { recursive: true, mode: 0o700 });
    await mkdir(this.temp, { recursive: true, mode: 0o700 });
    // Fail at start-up, not on the first upload, when the volume is read-only.
    const probe = path.join(this.temp, `.probe-${randomBytes(6).toString('hex')}`);
    const handle = await open(probe, 'wx', 0o600);
    await handle.close();
    await unlink(probe);
  }

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('invalid storage key');
    const resolved = path.join(this.objects, key);
    if (!resolved.startsWith(this.objects + path.sep)) throw new Error('invalid storage key');
    return resolved;
  }

  newTempPath(): string {
    return path.join(this.temp, `${randomBytes(16).toString('hex')}.part`);
  }

  async commit(tempPath: string, key: string): Promise<void> {
    const resolvedTemp = path.resolve(tempPath);
    if (path.dirname(resolvedTemp) !== this.temp)
      throw new Error('staging file is outside storage');
    const target = this.resolve(key);
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Data first, then the rename, then the directory entry: after this
    // returns the object survives a crash or power loss.
    await fsyncPath(resolvedTemp);
    await rename(resolvedTemp, target);
    await fsyncPath(directory);
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.resolve(key));
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.resolve(key))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    const staging = this.newTempPath();
    try {
      await copyFile(this.resolve(sourceKey), staging);
      await this.commit(staging, targetKey);
    } catch (error) {
      await rm(staging, { force: true });
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async removeStaleTemp(olderThanMs: number): Promise<number> {
    let removed = 0;
    const cutoff = Date.now() - olderThanMs;
    for (const entry of await readdir(this.temp, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(this.temp, entry.name);
      try {
        if ((await stat(file)).mtimeMs < cutoff) {
          await unlink(file);
          removed += 1;
        }
      } catch {
        // Raced with another cleanup or an upload finishing; nothing to do.
      }
    }
    return removed;
  }
}
