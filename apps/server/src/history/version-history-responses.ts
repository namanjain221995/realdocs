/**
 * The four answers of the version history document, shared by the routes for signed-in
 * administrators (`/api/documents/:id/version-history…`) and the service API
 * (`/api/v1/…/version-history…`): the document as text or JSON, the image list, one image's
 * bytes, and the archive.
 */
import { PassThrough, type Readable, type Writable } from 'node:stream';
import type {
  VersionHistoryGroupingQuery,
  VersionHistoryImagesResponse,
  VersionHistoryQuery,
  VersionHistoryResponse,
} from '@realtimedocs/contracts';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { contentDisposition, sanitizeFilename } from '../assets/filename';
import { findReadyAssets } from '../assets/service';
import type { AppContext } from '../context';
import { errors } from '../errors';
import {
  imageFileName,
  renderVersionHistoryText,
  versionHistoryManifest,
} from './version-document';
import { buildVersionHistory, findHistoryImage } from './version-history';

/** A response that is not JSON: text, a file, or a stream. */
export class RawResponse {
  constructor(
    readonly contentType: string,
    readonly body: string | Buffer | Readable,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {}
}

export interface VersionHistoryTarget {
  document: { id: string; title: string };
  /** Path under which this caller reaches the images, ending in `/images/`. */
  imageUrlPrefix: string;
}

function build(
  ctx: AppContext,
  target: VersionHistoryTarget,
  options: VersionHistoryGroupingQuery,
): Promise<VersionHistoryResponse> {
  return buildVersionHistory({
    db: ctx.db,
    workspaceId: ctx.workspace.id,
    publicOrigin: ctx.config.publicOrigin,
    document: target.document,
    options,
    imageUrlPrefix: target.imageUrlPrefix,
  });
}

/** `doc.txt`, or the same content as JSON. */
export async function versionHistoryDocument(
  ctx: AppContext,
  target: VersionHistoryTarget,
  query: VersionHistoryQuery,
): Promise<RawResponse | VersionHistoryResponse> {
  const { format, ...options } = query;
  const history = await build(ctx, target, options);
  if (format === 'json') return history;
  return new RawResponse('text/plain; charset=utf-8', renderVersionHistoryText(history), {
    'content-disposition': contentDisposition('attachment', 'doc.txt'),
  });
}

export async function versionHistoryImages(
  ctx: AppContext,
  target: VersionHistoryTarget,
  options: VersionHistoryGroupingQuery,
): Promise<VersionHistoryImagesResponse> {
  return { images: (await build(ctx, target, options)).images };
}

/** One image's bytes. 404 for anything that is not an image of this document's history. */
export async function versionHistoryImage(
  ctx: AppContext,
  documentId: string,
  imageId: string,
): Promise<RawResponse> {
  const asset = await findHistoryImage(ctx.db, ctx.workspace.id, documentId, imageId);
  const size = asset ? await ctx.storage.size(asset.storageKey) : null;
  if (!asset || size === null) {
    throw errors.notFound('That image is not part of this document’s history.');
  }
  return new RawResponse(asset.mime, ctx.storage.createReadStream(asset.storageKey), {
    'content-length': String(size),
    'content-disposition': contentDisposition(
      'attachment',
      imageFileName(asset.id, asset.mime, asset.name),
    ),
    'cache-control': 'private, no-cache',
    // An SVG must never run in this origin, whoever opens it.
    'content-security-policy': "default-src 'none'; sandbox",
  });
}

/** Resolves when the stream can take more data or has been closed. Never rejects. */
function drainOrClose(stream: Writable): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      stream.off('drain', done);
      stream.off('close', done);
      resolve();
    };
    stream.once('drain', done);
    stream.once('close', done);
  });
}

/**
 * `docs/doc.txt`, `images/<file name>` for every image that ever appeared, and `manifest.json`.
 * The images are streamed from storage, never held in memory.
 */
export async function versionHistoryArchive(
  ctx: AppContext,
  target: VersionHistoryTarget,
  options: VersionHistoryGroupingQuery,
  onError: (error: unknown) => void,
): Promise<RawResponse> {
  const history = await build(ctx, target, options);
  const rows = await findReadyAssets(
    ctx.db,
    ctx.workspace.id,
    target.document.id,
    history.images.map((image) => image.id),
  );
  const keys = new Map(rows.map((row) => [row.id, row.storageKey]));
  const files: { fileName: string; storageKey: string }[] = [];
  for (const image of history.images) {
    const storageKey = keys.get(image.id);
    if (storageKey && (await ctx.storage.size(storageKey)) !== null) {
      files.push({ fileName: image.fileName, storageKey });
    }
  }

  const output = new PassThrough();
  // The client may go away mid-download; that must not surface as an unhandled error.
  output.on('error', () => undefined);
  const zip = new Zip((error, chunk, final) => {
    if (output.destroyed) return;
    if (error) {
      output.destroy(error);
      return;
    }
    output.write(chunk);
    if (final) output.end();
  });
  const addText = (name: string, text: string): void => {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(Buffer.from(text, 'utf8'), true);
  };
  const pack = async () => {
    addText('docs/doc.txt', renderVersionHistoryText(history));
    addText('manifest.json', `${JSON.stringify(versionHistoryManifest(history), null, 2)}\n`);
    for (const file of files) {
      if (output.destroyed) return;
      // Images are already compressed; store them as they are.
      const entry = new ZipPassThrough(`images/${file.fileName}`);
      zip.add(entry);
      for await (const chunk of ctx.storage.createReadStream(file.storageKey)) {
        if (output.destroyed) return;
        entry.push(chunk as Uint8Array);
        if (output.writableNeedDrain) await drainOrClose(output);
      }
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
  };
  pack().catch((error: unknown) => {
    onError(error);
    output.destroy(error instanceof Error ? error : new Error('archive failed'));
  });

  const base = sanitizeFilename(target.document.title.replace(/[/\\]/g, '_')) ?? 'document';
  return new RawResponse('application/zip', output, {
    'content-disposition': contentDisposition('attachment', `${base}-version-history.zip`),
  });
}
