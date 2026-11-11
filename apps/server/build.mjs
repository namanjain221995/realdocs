#!/usr/bin/env node
// Bundles the server and the CLI into dist/ (ESM, Node 24). Everything is
// bundled — workspace packages and node_modules — so the runtime image needs
// only dist/, migrations/ and assets/.
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'dist');
rmSync(outdir, { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { main: 'src/main.ts', cli: 'src/cli.ts' },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  // Optional native accelerators that are loaded inside try/catch.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  banner: {
    // CommonJS dependencies inside an ESM bundle still call require() and
    // read __dirname/__filename.
    js: [
      "import { createRequire as __rdCreateRequire } from 'node:module';",
      "import { fileURLToPath as __rdFileURLToPath } from 'node:url';",
      "import { dirname as __rdDirname } from 'node:path';",
      'const require = __rdCreateRequire(import.meta.url);',
      'const __filename = __rdFileURLToPath(import.meta.url);',
      'const __dirname = __rdDirname(__filename);',
    ].join('\n'),
  },
});

// Guard against two copies of Yjs ending up in the bundle (breaks instanceof checks).
const yjsEntries = Object.keys(result.metafile.inputs).filter((input) =>
  /node_modules\/yjs\/dist\/yjs\.(mjs|cjs)$/.test(input),
);
if (yjsEntries.length !== 1) {
  console.error(
    `Expected exactly one bundled copy of yjs, found ${yjsEntries.length}:`,
    yjsEntries,
  );
  process.exit(1);
}

writeFileSync(
  path.join(outdir, 'package.json'),
  `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
);
