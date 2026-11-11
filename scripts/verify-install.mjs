#!/usr/bin/env node
// Detects a corrupted dependency install: empty `package.json` files inside
// node_modules/.pnpm. Seen once on this host after a lockfile regeneration
// (pnpm 12.18.0 wrote 0-byte manifests for freshly fetched packages).
// Fix: `pnpm install --force`.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = path.join(root, 'node_modules', '.pnpm');
const broken = [];

function scan(dir, depth) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < 4) {
      scan(full, depth + 1);
    } else if (entry.name === 'package.json' && entry.isFile()) {
      if (statSync(full).size === 0) broken.push(path.relative(root, full));
    }
  }
}

scan(store, 0);

if (broken.length > 0) {
  console.error(`Corrupted install: ${broken.length} empty package.json file(s), for example:`);
  for (const file of broken.slice(0, 5)) console.error(`  ${file}`);
  console.error('Repair with: pnpm install --force');
  process.exit(1);
}
console.log('Dependency install looks intact (no empty package manifests).');
