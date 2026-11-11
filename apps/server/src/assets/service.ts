/**
 * Upload pipeline (docs/architecture.md §6): stream to a staging file with a
 * hard size cut-off, decide the type from the bytes, validate, enforce the
 * per-document quota and move the file into place under a random key.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, readFile, rm } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  ATTACHMENT_EXTENSIONS,
  type Asset,
  type AttachmentExtension,
} from '@realtimedocs/contracts';
import { newId } from '../auth/tokens';
import type { ServerLimits } from '../config';
import type { Db, Queryable } from '../db/pool';
import { ASSET_COLUMNS, type AssetRow } from '../db/rows';
import { AppError, errors } from '../errors';
import { measureImage } from './dimensions';
import { extensionOf, replaceExtension, sanitizeFilename } from './filename';
import { attachmentContentMatches, looksLikeSvg, sniffRaster } from './sniff';
import { newStorageKey, type AssetStorage } from './storage';
import { validateSvg } from './svg';

const HEAD_BYTES = 64 * 1024;
const DIMENSION_PROBE_BYTES = 512 * 1024;
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const RASTER_ALIASES: Record<string, readonly string[]> = {
  png: ['png'],
  jpg: ['jpg', 'jpeg'],
  gif: ['gif'],
  webp: ['webp'],
};

export interface AssetDeps {
  db: Db;
  storage: AssetStorage;
  limits: ServerLimits;
}

export interface UploadInput {
  workspaceId: string;
  documentId: string;
  /** File name as sent by the client. Untrusted. */
  rawFilename: unknown;
  /** The file part. `truncated` is set by the multipart parser when it hit its size limit. */
  stream: Readable & { truncated?: boolean };
  uploadedBy: string | null;
  /** Pre-assigned asset id (used when a document is created together with its first asset). */
  assetId?: string;
}

export function maxUploadBytes(limits: ServerLimits): number {
  return Math.max(limits.maxImageBytes, limits.maxAttachmentBytes);
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
}

interface Classified {
  kind: 'image' | 'attachment';
  mime: string;
  name: string;
  width: number | null;
  height: number | null;
}

async function readPrefix(file: string, length: number): Promise<Uint8Array> {
  const handle = await open(file, 'r');
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function checkDimensions(width: number, height: number, limits: ServerLimits): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw errors.uploadRejected('content_mismatch', 'The image dimensions could not be read.');
  }
  if (
    width > limits.maxImageDimension ||
    height > limits.maxImageDimension ||
    width * height > limits.maxImagePixels
  ) {
    throw errors.uploadRejected(
      'dimensions_too_large',
      `The image is ${width} × ${height} pixels. The limit is ${limits.maxImageDimension} pixels per side and ${Math.round(limits.maxImagePixels / 1_000_000)} megapixels.`,
    );
  }
}

