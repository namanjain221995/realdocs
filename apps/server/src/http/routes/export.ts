/**
 * Exports (view access): plain text, Markdown, Markdown + assets as a zip,
 * and the ProseMirror JSON used by the print view.
 */
import { PassThrough, type Writable } from 'node:stream';
import { ExportQuery, normalizePageSettings, Y_PAGE_FIELD } from '@realtimedocs/contracts';
import { collectAssetIds, toMarkdown, toPlainText } from '@realtimedocs/editor/export';
import type { DocJSON } from '@realtimedocs/editor/schema';
import type { FastifyInstance } from 'fastify';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { contentDisposition, extensionOf, sanitizeFilename } from '../../assets/filename';
import { findReadyAssets } from '../../assets/service';
import type { AssetRow, DocumentRow } from '../../db/rows';
import { loadDurableState } from '../../documents/store';
import { pageSettingsFromState, stateToJson, ydocToJson } from '../../documents/ydoc';
import { errors } from '../../errors';
import type { RouteDeps } from '../app';
import { documentAccess } from '../auth';
import { param, parseInput } from '../util';

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

/** Unique, safe file names for the assets of one export. */
export function assignAssetFileNames(assets: readonly AssetRow[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const asset of assets) {
    const base = sanitizeFilename(asset.name) ?? `file-${asset.id.slice(0, 8)}`;
    let candidate = base;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      // Insert the counter before the extension, keeping the extension as written.
      const dot = extensionOf(base) === '' ? base.length : base.lastIndexOf('.');
      candidate = `${base.slice(0, dot)}-${counter}${base.slice(dot)}`;
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    names.set(asset.id, candidate);
  }
  return names;
}

export function registerExportRoutes(app: FastifyInstance, { ctx }: RouteDeps): void {
  const { db, workspace, storage } = ctx;

  /** What collaborators see right now when the document is open, else the durable state. */
  async function currentContent(document: DocumentRow): Promise<DocJSON> {
    const live = ctx.collab.liveDocument(document.id, document.generation);
    if (live) return ydocToJson(live);
    const durable = await loadDurableState(db, workspace.id, document.id);
    if (!durable) throw errors.notFound();
    return stateToJson(durable.state, durable.updates);
  }

  /** The page settings collaborators see right now (live document) or the durable ones. */
  async function currentPageSettings(document: DocumentRow) {
    const live = ctx.collab.liveDocument(document.id, document.generation);
    if (live) return normalizePageSettings(live.getMap(Y_PAGE_FIELD).toJSON());
    const durable = await loadDurableState(db, workspace.id, document.id);
    return pageSettingsFromState(durable?.state ?? null, durable?.updates ?? []);
  }

  app.get('/api/documents/:documentId/export', async (request, reply) => {
    const access = await documentAccess(ctx, request, param(request, 'documentId'));
    // Interview candidates export only when the session allows it (also covers the print view).
    if (!access.capabilities.canExport) {
      throw errors.forbidden('Exporting this document is not allowed for your link.');
    }
    const { format } = parseInput(ExportQuery, request.query);
    const document = access.document;
    const content = await currentContent(document);
    // A title is not a path: keep slashes as characters instead of cutting at them.
    const baseName = sanitizeFilename(document.title.replace(/[/\\]/g, '_')) ?? 'document';
    reply.header('x-content-type-options', 'nosniff');

    // Every format is a download (the web Export menu uses plain links); the
    // print view reads the JSON with fetch, where the disposition is irrelevant.
    if (format === 'json') {
      return (
        reply
          .type('application/json; charset=utf-8')
          .header('content-disposition', contentDisposition('attachment', `${baseName}.json`))
          // `pageSettings` sits beside the ProseMirror fields; readers that only know the
          // document ignore it, and the print view uses it for the sheet.
          .send(JSON.stringify({ ...content, pageSettings: await currentPageSettings(document) }))
      );
    }
    if (format === 'txt') {
      return reply
        .type('text/plain; charset=utf-8')
        .header('content-disposition', contentDisposition('attachment', `${baseName}.txt`))
        .send(toPlainText(content));
    }

    // Only assets of this very document are ever looked up or packed.
    const referenced = collectAssetIds(content);
    const assets = await findReadyAssets(db, workspace.id, document.id, referenced);
    // Document order, so file names are assigned the same way every time.
    assets.sort((a, b) => referenced.indexOf(a.id) - referenced.indexOf(b.id));
    const available: AssetRow[] = [];
    for (const asset of assets) {
      if ((await storage.size(asset.storageKey)) !== null) available.push(asset);
    }
    const names = assignAssetFileNames(available);
    const markdown = toMarkdown(content, { assetFileName: (id) => names.get(id) ?? null });

    if (format === 'md') {
      return reply
        .type('text/markdown; charset=utf-8')
        .header('content-disposition', contentDisposition('attachment', `${baseName}.md`))
        .send(markdown);
    }

    // md-zip: document.md plus an assets/ folder, streamed without buffering the files.
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
    const pack = async () => {
      const text = new ZipDeflate('document.md', { level: 6 });
      zip.add(text);
      text.push(Buffer.from(markdown, 'utf8'), true);
      for (const asset of available) {
        if (output.destroyed) return;
        // Images are already compressed; store everything as-is.
        const entry = new ZipPassThrough(`assets/${names.get(asset.id) ?? asset.id}`);
        zip.add(entry);
        for await (const chunk of storage.createReadStream(asset.storageKey)) {
          if (output.destroyed) return;
          entry.push(chunk as Uint8Array);
          // Respect backpressure; stop waiting when the download is abandoned.
          if (output.writableNeedDrain) await drainOrClose(output);
        }
        entry.push(new Uint8Array(0), true);
      }
      zip.end();
    };
    pack().catch((err: unknown) => {
      request.log.error({ err, documentId: document.id }, 'zip export failed while streaming');
      output.destroy(err instanceof Error ? err : new Error('zip export failed'));
    });
    return reply
      .type('application/zip')
      .header('content-disposition', contentDisposition('attachment', `${baseName}.zip`))
      .send(output);
  });
}
