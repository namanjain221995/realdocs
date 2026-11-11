#!/usr/bin/env node
// Generates apps/server/assets/realtimedocs-demo.png: a 960×540 illustration of
// a document shared between a browser window and a floating desktop panel.
// Drawn from primitive shapes with no external input, so the committed asset
// is self-contained, reproducible and contains no third-party material.
//
//   node apps/server/scripts/generate-demo-image.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const WIDTH = 960;
const HEIGHT = 540;
const pixels = new Uint8Array(WIDTH * HEIGHT * 3);

function hex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

/** Blends `color` over the pixel with the given opacity (0–1). */
function plot(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 3;
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round(
      pixels[index + channel] * (1 - alpha) + color[channel] * alpha,
    );
  }
}

function roundedRect(x, y, width, height, radius, color, alpha = 1) {
  const rgb = hex(color);
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const dx = Math.max(x + radius - px, 0, px - (x + width - 1 - radius));
      const dy = Math.max(y + radius - py, 0, py - (y + height - 1 - radius));
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius - 0.5) plot(px, py, rgb, alpha);
      else if (distance < radius + 0.5) plot(px, py, rgb, alpha * (radius + 0.5 - distance));
    }
  }
}

function circle(cx, cy, radius, color, alpha = 1) {
  const rgb = hex(color);
  for (let py = Math.floor(cy - radius - 1); py <= cy + radius + 1; py += 1) {
    for (let px = Math.floor(cx - radius - 1); px <= cx + radius + 1; px += 1) {
      const distance = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (distance <= radius - 0.5) plot(px, py, rgb, alpha);
      else if (distance < radius + 0.5) plot(px, py, rgb, alpha * (radius + 0.5 - distance));
    }
  }
}

function line(x0, y0, x1, y1, thickness, color, alpha = 1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, color, alpha);
  }
}

// Background: a soft vertical gradient.
const top = hex('#0f172a');
const bottom = hex('#1e293b');
for (let y = 0; y < HEIGHT; y += 1) {
  const t = y / (HEIGHT - 1);
  const row = top.map((value, channel) => Math.round(value + (bottom[channel] - value) * t));
  for (let x = 0; x < WIDTH; x += 1) plot(x, y, row);
}
circle(820, 90, 180, '#2563eb', 0.12);
circle(120, 470, 200, '#7c3aed', 0.1);

// Browser window with a document.
roundedRect(70, 60, 600, 410, 14, '#020617', 0.35); // shadow
roundedRect(60, 50, 600, 410, 14, '#f8fafc');
roundedRect(60, 50, 600, 44, 14, '#e2e8f0');
roundedRect(60, 80, 600, 14, 0, '#e2e8f0');
circle(84, 72, 6, '#ef4444');
circle(104, 72, 6, '#f59e0b');
circle(124, 72, 6, '#22c55e');
roundedRect(160, 61, 380, 22, 11, '#ffffff');

// Document content: heading, paragraphs, a table and a highlighted line.
roundedRect(100, 122, 300, 18, 5, '#0f172a');
for (const [y, width] of [
  [160, 520],
  [180, 480],
  [200, 500],
]) {
  roundedRect(100, y, width, 9, 4, '#94a3b8');
}
roundedRect(100, 228, 250, 12, 5, '#fde68a');
roundedRect(100, 262, 520, 120, 8, '#e2e8f0');
roundedRect(102, 264, 516, 28, 6, '#cbd5e1');
for (const y of [292, 322, 352]) roundedRect(102, y, 516, 1, 0, '#cbd5e1');
for (const x of [274, 446]) roundedRect(x, 264, 1, 116, 0, '#cbd5e1');
for (const row of [272, 302, 332, 360]) {
  for (const column of [114, 286, 458]) {
    roundedRect(column, row, row === 272 ? 90 : 120, 8, 4, row === 272 ? '#475569' : '#94a3b8');
  }
}
roundedRect(100, 404, 440, 9, 4, '#94a3b8');
roundedRect(100, 424, 360, 9, 4, '#94a3b8');
// A collaborator's cursor.
roundedRect(402, 120, 3, 22, 1, '#db2777');
roundedRect(402, 108, 54, 14, 4, '#db2777');

// Floating desktop panel: dark, translucent, same content.
roundedRect(556, 246, 360, 250, 18, '#020617', 0.4); // shadow
roundedRect(546, 236, 360, 250, 18, '#0b1220', 0.92);
roundedRect(546, 236, 360, 250, 18, '#38bdf8', 0.06);
roundedRect(566, 254, 150, 12, 5, '#e2e8f0');
circle(872, 260, 5, '#22c55e');
roundedRect(796, 255, 60, 10, 5, '#334155');
for (const [y, width] of [
  [290, 310],
  [310, 280],
  [330, 296],
]) {
  roundedRect(566, y, width, 8, 4, '#64748b');
}
roundedRect(566, 356, 170, 10, 5, '#fde68a', 0.9);
roundedRect(566, 384, 320, 76, 8, '#111c30');
for (const [y, width, color] of [
  [398, 180, '#38bdf8'],
  [416, 240, '#a5b4fc'],
  [434, 140, '#86efac'],
]) {
  roundedRect(582, y, width, 8, 4, color);
}

// Link between the two: live updates.
line(480, 232, 560, 300, 3, '#38bdf8', 0.9);
circle(480, 232, 7, '#38bdf8');
circle(560, 300, 7, '#38bdf8');

// ── PNG encoding (8-bit RGB, no interlace) ────────────────────────────────
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // colour type: truecolour
const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const offset = y * (WIDTH * 3 + 1);
  raw[offset] = 0; // filter: none
  raw.set(pixels.subarray(y * WIDTH * 3, (y + 1) * WIDTH * 3), offset + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../assets/realtimedocs-demo.png',
);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, png);
console.log(`Wrote ${target} (${WIDTH}×${HEIGHT}, ${png.length} bytes)`);
