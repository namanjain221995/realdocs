#!/usr/bin/env node
// Generates every icon the desktop app needs from code (original artwork, no
// external assets, no native tools):
//
//   build/icons/icon.png, icon.ico, icon.icns        application icon
//   build/icons/tray.png / tray-active.png           Linux tray
//   build/icons/tray.ico / tray-active.ico           Windows notification area
//   build/icons/tray[Active]Template.png (+ @2x)     macOS menu bar (template images)
//
// The motif is a floating note panel: a dark rounded tile, a translucent panel
// with three text lines and a small "live" dot. The "active" tray variants mark
// click-through mode.
//
// The .icns is assembled here from PNG elements. It has not been validated
// with Apple's `iconutil` on this host; see docs/notes/desktop.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  circle,
  createCanvas,
  encodeIcns,
  encodeIco,
  encodePng,
  fillShape,
  rgba,
  roundedRect,
  solid,
  strokeInside,
  toRgba8,
  verticalGradient,
} from './lib/raster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ICON_DIRECTORY = path.join(root, 'build', 'icons');

const ACCENT = '#4fd6a5';
const WHITE = '#ffffff';

/** Full-colour application icon. `active` swaps the tile for the accent colour. */
function drawAppIcon(size, { active = false, padding = 0.08 } = {}) {
  const canvas = createCanvas(size);
  const inset = size * padding;
  const tile = size - inset * 2;
  const tileShape = roundedRect(inset, inset, tile, tile, tile * 0.225);
  fillShape(
    canvas,
    tileShape,
    active
      ? verticalGradient(rgba('#1f8f6c'), rgba('#115943'), inset, inset + tile)
      : verticalGradient(rgba('#232a3d'), rgba('#10131c'), inset, inset + tile),
  );
  if (size >= 48) {
    fillShape(canvas, strokeInside(tileShape, Math.max(1, size * 0.008)), solid(rgba(WHITE, 0.1)));
  }

  // A window behind the panel: the panel floats over other work.
  if (size >= 64) {
    const back = roundedRect(
      inset + tile * 0.13,
      inset + tile * 0.17,
      tile * 0.56,
      tile * 0.42,
      tile * 0.05,
    );
    fillShape(canvas, strokeInside(back, Math.max(1, size * 0.012)), solid(rgba(WHITE, 0.16)));
  }

  // The floating panel.
  const panelX = inset + tile * (size >= 64 ? 0.24 : 0.16);
  const panelY = inset + tile * (size >= 64 ? 0.33 : 0.24);
  const panelWidth = tile * (size >= 64 ? 0.62 : 0.68);
  const panelHeight = tile * (size >= 64 ? 0.44 : 0.52);
  const panel = roundedRect(panelX, panelY, panelWidth, panelHeight, tile * 0.065);
  fillShape(canvas, panel, solid(rgba(active ? '#0b2e24' : '#2f3850', size >= 64 ? 0.92 : 1)));
  fillShape(
    canvas,
    strokeInside(panel, Math.max(1, size * 0.014)),
    solid(rgba(WHITE, size >= 64 ? 0.42 : 0.55)),
  );

  // Text lines.
  const lineHeight = Math.max(1.2, panelHeight * (size >= 64 ? 0.11 : 0.16));
  const left = panelX + panelWidth * 0.14;
  const available = panelWidth * 0.72;
  const rows =
    size >= 64
      ? [
          [0.34, 0.62, 0.95],
          [0.55, 1, 0.72],
          [0.76, 0.48, 0.5],
        ]
      : [
          [0.4, 0.62, 0.95],
          [0.7, 1, 0.7],
        ];
  for (const [at, width, alpha] of rows) {
    fillShape(
      canvas,
      roundedRect(
        left,
        panelY + panelHeight * at - lineHeight / 2,
        available * width,
        lineHeight,
        lineHeight / 2,
      ),
      solid(rgba(WHITE, alpha)),
    );
  }

  // Live dot.
  if (size >= 32) {
    const radius = Math.max(1.6, tile * 0.045);
    fillShape(
      canvas,
      circle(panelX + panelWidth * 0.84, panelY + panelHeight * (size >= 64 ? 0.17 : 0.2), radius),
      solid(rgba(active ? WHITE : ACCENT)),
    );
  }
  return toRgba8(canvas);
}

