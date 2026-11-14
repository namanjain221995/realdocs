// Bundles remote-gen.ts into one file for a machine that has only Node.js (18 or newer).
//   cd tests/load && node ../performance/src/bundle-remote.mjs <output file>
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// esbuild is a dependency of tsx; it is taken from there instead of adding a dependency.
const tsx = createRequire(path.join(here, '../../load/package.json')).resolve('tsx');
const esbuild = createRequire(tsx)('esbuild');
const outfile = process.argv[2];
if (!outfile) throw new Error('output file missing');
await esbuild.build({
  entryPoints: [path.join(here, 'remote-gen.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log(`bundled ${outfile}`);
