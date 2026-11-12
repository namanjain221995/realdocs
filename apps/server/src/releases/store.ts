/**
 * Read-only view of the operator-managed release directory.
 *
 *   <DOWNLOAD_DIR>/releases/<channel>/<version>/release.json + artifacts
 *   <DOWNLOAD_DIR>/channels/<channel>.json         {version, rolloutPercent?}
 *
 * Everything on disk is untrusted until checked: the manifest is validated with zod, every artifact
 * must be a regular file (not a link) directly in its release directory, its name must be exactly
 * `RealtimeDocs-<version>-<platform>-<arch>.<ext>`, its size must match, and its SHA-256 must match
 * the manifest. Hashing is streamed, single-flight and cached by path, size and modification time.
 * Request handlers only ever address files through the entries of this snapshot, never by joining
 * user input onto a path.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ChannelPointer,
  ReleaseChannel,
  ReleaseManifest,
  releaseArtifactName,
  SEMVER_PATTERN,
  type ReleaseArtifactManifest,
} from '@realtimedocs/contracts';
import type { Logger } from '../logger';
import { compareVersions } from './version';

const MAX_JSON_BYTES = 256 * 1024;
const CHANNELS = ReleaseChannel.options;

export interface LoadedArtifact extends ReleaseArtifactManifest {
  channel: ReleaseChannel;
  version: string;
  /** Absolute path of the verified-by-snapshot file. Only ever used by the store's own consumers. */
  absPath: string;
  mtimeMs: number;
  downloadUrl: string;
}

export interface LoadedRelease {
  channel: ReleaseChannel;
  version: string;
  publishedAt: string;
  notes: string;
  minimumSupportedVersion: string | null;
  /** Structurally valid artifacts (hash not yet confirmed; see `ReleaseStore.verified`). */
  artifacts: LoadedArtifact[];
  /** Problems found while loading (bad file entries, unreadable manifest). */
  problems: string[];
}

export interface ChannelState {
  pointer: ChannelPointer | null;
  /** Newest first by semantic version. */
  releases: LoadedRelease[];
  /** Releases that could not be loaded at all. */
  broken: { version: string; problem: string }[];
}

export interface Snapshot {
  configured: boolean;
  channels: Record<ReleaseChannel, ChannelState>;
}

export function downloadUrlFor(channel: string, version: string, fileName: string): string {
  return `/download/releases/${channel}/${version}/${fileName}`;
}

async function readJsonFile(file: string): Promise<unknown> {
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new Error('not a small regular file');
  return JSON.parse(await readFile(file, 'utf8'));
}

