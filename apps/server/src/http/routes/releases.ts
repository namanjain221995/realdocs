/**
 * Desktop release distribution (docs/desktop-release.md): the public manifest endpoints, the
 * versioned artifact download with Range support, anonymous download counters and the administrator
 * overview. All files come from the verified snapshot of `ReleaseStore`; no path is ever built from
 * request input.
 */
import { createReadStream } from 'node:fs';
import {
  COLLAB_PROTOCOL_VERSION,
  ReleaseArch,
  ReleaseChannel,
  ReleasePlatform,
  type AdminReleasesResponse,
  type DesktopUpdateResponse,
  type LatestReleaseResponse,
  type ReleaseArtifact,
  type ReleaseFormat,
  type ReleaseListResponse,
  type ReleaseSummary,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contentDisposition } from '../../assets/filename';
import { AppError, errors } from '../../errors';
import { parseRange } from '../../releases/range';
import { decideUpdate, defaultArch, detectPlatform, pickArtifact } from '../../releases/select';
import { releaseStoreFor } from '../../releases';
import type { LoadedArtifact, LoadedRelease } from '../../releases/store';
import { SEMVER_PATTERN } from '@realtimedocs/contracts';
import type { RouteDeps } from '../app';
import { listLegacyFiles } from './download';
import { requireAdmin } from '../auth';
import { parseInput } from '../util';

const CONTENT_TYPES: Record<ReleaseFormat, string> = {
  zip: 'application/zip',
  exe: 'application/octet-stream',
  dmg: 'application/x-apple-diskimage',
  appimage: 'application/octet-stream',
  'tar.gz': 'application/gzip',
};

const ChannelQuery = z.object({ channel: ReleaseChannel.default('stable') });
const LatestQuery = z.object({
  platform: ReleasePlatform.optional(),
  arch: ReleaseArch.optional(),
  channel: ReleaseChannel.default('stable'),
});
const UpdateQuery = z.object({
  platform: ReleasePlatform,
  arch: ReleaseArch,
  channel: ReleaseChannel.default('stable'),
  currentVersion: z.string().max(64).regex(SEMVER_PATTERN, 'Not a semantic version'),
  installId: z
    .string()
    .regex(/^[0-9A-Za-z-]{8,64}$/)
    .optional(),
  schemaVersion: z.coerce.number().int().min(0).max(1000).optional(),
  protocolVersion: z.coerce.number().int().min(0).max(1000).optional(),
});
const VersionParams = z.object({ version: z.string().max(64).regex(SEMVER_PATTERN) });

function publicArtifact(a: LoadedArtifact): ReleaseArtifact {
  return {
    platform: a.platform,
    arch: a.arch,
    format: a.format,
    fileName: a.fileName,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    minimumOsVersion: a.minimumOsVersion,
    signatureStatus: a.signatureStatus,
    downloadUrl: a.downloadUrl,
  };
}