async function classify(
  tempPath: string,
  head: Uint8Array,
  size: number,
  rawFilename: unknown,
  limits: ServerLimits,
): Promise<Classified> {
  const safeName = sanitizeFilename(rawFilename);
  const raster = sniffRaster(head);

  if (raster) {
    if (size > limits.maxImageBytes) {
      throw errors.payloadTooLarge(
        `Images can be at most ${megabytes(limits.maxImageBytes)}.`,
        'too_large',
      );
    }
    let measured;
    try {
      measured = measureImage(
        size <= head.byteLength ? head : await readPrefix(tempPath, DIMENSION_PROBE_BYTES),
      );
    } catch {
      throw errors.uploadRejected('content_mismatch', 'The file is not a readable image.');
    }
    if (!RASTER_ALIASES[raster.extension]?.includes(measured.type ?? '')) {
      throw errors.uploadRejected('content_mismatch', 'The file is not a readable image.');
    }
    checkDimensions(measured.width, measured.height, limits);
    let name = safeName ?? `image.${raster.extension}`;
    if (!RASTER_ALIASES[raster.extension]?.includes(extensionOf(name))) {
      name = replaceExtension(name, raster.extension);
    }
    return {
      kind: 'image',
      mime: raster.mime,
      name,
      width: measured.width,
      height: measured.height,
    };
  }

  if (looksLikeSvg(head)) {
    if (size > limits.maxSvgBytes) {
      throw errors.payloadTooLarge(
        `SVG images can be at most ${megabytes(limits.maxSvgBytes)}.`,
        'too_large',
      );
    }
    const bytes = await readFile(tempPath);
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw errors.uploadRejected('content_mismatch', 'The SVG file is not valid UTF-8 text.');
    }
    const verdict = validateSvg(source);
    if (!verdict.ok) {
      const message =
        verdict.reason === 'active_content'
          ? `This SVG was rejected because it contains active or external content (${verdict.detail}).`
          : verdict.reason === 'type_not_allowed'
            ? `This SVG uses a feature that is not supported (${verdict.detail}). Export it as a plain SVG or as PNG.`
            : `This file is not a valid SVG image (${verdict.detail}).`;
      throw errors.uploadRejected(verdict.reason, message);
    }
    let width: number | null = null;
    let height: number | null = null;
    try {
      const measured = measureImage(bytes);
      if (Number.isFinite(measured.width) && Number.isFinite(measured.height)) {
        width = Math.max(1, Math.round(measured.width));
        height = Math.max(1, Math.round(measured.height));
      }
    } catch {
      // An SVG without usable width/height/viewBox has no intrinsic size.
    }
    if (width !== null && height !== null) {
      if (width > limits.maxImageDimension || height > limits.maxImageDimension) {
        throw errors.uploadRejected(
          'dimensions_too_large',
          `The SVG declares a size of ${width} × ${height}. The limit is ${limits.maxImageDimension} per side.`,
        );
      }
    }
    let name = safeName ?? 'image.svg';
    if (extensionOf(name) !== 'svg') name = replaceExtension(name, 'svg');
    return { kind: 'image', mime: 'image/svg+xml', name, width, height };
  }

  // Not an image: only allow-listed, download-only attachment types.
  if (!safeName) {
    throw errors.uploadRejected(
      'bad_filename',
      'The file needs a name with a supported extension.',
    );
  }
  const extension = extensionOf(safeName);
  if (IMAGE_EXTENSIONS.has(extension)) {
    throw errors.uploadRejected(
      'content_mismatch',
      `The file is named .${extension} but its content is not a supported image.`,
    );
  }
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw errors.uploadRejected(
      'type_not_allowed',
      extension
        ? `Files of type .${extension} cannot be attached.`
        : 'Files without an extension cannot be attached.',
    );
  }
  if (!attachmentContentMatches(extension as AttachmentExtension, head)) {
    throw errors.uploadRejected(
      'content_mismatch',
      `The content of this file does not match its .${extension} extension.`,
    );
  }
  if (size > limits.maxAttachmentBytes) {
    throw errors.payloadTooLarge(
      `Attachments can be at most ${megabytes(limits.maxAttachmentBytes)}.`,
      'too_large',
    );
  }
  return {
    kind: 'attachment',
    mime: 'application/octet-stream',
    name: safeName,
    width: null,
    height: null,
  };
}

/** Sum of stored asset bytes of a document. Call under the quota lock. */
async function usedBytes(db: Queryable, workspaceId: string, documentId: string): Promise<number> {
  const result = await db.query<{ used: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used
       FROM assets WHERE document_id = $1 AND workspace_id = $2`,
    [documentId, workspaceId],
  );
  return result.rows[0]?.used ?? 0;
}

/** Serialises quota checks per document without touching the documents row. */
export async function lockQuota(db: Queryable, documentId: string): Promise<void> {
  await db.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('rd-asset-quota:' || $1::text, 0))`,
    [documentId],
  );
}

