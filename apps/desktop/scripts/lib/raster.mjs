// Tiny dependency-free rasteriser and image container writers used to generate
// the app's original icon assets at build time: anti-aliased shapes from signed
// distance functions, a PNG encoder, and ICO / ICNS containers.
import zlib from 'node:zlib';

const SUBSAMPLES = 4;

/** RGBA canvas with straight (non-premultiplied) alpha. */
export function createCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) };
}

function blend(canvas, x, y, color, coverage) {
  const alpha = color[3] * coverage;
  if (alpha <= 0) return;
  const index = (y * canvas.size + x) * 4;
  const d = canvas.data;
  const destinationAlpha = d[index + 3];
  const outAlpha = alpha + destinationAlpha * (1 - alpha);
  if (outAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    d[index + channel] =
      (color[channel] * alpha + d[index + channel] * destinationAlpha * (1 - alpha)) / outAlpha;
  }
  d[index + 3] = outAlpha;
}

/**
 * Fills the region where `distance(x, y) <= 0`. `paint(x, y)` returns the
 * colour ([r, g, b, a], each 0–1) for a pixel centre.
 */
export function fillShape(canvas, distance, paint) {
  const { size } = canvas;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inside = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const px = x + (sx + 0.5) / SUBSAMPLES;
          const py = y + (sy + 0.5) / SUBSAMPLES;
          if (distance(px, py) <= 0) inside += 1;
        }
      }
      if (inside > 0) {
        blend(canvas, x, y, paint(x + 0.5, y + 0.5), inside / (SUBSAMPLES * SUBSAMPLES));
      }
    }
  }
}

/** Signed distance to a rounded rectangle. */
export function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  const cx = x + width / 2;
  const cy = y + height / 2;
  return (px, py) => {
    const qx = Math.abs(px - cx) - (width / 2 - r);
    const qy = Math.abs(py - cy) - (height / 2 - r);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const inside = Math.min(Math.max(qx, qy), 0);
    return outside + inside - r;
  };
}

export function circle(cx, cy, radius) {
  return (px, py) => Math.hypot(px - cx, py - cy) - radius;
}

/** The band of the given thickness just inside a shape's edge. */
export function strokeInside(distance, thickness) {
  return (px, py) => {
    const d = distance(px, py);
    return Math.max(d, -thickness - d);
  };
}

export const solid = (color) => () => color;

export function verticalGradient(top, bottom, y0, y1) {
  return (_x, y) => {
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    return top.map((value, index) => value + (bottom[index] - value) * t);
  };
}

/** `#rrggbb` → [r, g, b, alpha]. */
export function rgba(hex, alpha = 1) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
}

export function toRgba8(canvas) {
  const out = Buffer.alloc(canvas.size * canvas.size * 4);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Math.round(Math.min(1, Math.max(0, canvas.data[index])) * 255);
  }
  return out;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit RGBA pixels as a PNG. `dpi` adds a pHYs chunk (144 for @2x menu-bar images). */
export function encodePng(rgba8, size, dpi) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba8.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunks = [chunk('IHDR', header)];
  if (dpi) {
    const physical = Buffer.alloc(9);
    const pixelsPerMetre = Math.round(dpi / 0.0254);
    physical.writeUInt32BE(pixelsPerMetre, 0);
    physical.writeUInt32BE(pixelsPerMetre, 4);
    physical[8] = 1;
    chunks.push(chunk('pHYs', physical));
  }
  chunks.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/** 32-bit BMP payload as stored inside an .ico (double height: colour bitmap + 1-bit mask). */
function icoBitmap(rgba8, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4; // bottom-up
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4;
      const to = (y * size + x) * 4;
      pixels[to] = rgba8[from + 2];
      pixels[to + 1] = rgba8[from + 1];
      pixels[to + 2] = rgba8[from];
      pixels[to + 3] = rgba8[from + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size); // all zero: alpha channel decides
  header.writeUInt32LE(pixels.length + mask.length, 20);
  return Buffer.concat([header, pixels, mask]);
}

/**
 * Builds a Windows .ico from `{ size, rgba8 }` images. Sizes below 256 are
 * stored as 32-bit bitmaps (understood everywhere), 256 as PNG.
 */
export function encodeIco(images) {
  const payloads = images.map(({ size, rgba8 }) =>
    size >= 256 ? encodePng(rgba8, size) : icoBitmap(rgba8, size),
  );
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size >= 256 ? 0 : size;
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(payloads[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += payloads[index].length;
  });
  return Buffer.concat([directory, ...payloads]);
}

const ICNS_TYPES = {
  16: ['icp4'],
  32: ['icp5', 'ic11'],
  64: ['ic12'],
  128: ['ic07'],
  256: ['ic08', 'ic13'],
  512: ['ic09', 'ic14'],
  1024: ['ic10'],
};

/** Builds a macOS .icns whose elements are PNG images (`{ size, png }`). */
export function encodeIcns(images) {
  const elements = [];
  for (const { size, png } of images) {
    for (const type of ICNS_TYPES[size] ?? []) {
      const header = Buffer.alloc(8);
      header.write(type, 0, 'ascii');
      header.writeUInt32BE(png.length + 8, 4);
      elements.push(header, png);
    }
  }
  const body = Buffer.concat(elements);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
