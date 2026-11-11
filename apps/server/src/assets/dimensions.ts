/**
 * Image dimension probing.
 *
 * `image-size` reads through `new DataView(input.buffer, input.byteOffset + offset)`,
 * that is without a length bound. Node allocates small Buffers from a shared
 * pool, so a truncated image would be "measured" from whatever lies behind it
 * in that pool: the result would not be deterministic and the reported width
 * and height would expose neighbouring memory. Every probe therefore runs on a
 * private, exactly sized copy, where reading past the end throws.
 */
import { imageSize } from 'image-size';

export interface MeasuredImage {
  width: number;
  height: number;
  /** Format name as detected by `image-size` (`png`, `jpg`, `gif`, `webp`, `svg`, …). */
  type: string | undefined;
}

/**
 * Reads the intrinsic size of an image from its leading bytes.
 * Throws when the bytes are not a readable image header (including truncation).
 */
export function measureImage(bytes: Uint8Array): MeasuredImage {
  // `new Uint8Array(n)` owns a fresh ArrayBuffer of exactly `n` bytes (never the Buffer pool).
  const isolated = new Uint8Array(bytes.byteLength);
  isolated.set(bytes);
  const measured = imageSize(isolated);
  return { width: measured.width, height: measured.height, type: measured.type };
}
