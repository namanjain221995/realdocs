import { describe, expect, it } from 'vitest';
import { measureImage } from '../../src/assets/dimensions';

/** The first 33 bytes of a PNG file: signature and a complete IHDR chunk (CRC not checked). */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24); // bit depth, colour type, compression, filter, interlace
  return bytes;
}

/** Places `bytes` inside a larger buffer full of 0xff, like a slice of Node's Buffer pool. */
function insidePool(bytes: Uint8Array): Uint8Array {
  const pool = new Uint8Array(bytes.byteLength + 64).fill(0xff);
  pool.set(bytes, 16);
  return pool.subarray(16, 16 + bytes.byteLength);
}

describe('measureImage', () => {
  it('reads the size of a complete PNG header', () => {
    expect(measureImage(pngHeader(640, 480))).toEqual({ width: 640, height: 480, type: 'png' });
  });

  it('gives the same answer when the bytes are a view into a larger buffer', () => {
    expect(measureImage(insidePool(pngHeader(50, 70)))).toEqual({
      width: 50,
      height: 70,
      type: 'png',
    });
  });

  it('rejects a header cut off before the height instead of reading the memory behind it', () => {
    // 20 bytes: signature, chunk length, "IHDR" and the width; the height is missing.
    const truncated = insidePool(pngHeader(50, 50).subarray(0, 20));
    expect(() => measureImage(truncated)).toThrow();
  });

  it('rejects a header cut off inside the width', () => {
    expect(() => measureImage(insidePool(pngHeader(50, 50).subarray(0, 18)))).toThrow();
  });

  it('rejects bytes that are not an image', () => {
    expect(() => measureImage(new TextEncoder().encode('not an image at all'))).toThrow();
  });
});
