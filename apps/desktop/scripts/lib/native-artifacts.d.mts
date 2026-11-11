export const NATIVE_MODULE_FILE: string;
export const NATIVE_MANIFEST_NAME: string;
export const NATIVE_ARCHES: readonly string[];
export const DEFAULT_DIST_DIR: string;
export function nativeTag(platform: string, arch: string): string;
export function sha256Of(bytes: Uint8Array | string): string;

export interface NativeArtifacts {
  status: 'not_applicable' | 'included' | 'not_built';
  reason: string;
  /** Copy `from` to `<resources>/<to>` (outside app.asar). */
  files: Array<{ from: string; to: string }>;
  /** Write `contents` to `<staged app>/<name>` (inside app.asar). */
  hashFile: { name: string; contents: string } | null;
}

export function collectNativeArtifacts(options?: {
  platform?: string;
  arch?: string;
  distDir?: string;
  readFile?: (file: string) => Uint8Array | string;
}): NativeArtifacts;