export async function storeUpload(deps: AssetDeps, input: UploadInput): Promise<AssetRow> {
  const { storage, limits } = deps;
  const cap = maxUploadBytes(limits);
  const tempPath = storage.newTempPath();
  const hash = createHash('sha256');
  const headChunks: Buffer[] = [];
  let headLength = 0;
  let size = 0;
  let tooLarge = false;
  let committed = false;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > cap) {
        // Hard cut-off: stop writing, keep draining the request.
        tooLarge = true;
        callback();
        return;
      }
      hash.update(chunk);
      if (headLength < HEAD_BYTES) {
        const part = chunk.subarray(0, HEAD_BYTES - headLength);
        headChunks.push(part);
        headLength += part.length;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(input.stream, meter, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
    if (tooLarge || input.stream.truncated === true) {
      throw errors.payloadTooLarge(
        `The file is larger than the ${megabytes(cap)} upload limit.`,
        'too_large',
      );
    }
    if (size === 0) throw errors.uploadRejected('empty', 'The file is empty.');

    const head = Buffer.concat(headChunks);
    const classified = await classify(tempPath, head, size, input.rawFilename, limits);
    const id = input.assetId ?? newId();
    const key = newStorageKey();
    const sha = hash.digest();

    await deps.db.tx(async (tx) => {
      await lockQuota(tx, input.documentId);
      const used = await usedBytes(tx, input.workspaceId, input.documentId);
      if (used + size > limits.documentAssetQuotaBytes) {
        throw errors.quotaExceeded(
          `This document has used ${megabytes(used)} of its ${megabytes(limits.documentAssetQuotaBytes)} file storage. Remove files or ask an administrator to raise the limit.`,
        );
      }
      await tx.query(
        `INSERT INTO assets
           (id, workspace_id, document_id, kind, storage_key, name, mime, size_bytes, width, height,
            sha256, status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)`,
        [
          id,
          input.workspaceId,
          input.documentId,
          classified.kind,
          key,
          classified.name,
          classified.mime,
          size,
          classified.width,
          classified.height,
          sha,
          input.uploadedBy,
        ],
      );
    });

    try {
      await storage.commit(tempPath, key);
      committed = true;
      const ready = await deps.db.query<AssetRow>(
        `UPDATE assets SET status = 'ready' WHERE id = $1 AND workspace_id = $2
         RETURNING ${ASSET_COLUMNS}`,
        [id, input.workspaceId],
      );
      const row = ready.rows[0];
      if (!row) throw new Error('asset row disappeared while it was being stored');
      return row;
    } catch (error) {
      // Leave nothing behind: neither a row without bytes nor bytes without a row.
      await deps.db
        .query('DELETE FROM assets WHERE id = $1 AND workspace_id = $2', [id, input.workspaceId])
        .catch(() => undefined);
      if (committed) await storage.remove(key).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A client that disconnects mid-upload is not a server fault.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET') {
      throw errors.validation('The upload was interrupted.');
    }
    throw error;
  } finally {
    if (!committed) await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export function toApiAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findReadyAsset(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  assetId: string,
): Promise<AssetRow | null> {
  const result = await db.query<AssetRow>(
    `SELECT ${ASSET_COLUMNS} FROM assets
      WHERE id = $1 AND document_id = $2 AND workspace_id = $3 AND status = 'ready'`,
    [assetId, documentId, workspaceId],
  );
  return result.rows[0] ?? null;
}

export async function findReadyAssets(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  assetIds: readonly string[],
): Promise<AssetRow[]> {
  if (assetIds.length === 0) return [];
  const result = await db.query<AssetRow>(
    `SELECT ${ASSET_COLUMNS} FROM assets
      WHERE id = ANY($1::uuid[]) AND document_id = $2 AND workspace_id = $3 AND status = 'ready'`,
    [assetIds, documentId, workspaceId],
  );
  return result.rows;
}

/**
 * Deletes the files of queued deletions that are due (`not_before` reached)
 * and whose key is not referenced by any asset row. Entries are written by the
 * transaction that removed the assets, so nothing is leaked by a crash between
 * that commit and the unlink.
 */
export async function drainAssetDeletions(db: Queryable, storage: AssetStorage): Promise<number> {
  // A key that is in use again (a duplicate that completed) must never be deleted.
  await db.query(
    `DELETE FROM asset_deletions d
      WHERE d.not_before <= now()
        AND EXISTS (SELECT 1 FROM assets a WHERE a.storage_key = d.storage_key)`,
  );
  const queued = await db.query<{ storageKey: string }>(
    `SELECT d.storage_key AS "storageKey" FROM asset_deletions d
      WHERE d.not_before <= now()
        AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.storage_key = d.storage_key)
      LIMIT 5000`,
  );
  let removed = 0;
  for (const { storageKey } of queued.rows) {
    await storage.remove(storageKey);
    await db.query('DELETE FROM asset_deletions WHERE storage_key = $1', [storageKey]);
    removed += 1;
  }
  return removed;
}