function emptySnapshot(configured: boolean): Snapshot {
  const empty = (): ChannelState => ({ pointer: null, releases: [], broken: [] });
  return { configured, channels: { stable: empty(), beta: empty() } };
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export class ReleaseStore {
  private snap: Snapshot | null = null;
  private snapAt = 0;
  private loading: Promise<Snapshot> | null = null;
  private readonly hashes = new Map<string, Promise<string>>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly dir: string | null,
    private readonly logger: Pick<Logger, 'warn' | 'info'>,
    private readonly ttlMs = 2_000,
  ) {}

  get configured(): boolean {
    return this.dir !== null;
  }

  /** Current snapshot; re-read from disk at most every `ttlMs`, concurrent callers share one read. */
  async snapshot(): Promise<Snapshot> {
    if (this.snap && Date.now() - this.snapAt < this.ttlMs) return this.snap;
    if (!this.loading) {
      this.loading = this.load()
        .then((snap) => {
          this.snap = snap;
          this.snapAt = Date.now();
          return snap;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** Forget the cached snapshot (tests, and after the operator publishes). */
  invalidate(): void {
    this.snapAt = 0;
  }

  /** The release the channel points at; without a pointer, the newest by version. */
  async current(channel: ReleaseChannel): Promise<LoadedRelease | null> {
    const state = (await this.snapshot()).channels[channel];
    if (state.pointer) {
      return state.releases.find((r) => r.version === state.pointer?.version) ?? null;
    }
    return state.releases[0] ?? null;
  }

  async find(channel: ReleaseChannel, version: string): Promise<LoadedRelease | null> {
    const state = (await this.snapshot()).channels[channel];
    return state.releases.find((r) => r.version === version) ?? null;
  }

  /** Looks a file up by exact (channel, version, name) in the snapshot. */
  async findArtifact(
    channel: string,
    version: string,
    fileName: string,
  ): Promise<LoadedArtifact | null> {
    const parsed = ReleaseChannel.safeParse(channel);
    if (!parsed.success) return null;
    const release = await this.find(parsed.data, version);
    return release?.artifacts.find((a) => a.fileName === fileName) ?? null;
  }

  /** Artifacts whose bytes are confirmed to match the manifest hash. Hashes run once per file. */
  async verified(release: LoadedRelease): Promise<LoadedArtifact[]> {
    const checks = await Promise.all(release.artifacts.map((a) => this.isVerified(a)));
    return release.artifacts.filter((_, i) => checks[i]);
  }

  async isVerified(artifact: LoadedArtifact): Promise<boolean> {
    const key = `${artifact.absPath}\u0000${artifact.sizeBytes}\u0000${artifact.mtimeMs}`;
    let pending = this.hashes.get(key);
    if (!pending) {
      for (const existing of this.hashes.keys()) {
        if (existing.startsWith(`${artifact.absPath}\u0000`)) this.hashes.delete(existing);
      }
      pending = sha256File(artifact.absPath);
      this.hashes.set(key, pending);
    }
    try {
      const actual = await pending;
      if (actual === artifact.sha256) return true;
      this.warnOnce(
        `hash:${key}`,
        `${artifact.fileName} does not match its manifest hash; not offered`,
      );
      return false;
    } catch (err) {
      this.hashes.delete(key);
      this.warnOnce(
        `read:${key}`,
        `${artifact.fileName} cannot be read (${String(err)}); not offered`,
      );
      return false;
    }
  }

  /** Starts hashing every artifact in the background so the first request does not pay for it. */
  warm(): void {
    void this.snapshot()
      .then(async (snap) => {
        for (const state of Object.values(snap.channels)) {
          for (const release of state.releases) await this.verified(release);
        }
      })
      .catch((err) => this.logger.warn({ err: String(err) }, 'release warm-up failed'));
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn({}, message);
  }

  private async load(): Promise<Snapshot> {
    if (!this.dir) return emptySnapshot(false);
    const snap = emptySnapshot(true);
    for (const channel of CHANNELS) {
      const state = snap.channels[channel];
      try {
        const raw = await readJsonFile(path.join(this.dir, 'channels', `${channel}.json`));
        const parsed = ChannelPointer.safeParse(raw);
        if (parsed.success) state.pointer = parsed.data;
        else
          this.warnOnce(`ptr:${channel}`, `channels/${channel}.json is invalid; pointer ignored`);
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOENT') {
          this.warnOnce(`ptr:${channel}`, `channels/${channel}.json unreadable; pointer ignored`);
        }
      }
      const channelDir = path.join(this.dir, 'releases', channel);
      let names: string[];
      try {
        names = await readdir(channelDir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!SEMVER_PATTERN.test(name)) continue;
        const releaseDir = path.join(channelDir, name);
        try {
          const info = await lstat(releaseDir);
          if (!info.isDirectory()) continue;
          state.releases.push(await this.loadRelease(channel, name, releaseDir));
        } catch (err) {
          const problem = err instanceof Error ? err.message : String(err);
          state.broken.push({ version: name, problem });
          this.warnOnce(
            `rel:${channel}:${name}:${problem}`,
            `release ${channel}/${name} ignored: ${problem}`,
          );
        }
      }
      state.releases.sort((a, b) => compareVersions(b.version, a.version));
    }
    return snap;
  }

  private async loadRelease(
    channel: ReleaseChannel,
    dirVersion: string,
    releaseDir: string,
  ): Promise<LoadedRelease> {
    let raw: unknown;
    try {
      raw = await readJsonFile(path.join(releaseDir, 'release.json'));
    } catch (err) {
      throw new Error(`release.json cannot be read (${(err as Error).message})`, { cause: err });
    }
    const parsed = ReleaseManifest.safeParse(raw);
    if (!parsed.success) throw new Error('release.json does not have the expected shape');
    const manifest = parsed.data;
    if (manifest.version !== dirVersion)
      throw new Error('release.json version differs from its directory');
    if (manifest.channel !== channel)
      throw new Error('release.json channel differs from its directory');

    const problems: string[] = [];
    const artifacts: LoadedArtifact[] = [];
    for (const item of manifest.artifacts) {
      const expected = releaseArtifactName(manifest.version, item.platform, item.arch, item.format);
      if (item.fileName !== expected) {
        problems.push(`${item.fileName}: name must be ${expected}`);
        continue;
      }
      const absPath = path.join(releaseDir, expected);
      try {
        const info = await lstat(absPath);
        if (!info.isFile()) {
          problems.push(`${expected}: not a regular file`);
          continue;
        }
        if (info.size !== item.sizeBytes) {
          problems.push(
            `${expected}: size ${info.size} differs from the manifest (${item.sizeBytes})`,
          );
          continue;
        }
        artifacts.push({
          ...item,
          channel,
          version: manifest.version,
          absPath,
          mtimeMs: info.mtimeMs,
          downloadUrl: downloadUrlFor(channel, manifest.version, expected),
        });
      } catch {
        problems.push(`${expected}: file is missing`);
      }
    }
    for (const problem of problems) {
      this.warnOnce(
        `art:${channel}:${dirVersion}:${problem}`,
        `release ${channel}/${dirVersion}: ${problem}; not offered`,
      );
    }
    return {
      channel,
      version: manifest.version,
      publishedAt: manifest.publishedAt,
      notes: manifest.notes,
      minimumSupportedVersion: manifest.minimumSupportedVersion ?? null,
      artifacts,
      problems,
    };
  }
}