export function registerReleaseRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const store = releaseStoreFor(ctx);
  if (store.configured) store.warm();

  async function summarize(
    release: LoadedRelease,
    currentVersion: string | null,
  ): Promise<ReleaseSummary> {
    return {
      version: release.version,
      channel: release.channel,
      publishedAt: release.publishedAt,
      notes: release.notes,
      minimumSupportedVersion: release.minimumSupportedVersion,
      current: release.version === currentVersion,
      artifacts: (await store.verified(release)).map(publicArtifact),
    };
  }

  async function currentOf(channel: ReleaseChannel) {
    const release = await store.current(channel);
    const state = (await store.snapshot()).channels[channel];
    return { release, pointer: state.pointer };
  }

  const notesUrl = (version: string) => `/releases/${version}`;

  app.get('/api/v1/desktop/releases/latest', async (request): Promise<LatestReleaseResponse> => {
    const query = parseInput(LatestQuery, request.query);
    let platform = query.platform;
    let detected: LatestReleaseResponse['detected'];
    if (!platform) {
      const guess = detectPlatform(request.headers);
      if (!guess) {
        throw errors.validation('Say which platform you need: windows, macos or linux.', [
          { path: 'platform', message: 'Required when it cannot be detected' },
        ]);
      }
      platform = guess.platform;
      detected = guess;
    }
    const arch = query.arch ?? defaultArch(platform);
    const { release } = await currentOf(query.channel);
    const artifact = release ? pickArtifact(await store.verified(release), platform, arch) : null;
    if (!release || !artifact) {
      throw new AppError(
        'RELEASE_NOT_AVAILABLE',
        `No ${query.channel} release is published for ${platform} ${arch} yet.`,
      );
    }
    return {
      version: release.version,
      channel: release.channel,
      platform: artifact.platform,
      arch: artifact.arch,
      format: artifact.format,
      fileName: artifact.fileName,
      downloadUrl: artifact.downloadUrl,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      minimumOsVersion: artifact.minimumOsVersion,
      publishedAt: release.publishedAt,
      releaseNotesUrl: notesUrl(release.version),
      signatureStatus: artifact.signatureStatus,
      ...(detected ? { detected } : {}),
    };
  });

  app.get('/api/v1/desktop/releases', async (request): Promise<ReleaseListResponse> => {
    const { channel } = parseInput(ChannelQuery, request.query);
    const snap = (await store.snapshot()).channels[channel];
    const current = (await store.current(channel))?.version ?? null;
    const releases = await Promise.all(snap.releases.map((r) => summarize(r, current)));
    return { channel, releases };
  });

  app.get('/api/v1/desktop/releases/:version', async (request): Promise<ReleaseSummary> => {
    const { version } = parseInput(VersionParams, request.params);
    const { channel } = parseInput(ChannelQuery, request.query);
    const release = await store.find(channel, version);
    if (!release) throw errors.notFound('That release does not exist.');
    return summarize(release, (await store.current(channel))?.version ?? null);
  });

  app.get('/api/v1/desktop/update', async (request): Promise<DesktopUpdateResponse> => {
    const query = parseInput(UpdateQuery, request.query);
    const { release, pointer } = await currentOf(query.channel);
    const artifact = release
      ? pickArtifact(await store.verified(release), query.platform, query.arch)
      : null;
    const decision = decideUpdate({
      currentVersion: query.currentVersion,
      releaseVersion: release?.version ?? null,
      minimumSupportedVersion: release?.minimumSupportedVersion ?? null,
      hasArtifact: artifact !== null,
      rolloutPercent: pointer?.rolloutPercent,
      installId: query.installId,
      clientSchemaVersion: query.schemaVersion,
      clientProtocolVersion: query.protocolVersion,
      minClientSchemaVersion: ctx.config.minClientSchemaVersion,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
    });
    const offer = release && artifact && (decision.updateAvailable || decision.required);
    return {
      updateAvailable: decision.updateAvailable,
      required: decision.required,
      version: offer ? release.version : null,
      notes: offer ? release.notes : null,
      downloadUrl: offer ? artifact.downloadUrl : null,
      sha256: offer ? artifact.sha256 : null,
      sizeBytes: offer ? artifact.sizeBytes : null,
      signatureStatus: offer ? artifact.signatureStatus : null,
      releaseNotesUrl: offer ? notesUrl(release.version) : null,
      fileName: offer ? artifact.fileName : null,
    };
  });

  // ── Artifact download ─────────────────────────────────────────────────────

  function count(artifact: LoadedArtifact): void {
    ctx.metrics.downloads.inc({ platform: artifact.platform });
    ctx.db
      .query(
        `INSERT INTO release_download_counts (day, channel, version, platform, arch, format, count)
         VALUES ((now() AT TIME ZONE 'utc')::date, $1, $2, $3, $4, $5, 1)
         ON CONFLICT (day, channel, version, platform, arch, format)
         DO UPDATE SET count = release_download_counts.count + 1`,
        [artifact.channel, artifact.version, artifact.platform, artifact.arch, artifact.format],
      )
      .catch((err: unknown) =>
        ctx.logger.warn({ err: String(err) }, 'download count not recorded'),
      );
  }

  app.route<{ Params: { channel: string; version: string; fileName: string } }>({
    method: ['GET', 'HEAD'],
    url: '/download/releases/:channel/:version/:fileName',
    handler: async (request, reply) => {
      const { channel, version, fileName } = request.params;
      const artifact = await store.findArtifact(channel, version, fileName);
      // Unknown, unlisted and hash-mismatching files are all the same 404.
      if (!artifact || !(await store.isVerified(artifact))) {
        throw errors.notFound('That download is not available.');
      }
      if (request.method === 'GET') await limits.download.consume(request, request.ip);

      const size = artifact.sizeBytes;
      const etag = `"${artifact.sha256}"`;
      reply
        .header('content-type', CONTENT_TYPES[artifact.format])
        .header('content-disposition', contentDisposition('attachment', artifact.fileName))
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('accept-ranges', 'bytes')
        .header('etag', etag)
        .header('x-content-type-options', 'nosniff');

      const ifRange = request.headers['if-range'];
      const rangeHeader =
        ifRange !== undefined && ifRange !== etag ? undefined : request.headers.range;
      const range = parseRange(rangeHeader, size);
      if (range.kind === 'unsatisfiable') {
        return reply.code(416).header('content-range', `bytes */${size}`).send();
      }
      if (range.kind === 'partial') {
        const length = range.end - range.start + 1;
        reply
          .code(206)
          .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
          .header('content-length', String(length));
        if (request.method === 'HEAD') return reply.send();
        // A resumed transfer is the same download: only the first byte range is counted.
        if (range.start === 0) count(artifact);
        return reply.send(
          createReadStream(artifact.absPath, { start: range.start, end: range.end }),
        );
      }
      reply.header('content-length', String(size));
      if (request.method === 'HEAD') return reply.send();
      count(artifact);
      return reply.send(createReadStream(artifact.absPath));
    },
  });

  // ── Administrator overview ────────────────────────────────────────────────

  app.get('/api/admin/releases', async (request): Promise<AdminReleasesResponse> => {
    await requireAdmin(ctx, request);
    const snap = await store.snapshot();
    const rows = await ctx.db.query<{
      channel: string;
      version: string;
      platform: string;
      arch: string;
      format: string;
      total: string;
    }>(
      `SELECT channel, version, platform, arch, format, sum(count)::text AS total
         FROM release_download_counts GROUP BY channel, version, platform, arch, format`,
    );
    const counts = new Map<string, number>();
    for (const row of rows.rows) {
      counts.set(
        `${row.channel}/${row.version}/${row.platform}/${row.arch}/${row.format}`,
        Number(row.total),
      );
    }
    const channels: AdminReleasesResponse['channels'] = [];
    for (const channel of ReleaseChannel.options) {
      const state = snap.channels[channel];
      const current = (await store.current(channel))?.version ?? null;
      const releases = await Promise.all(
        state.releases.map(async (release) => {
          const summary = await summarize(release, current);
          const artifacts = summary.artifacts.map((a) => ({
            ...a,
            downloads:
              counts.get(`${channel}/${release.version}/${a.platform}/${a.arch}/${a.format}`) ?? 0,
          }));
          return {
            ...summary,
            artifacts,
            downloads: artifacts.reduce((sum, a) => sum + a.downloads, 0),
          };
        }),
      );
      const problems = [
        ...state.broken,
        ...state.releases.flatMap((r) =>
          r.problems.map((problem) => ({ version: r.version, problem })),
        ),
      ];
      // Files that exist but whose hash does not match are reported too.
      for (const release of state.releases) {
        const ok = new Set((await store.verified(release)).map((a) => a.fileName));
        for (const a of release.artifacts) {
          if (!ok.has(a.fileName)) {
            problems.push({
              version: release.version,
              problem: `${a.fileName}: SHA-256 does not match the manifest`,
            });
          }
        }
      }
      channels.push({ channel, pointer: state.pointer, releases, problems });
    }
    return {
      configured: snap.configured,
      channels,
      legacyFiles: await listLegacyFiles(ctx.config.downloadDir),
    };
  });
}