/**
 * macOS menu-bar template: black + alpha only. Outline panel with two lines;
 * the active (click-through) variant is filled, with the lines knocked out by
 * drawing them in a lower alpha.
 */
function drawTemplate(size, active) {
  const canvas = createCanvas(size);
  const black = (alpha) => solid([0, 0, 0, alpha]);
  const margin = size * 0.1;
  const width = size - margin * 2;
  const height = size * 0.66;
  const top = (size - height) / 2;
  const panel = roundedRect(margin, top, width, height, size * 0.17);
  const lineHeight = Math.max(1, size * 0.085);
  const lines = [
    [0.36, 0.56],
    [0.64, 0.36],
  ];
  if (active) {
    fillShape(canvas, panel, black(1));
    // Knock the lines out of the filled shape.
    const copy = canvas.data;
    const hole = createCanvas(size);
    for (const [at, lineWidth] of lines) {
      fillShape(
        hole,
        roundedRect(
          margin + width * 0.2,
          top + height * at - lineHeight / 2,
          width * lineWidth,
          lineHeight,
          lineHeight / 2,
        ),
        black(1),
      );
    }
    for (let index = 3; index < copy.length; index += 4) {
      copy[index] = Math.max(0, copy[index] - hole.data[index] * 0.85);
    }
  } else {
    fillShape(canvas, strokeInside(panel, Math.max(1, size * 0.09)), black(1));
    for (const [at, lineWidth] of lines) {
      fillShape(
        canvas,
        roundedRect(
          margin + width * 0.2,
          top + height * at - lineHeight / 2,
          width * lineWidth,
          lineHeight,
          lineHeight / 2,
        ),
        black(0.9),
      );
    }
  }
  return toRgba8(canvas);
}

export function generateIcons(directory = ICON_DIRECTORY) {
  fs.mkdirSync(directory, { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(directory, name), data);

  // Application icon.
  const pngSizes = [16, 32, 64, 128, 256, 512, 1024];
  const pngs = new Map(
    pngSizes.map((size) => [size, encodePng(drawAppIcon(size, { padding: 0.09 }), size)]),
  );
  write('icon.png', pngs.get(512));
  write('icon.icns', encodeIcns(pngSizes.map((size) => ({ size, png: pngs.get(size) }))));
  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  write(
    'icon.ico',
    encodeIco(icoSizes.map((size) => ({ size, rgba8: drawAppIcon(size, { padding: 0.04 }) }))),
  );

  // Tray: Windows (.ico) and Linux (.png). Little padding so the glyph stays legible at 16px.
  const traySizes = [16, 20, 24, 32, 48];
  for (const [name, active] of [
    ['tray', false],
    ['tray-active', true],
  ]) {
    write(
      `${name}.ico`,
      encodeIco(
        traySizes.map((size) => ({ size, rgba8: drawAppIcon(size, { active, padding: 0.02 }) })),
      ),
    );
    write(`${name}.png`, encodePng(drawAppIcon(32, { active, padding: 0.02 }), 32));
  }

  // macOS menu bar: 16pt at 72 dpi and its 32px @2x companion at 144 dpi.
  for (const [name, active] of [
    ['trayTemplate', false],
    ['trayActiveTemplate', true],
  ]) {
    write(`${name}.png`, encodePng(drawTemplate(16, active), 16, 72));
    write(`${name}@2x.png`, encodePng(drawTemplate(32, active), 32, 144));
  }
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = generateIcons();
  const files = fs.readdirSync(directory).sort();
  console.log(`Icons written to ${path.relative(process.cwd(), directory)}:`);
  for (const file of files) {
    console.log(`  ${file.padEnd(30)} ${fs.statSync(path.join(directory, file)).size} bytes`);
  }
}
