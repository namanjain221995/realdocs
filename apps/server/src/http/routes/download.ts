/**
 * Public downloads of the packaged desktop application: the LEGACY flat-file layout.
 *
 * Versioned, multi-platform releases are served by `releases.ts`. This file keeps the four flat
 * files (`realtimedocs-<platform>-<arch>.zip`) working until the operator migrates, and feeds
 * `GET /api/downloads` from the new release store when a current stable release exists there.
 *
 * Only a fixed allow-list of file names is served, and only from the
 * configured `DOWNLOAD_DIR`; there is no directory traversal and no listing.
 * A name that is not on the list, or a build that has not been published yet,
 * is a 404. `HEAD` is answered so the landing page can show the size and tell
 * a published build from an unpublished one before offering the link.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  DownloadArch,
  DownloadArtifact,
  DownloadPlatform,
  DownloadsResponse,
} from '@realtimedocs/contracts';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { contentDisposition } from '../../assets/filename';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { releaseStoreFor } from '../../releases';

/** The exact file names the landing page links to. Nothing else is served. */
export const DOWNLOADS: Readonly<Record<string, string>> = {
  'realtimedocs-windows-x64.zip': 'application/zip',
  'realtimedocs-windows-arm64.zip': 'application/zip',
  'realtimedocs-macos-arm64.zip': 'application/zip',
  'realtimedocs-macos-x64.zip': 'application/zip',
};

/** Platform and architecture of an allow-listed name (`realtimedocs-<platform>-<arch>.zip`). */
function describeName(name: string): { platform: DownloadPlatform; arch: DownloadArch } | null {
  const match = /^realtimedocs-(windows|macos)-(x64|arm64)\.zip$/.exec(name);
  return match ? { platform: match[1] as DownloadPlatform, arch: match[2] as DownloadArch } : null;
}

/** Optional `release.json` written by the operator. The server never infers `signed`. */
const ReleaseFile = z.object({
  version: z.string().max(64).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
  signed: z.boolean().nullable().default(null),
});
const MAX_RELEASE_FILE_BYTES = 64 * 1024;

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export function registerDownloadRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { downloadDir } = ctx.config;
  const store = releaseStoreFor(ctx);

  // SHA-256 per file, keyed by path, size and modification time: unchanged files are not
  // hashed again. Concurrent requests for the same key share one streaming pass.
  const hashes = new Map<string, Promise<string>>();
  let warnedRelease: string | null = null;

  function cachedHash(filePath: string, size: number, mtimeMs: number): Promise<string> {
    const key = `${filePath}\u0000${size}\u0000${mtimeMs}`;
    let pending = hashes.get(key);
    if (!pending) {
      // Forget older entries of this path: at most one per file is kept.
      for (const existing of hashes.keys()) {
        if (existing.startsWith(`${filePath}\u0000`)) hashes.delete(existing);
      }
      pending = sha256File(filePath);
      hashes.set(key, pending);
      pending.catch(() => hashes.delete(key));
    }
    return pending;
  }

  async function readRelease(dir: string): Promise<DownloadsResponse['release']> {
    const file = path.join(dir, 'release.json');
    let text: string;
    let key: string;
    try {
      const info = await stat(file);
      key = `${info.size}:${info.mtimeMs}`;
      if (!info.isFile() || info.size > MAX_RELEASE_FILE_BYTES) throw new Error('unusable');
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      return warnRelease('release.json cannot be read', err);
    }
    try {
      const parsed = ReleaseFile.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      return warnRelease(
        'release.json does not have the expected shape',
        parsed.error.message,
        key,
      );
    } catch (err) {
      return warnRelease('release.json is not valid JSON', err, key);
    }
  }

  function warnRelease(message: string, detail: unknown, key = 'unreadable'): null {
    // Once per state of the file, not once per request.
    if (warnedRelease !== key) {
      warnedRelease = key;
      ctx.logger.warn({ detail: String(detail).slice(0, 300) }, `${message}; release ignored`);
    }
    return null;
  }

  /** The current stable release of the versioned store in the legacy shape, or null when absent. */
  async function fromReleaseStore(): Promise<DownloadsResponse | null> {
    const release = await store.current('stable');
    if (!release) return null;
    const verified = await store.verified(release);
    if (verified.length === 0) return null;
    const states = verified.map((a) => a.signatureStatus);
    const signed = states.every((x) => x === 'signed' || x === 'notarized')
      ? true
      : states.every((x) => x === 'unsigned' || x === 'dev-signed')
        ? false
        : null;
    return {
      release: { version: release.version, notes: release.notes.slice(0, 2000), signed },
      artifacts: verified.map((a) => ({
        file: a.fileName,
        platform: a.platform,
        arch: a.arch,
        bytes: a.sizeBytes,
        sha256: a.sha256,
        modifiedAt: release.publishedAt,
        url: a.downloadUrl,
      })),
    };
  }

  app.get('/api/downloads', async (): Promise<DownloadsResponse> => {
    if (!downloadDir) return { release: null, artifacts: [] };
    const fromStore = await fromReleaseStore();
    if (fromStore) return fromStore;
    const artifacts: DownloadArtifact[] = [];
    for (const name of Object.keys(DOWNLOADS)) {
      const described = describeName(name);
      if (!described) continue;
      const filePath = path.join(downloadDir, name);
      try {
        const info = await stat(filePath);
        if (!info.isFile()) continue;
        const sha256 = await cachedHash(filePath, info.size, info.mtimeMs);
        artifacts.push({
          file: name,
          ...described,
          bytes: info.size,
          sha256,
          modifiedAt: info.mtime.toISOString(),
          url: `/download/${name}`,
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT') continue;
        throw err;
      }
    }
    return { release: await readRelease(downloadDir), artifacts };
  });

  async function serve(
    request: FastifyRequest<{ Params: { file: string } }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const name = request.params.file;
    const contentType = Object.prototype.hasOwnProperty.call(DOWNLOADS, name)
      ? DOWNLOADS[name]
      : undefined;
    // An unknown name and a not-yet-published build are indistinguishable: 404.
    if (!contentType || !downloadDir) throw errors.notFound('That download is not available.');

    // The name is from the allow-list, so it has no path separators; join is safe.
    const filePath = path.join(downloadDir, name);
    let size: number;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw errors.notFound('That download is not available.');
      size = info.size;
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT') {
        throw errors.notFound('That download is not available.');
      }
      throw err;
    }

    reply
      .header('content-type', contentType)
      .header('content-length', String(size))
      .header('content-disposition', contentDisposition('attachment', name))
      .header('cache-control', 'public, max-age=300')
      .header('x-content-type-options', 'nosniff');
    // Fastify answers an auto-generated HEAD by running this handler and
    // dropping the body, but it would still open the file; answer HEAD here.
    if (request.method === 'HEAD') return reply.send();
    return reply.send(createReadStream(filePath));
  }

  // GET and HEAD are declared together so Fastify does not also auto-add HEAD.
  app.route<{ Params: { file: string } }>({
    method: ['GET', 'HEAD'],
    url: '/download/:file',
    handler: (request, reply) => serve(request, reply),
  });
}

/** Names of the legacy flat files that are present (for the administrator overview). */
export async function listLegacyFiles(dir: string | null): Promise<string[]> {
  if (!dir) return [];
  const present: string[] = [];
  for (const name of Object.keys(DOWNLOADS)) {
    try {
      if ((await stat(path.join(dir, name))).isFile()) present.push(name);
    } catch {
      // absent
    }
  }
  return present;
}
