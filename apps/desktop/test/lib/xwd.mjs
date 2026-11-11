// Reads the framebuffer file that Xvfb writes with `-fbdir` (an X window dump)
// and turns it into a PNG. Unlike a page screenshot, this is the whole display:
// native dialogs and window frames included. Used by the packaged check and by
// the smoke test of the server-change dialog. Linux/Xvfb only.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crcChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(zlib.crc32(body) >>> 0, 8 + data.length);
  return chunk;
}

/**
 * Decodes an X window dump (32 bits per pixel, as Xvfb writes for a 24-bit
 * screen) into rows of RGB bytes.
 * @param {Buffer} xwd
 */
export function decodeXwd(xwd) {
  const headerSize = xwd.readUInt32BE(0);
  const width = xwd.readUInt32BE(16);
  const height = xwd.readUInt32BE(20);
  const lsbFirst = xwd.readUInt32BE(28) === 0;
  const bitsPerPixel = xwd.readUInt32BE(44);
  const bytesPerLine = xwd.readUInt32BE(48);
  const masks = [xwd.readUInt32BE(56), xwd.readUInt32BE(60), xwd.readUInt32BE(64)];
  const colours = xwd.readUInt32BE(76);
  if (bitsPerPixel !== 32) throw new Error(`unsupported framebuffer depth: ${bitsPerPixel} bpp`);
  const shifts = masks.map((mask) => Math.log2(mask & -mask));
  const pixels = headerSize + colours * 12;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixels + y * bytesPerLine + x * 4;
      const value = lsbFirst ? xwd.readUInt32LE(offset) : xwd.readUInt32BE(offset);
      for (let channel = 0; channel < 3; channel += 1) {
        rgb[(y * width + x) * 3 + channel] = ((value & masks[channel]) >>> shifts[channel]) & 0xff;
      }
    }
  }
  return { width, height, rgb };
}

/**
 * Converts an X window dump to a PNG. `litRatio` is the share of colour
 * channels that are not (nearly) black: 0 for an empty display.
 * @param {Buffer} xwd
 */
export function xwdToPng(xwd) {
  const { width, height, rgb } = decodeXwd(xwd);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let lit = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    rgb.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  for (const byte of rgb) if (byte > 24) lit += 1;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', header),
    crcChunk('IDAT', zlib.deflateSync(raw)),
    crcChunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, width, height, rgb, litRatio: lit / (width * height * 3) };
}

/**
 * The current content of screen 0 of an Xvfb started with `-fbdir <directory>`,
 * or null when there is no such file (another kind of display).
 * @param {string | null | undefined} directory
 */
export function readDisplay(directory) {
  if (!directory) return null;
  const file = path.join(directory, 'Xvfb_screen0');
  if (!fs.existsSync(file)) return null;
  return xwdToPng(fs.readFileSync(file));
}

/**
 * How many pixels differ between two pictures of the same display, and the
 * smallest rectangle that contains all of them (null if none differ).
 * @param {{ width: number, height: number, rgb: Buffer }} before
 * @param {{ width: number, height: number, rgb: Buffer }} after
 */
export function displayDifference(before, after) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error('the two pictures have different sizes');
  }
  let changed = 0;
  let left = before.width;
  let top = before.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const index = (y * before.width + x) * 3;
      if (
        before.rgb[index] !== after.rgb[index] ||
        before.rgb[index + 1] !== after.rgb[index + 1] ||
        before.rgb[index + 2] !== after.rgb[index + 2]
      ) {
        changed += 1;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return {
    changed,
    box:
      changed === 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
  };
}
