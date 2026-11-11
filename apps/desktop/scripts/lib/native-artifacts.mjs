// Which native files go into a packaged build, and the hash manifest that goes INSIDE the asar.
//
//   collectNativeArtifacts({ platform, arch }) ->
//     {
//       status: 'not_applicable' | 'included' | 'not_built',
//       reason: string,
//       files: [{ from, to }],      // copy `from` to `<resources>/<to>` (OUTSIDE app.asar)
//       hashFile: null | { name, contents }  // write `contents` to `<staged app>/<name>` (INSIDE app.asar)
//     }
//
// `to` is relative to the app's `resources` directory, e.g. `native/win32-x64/display_affinity.node`.
// The manifest is computed from the actual file bytes, so it always matches what ships. For a
// Windows target whose module was not built (it can only be built on Windows) the status is
// `not_built` with no files: the app then reports "Diagnostics module not present" at run time.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_MODULE_FILE = 'display_affinity.node';
export const NATIVE_MANIFEST_NAME = 'native-manifest.json';
export const NATIVE_ARCHES = ['x64', 'arm64'];

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIST_DIR = path.resolve(here, '../../native/dist');

export function nativeTag(platform, arch) {
  return `${platform}-${arch}`;
}

export function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function collectNativeArtifacts({
  platform,
  arch,
  distDir = DEFAULT_DIST_DIR,
  readFile = (file) => fs.readFileSync(file),
} = {}) {
  const none = (status, reason) => ({ status, reason, files: [], hashFile: null });
  if (platform !== 'win32') return none('not_applicable', `no native module for ${platform}`);
  if (!NATIVE_ARCHES.includes(arch)) {
    return none('not_applicable', `no native module for architecture ${arch}`);
  }
  const tag = nativeTag(platform, arch);
  const from = path.join(distDir, tag, NATIVE_MODULE_FILE);
  let bytes;
  try {
    bytes = readFile(from);
  } catch {
    return none(
      'not_built',
      `${from} does not exist; build it on Windows with "node scripts/build-native.mjs --arch ${arch}"`,
    );
  }
  const sha256 = sha256Of(bytes);
  try {
    const recorded = String(readFile(`${from}.sha256`))
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase();
    if (recorded && recorded !== sha256) {
      throw new Error(
        `${from} does not match its .sha256 file (file ${sha256}, recorded ${recorded}); rebuild it`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not match')) throw error;
    // No .sha256 file next to it: the manifest below is computed from the bytes anyway.
  }
  const manifest = {
    schema: 1,
    files: { [`${tag}/${NATIVE_MODULE_FILE}`]: sha256 },
  };
  return {
    status: 'included',
    reason: `${tag}/${NATIVE_MODULE_FILE} sha256 ${sha256}`,
    files: [{ from, to: `native/${tag}/${NATIVE_MODULE_FILE}` }],
    hashFile: { name: NATIVE_MANIFEST_NAME, contents: `${JSON.stringify(manifest, null, 2)}\n` },
  };
}
