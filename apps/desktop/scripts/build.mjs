#!/usr/bin/env node
// Builds the desktop app into a self-contained directory:
//
//   <out>/main/main.cjs        main process   (esbuild, CommonJS, single file)
//   <out>/preload/preload.cjs  preload script (esbuild, single file, electron only)
//   <out>/renderer/**          panel.html, settings.html, probe.html + assets (Vite)
//   <out>/assets/**            generated icons
//   <out>/package.json         minimal manifest for Electron
//
// Everything is bundled: the result needs no node_modules at runtime.
//
//   node scripts/build.mjs [--mode development|production] [--out <dir>]
//
// `development` (default) keeps the test-only diagnostics hook available behind
// an environment flag; `production` compiles it out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { generateIcons } from './make-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function parseArgs(argv) {
  const options = { mode: 'development', out: path.join(root, 'dist') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') options.mode = argv[(index += 1)];
    else if (arg === '--out') options.out = path.resolve(argv[(index += 1)]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.mode !== 'development' && options.mode !== 'production') {
    throw new Error(`--mode must be development or production (got ${options.mode})`);
  }
  return options;
}

export async function buildApp({ mode = 'development', out = path.join(root, 'dist') } = {}) {
  const production = mode === 'production';
  const manifest = readManifest();
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // Electron 45 ships Node.js 24 and Chromium 156.
    target: 'node24',
    external: ['electron'],
    legalComments: 'none',
    minify: production,
    sourcemap: production ? false : 'inline',
    logLevel: 'warning',
    absWorkingDir: root,
    define: {
      // false in production: the test hook's code is removed as dead code.
      __RD_TEST_HOOK__: production ? 'false' : 'true',
      'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
    },
  };

  await esbuild({
    ...common,
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(out, 'main/main.cjs'),
  });

  await esbuild({
    ...common,
    // The sandboxed preload runs as a plain script whose `require` only knows 'electron'.
    target: 'es2022',
    entryPoints: [path.join(root, 'src/preload/preload.ts')],
    outfile: path.join(out, 'preload/preload.cjs'),
  });

  await viteBuild({
    configFile: path.join(root, 'vite.config.ts'),
    mode,
    logLevel: 'warn',
    build: { outDir: path.join(out, 'renderer'), emptyOutDir: true, minify: production },
  });

  const icons = generateIcons();
  const assets = path.join(out, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  for (const file of fs.readdirSync(icons)) {
    // The .icns is only needed by the packager, not at runtime.
    if (file.endsWith('.icns')) continue;
    fs.copyFileSync(path.join(icons, file), path.join(assets, file));
  }

  fs.writeFileSync(
    path.join(out, 'package.json'),
    `${JSON.stringify(
      {
        name: 'realtimedocs-desktop',
        productName: 'RealtimeDocs',
        version: manifest.version,
        description: manifest.description,
        main: 'main/main.cjs',
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  return { out, mode, version: manifest.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = Date.now();
  const result = await buildApp(parseArgs(process.argv.slice(2)));
  const size = (file) => `${(fs.statSync(path.join(result.out, file)).size / 1024).toFixed(1)} kB`;
  console.log(
    `Built RealtimeDocs Desktop ${result.version} (${result.mode}) in ${Date.now() - started} ms`,
  );
  console.log(
    `  ${path.relative(process.cwd(), result.out) || '.'}/main/main.cjs        ${size('main/main.cjs')}`,
  );
  console.log(
    `  ${path.relative(process.cwd(), result.out) || '.'}/preload/preload.cjs  ${size('preload/preload.cjs')}`,
  );
}
