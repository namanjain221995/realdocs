/**
 * Loader and typed wrapper for the optional Windows diagnostics module (`display_affinity.node`,
 * source in `apps/desktop/native/win-display-affinity`).
 *
 * MAIN PROCESS ONLY. Nothing here is reachable from a renderer, and no raw window handle ever
 * leaves this file: callers pass a `BrowserWindow`, and the handle is read from
 * `getNativeWindowHandle()` here and handed straight to the module.
 *
 * Trust chain: the `.node` file lives OUTSIDE the asar (a native library cannot be loaded from
 * inside it). Its expected SHA-256 lives INSIDE the asar, in `native-manifest.json`, which Electron's
 * embedded asar integrity protects. The file is hashed and compared before it is loaded. Any failure
 * returns `null` with a reason; the app then uses Electron's own API and says so.
 *
 * Limitation: the file is hashed and then loaded by path, so a writer to the install directory could
 * swap it in between. The install directory is not writable by a standard user; this check is a
 * tamper and corruption check, not a defence against an administrator.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

export const NATIVE_MODULE_FILE = 'display_affinity.node';
export const NATIVE_MANIFEST_NAME = 'native-manifest.json';
export const DIAGNOSTICS_ABSENT_LABEL =
  'Diagnostics module not present — status from Electron only';

export const WDA_NONE = 0x0;
export const WDA_MONITOR = 0x1;
export const WDA_EXCLUDEFROMCAPTURE = 0x11;
export const ALLOWED_AFFINITIES = [WDA_NONE, WDA_MONITOR, WDA_EXCLUDEFROMCAPTURE] as const;
export type AffinityValue = (typeof ALLOWED_AFFINITIES)[number];
export type AffinityName = 'none' | 'monitor' | 'exclude_from_capture' | 'unknown';

export function affinityName(value: number): AffinityName {
  if (value === WDA_NONE) return 'none';
  if (value === WDA_MONITOR) return 'monitor';
  if (value === WDA_EXCLUDEFROMCAPTURE) return 'exclude_from_capture';
  return 'unknown';
}

export type UnavailableReason =
  | 'wrong_platform'
  | 'unsupported_arch'
  | 'file_missing'
  | 'manifest_missing'
  | 'hash_missing'
  | 'hash_mismatch'
  | 'load_error'
  | 'invalid_binding';

export interface UnavailableOutcome {
  module: null;
  reason: UnavailableReason;
  detail: string;
  /** Always {@link DIAGNOSTICS_ABSENT_LABEL}. */
  label: string;
}
export interface AvailableOutcome {
  module: DisplayAffinityDiagnostics;
  path: string;
  sha256: string;
}
export type LoadOutcome = AvailableOutcome | UnavailableOutcome;

/** What the native module returns; checked before use. */
interface RawResult {
  ok: boolean;
  affinity?: number;
  enabled?: boolean;
  error?: string;
  win32Code?: number;
}
export interface RawBinding {
  getDisplayAffinity(hwnd: Buffer): unknown;
  setDisplayAffinity(hwnd: Buffer, value: number): unknown;
  isCompositionEnabled(): unknown;
  flushComposition(): unknown;
}

export interface LoaderDeps {
  platform: string;
  arch: string;
  /** Absolute path of the directory that holds `<platform>-<arch>/display_affinity.node`. */
  moduleRoot: string;
  /** Reads the expected hash for `<platform>-<arch>/display_affinity.node`; null when not present. */
  readExpectedHash(tag: string): string | null;
  /** Synchronous file read; throws ENOENT when the file is missing. */
  readFile(file: string): Buffer;
  /** Loads the native library at `file` and returns its exports (default: `process.dlopen`). */
  loadBinding(file: string): unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Parses `native-manifest.json` text and returns the hash for one file, or null. */
export function hashFromManifest(text: string, tag: string): string | null {
  try {
    const parsed = JSON.parse(text) as { schema?: unknown; files?: Record<string, unknown> };
    if (parsed.schema !== 1 || typeof parsed.files !== 'object' || parsed.files === null)
      return null;
    const value = parsed.files[`${tag}/${NATIVE_MODULE_FILE}`];
    return typeof value === 'string' && HEX64.test(value.toLowerCase())
      ? value.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function unavailable(reason: UnavailableReason, detail: string): UnavailableOutcome {
  return { module: null, reason, detail, label: DIAGNOSTICS_ABSENT_LABEL };
}

function isBinding(value: unknown): value is RawBinding {
  if (typeof value !== 'object' || value === null) return false;
  const names = Object.keys(value).sort();
  const wanted = [
    'flushComposition',
    'getDisplayAffinity',
    'isCompositionEnabled',
    'setDisplayAffinity',
  ];
  return (
    names.length === wanted.length &&
    wanted.every(
      (name, index) =>
        names[index] === name && typeof (value as Record<string, unknown>)[name] === 'function',
    )
  );
}

export function loadDisplayAffinity(deps: LoaderDeps): LoadOutcome {
  if (deps.platform !== 'win32') {
    return unavailable('wrong_platform', `the module is Windows-only (platform: ${deps.platform})`);
  }
  if (deps.arch !== 'x64' && deps.arch !== 'arm64') {
    return unavailable('unsupported_arch', `no module for ${deps.arch}`);
  }
  const tag = `${deps.platform}-${deps.arch}`;
  const file = path.join(deps.moduleRoot, tag, NATIVE_MODULE_FILE);
  let bytes: Buffer;
  try {
    bytes = deps.readFile(file);
  } catch (error) {
    return unavailable('file_missing', `cannot read ${file}: ${(error as Error).message}`);
  }
  const expected = deps.readExpectedHash(tag);
  if (expected === null) {
    return unavailable('hash_missing', 'no expected hash is shipped for this module');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected.toLowerCase()) {
    return unavailable('hash_mismatch', 'the module file does not match its shipped SHA-256');
  }
  let exports: unknown;
  try {
    exports = deps.loadBinding(file);
  } catch (error) {
    return unavailable('load_error', (error as Error).message);
  }
  if (!isBinding(exports)) {
    return unavailable(
      'invalid_binding',
      'the module does not export exactly the four expected functions',
    );
  }
  return { module: new DisplayAffinityDiagnostics(exports), path: file, sha256: actual };
}

// ── Typed wrapper ──────────────────────────────────────────────────────────────────────────────

/** The part of Electron's `BrowserWindow` used here. */
export interface WindowLike {
  getNativeWindowHandle(): Buffer;
  isDestroyed(): boolean;
}

export type NativeErrorCode =
  | 'window_destroyed'
  | 'invalid_affinity'
  | 'invalid_argument'
  | 'invalid_handle_size'
  | 'not_a_window'
  | 'not_own_window'
  | 'not_top_level'
  | 'win32_error'
  | 'native_threw'
  | 'invalid_native_result';

export interface NativeFailure {
  ok: false;
  error: NativeErrorCode;
  win32Code?: number;
}
export type AffinityReading = { ok: true; affinity: number; name: AffinityName } | NativeFailure;
export type SimpleResult = { ok: true } | NativeFailure;
export type CompositionReading = { ok: true; enabled: boolean } | NativeFailure;

const KNOWN_ERRORS: readonly NativeErrorCode[] = [
  'invalid_affinity',
  'invalid_argument',
  'invalid_handle_size',
  'not_a_window',
  'not_own_window',
  'not_top_level',
  'win32_error',
];

function failure(raw: RawResult): NativeFailure {
  const error = KNOWN_ERRORS.find((code) => code === raw.error) ?? 'invalid_native_result';
  const result: NativeFailure = { ok: false, error };
  if (typeof raw.win32Code === 'number') result.win32Code = raw.win32Code;
  return result;
}

function asRaw(value: unknown): RawResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as RawResult;
  return typeof raw.ok === 'boolean' ? raw : null;
}

export class DisplayAffinityDiagnostics {
  constructor(private readonly binding: RawBinding) {}

  getAffinity(window: WindowLike): AffinityReading {
    return this.call(window, (hwnd) => {
      const raw = asRaw(this.binding.getDisplayAffinity(hwnd));
      if (!raw) return { ok: false, error: 'invalid_native_result' };
      if (!raw.ok) return failure(raw);
      if (typeof raw.affinity !== 'number') return { ok: false, error: 'invalid_native_result' };
      return { ok: true, affinity: raw.affinity, name: affinityName(raw.affinity) };
    });
  }

  /** Only WDA_NONE (0), WDA_MONITOR (1) and WDA_EXCLUDEFROMCAPTURE (0x11) are accepted. */
  setAffinity(window: WindowLike, value: number): SimpleResult {
    if (!(ALLOWED_AFFINITIES as readonly number[]).includes(value)) {
      return { ok: false, error: 'invalid_affinity' };
    }
    return this.call(window, (hwnd) => {
      const raw = asRaw(this.binding.setDisplayAffinity(hwnd, value));
      if (!raw) return { ok: false, error: 'invalid_native_result' };
      return raw.ok ? { ok: true } : failure(raw);
    });
  }

  isCompositionEnabled(): CompositionReading {
    try {
      const raw = asRaw(this.binding.isCompositionEnabled());
      if (!raw) return { ok: false, error: 'invalid_native_result' };
      if (!raw.ok) return failure(raw);
      if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'invalid_native_result' };
      return { ok: true, enabled: raw.enabled };
    } catch {
      return { ok: false, error: 'native_threw' };
    }
  }

  /** Waits for the next desktop composition (about one display refresh). Blocks the main thread briefly. */
  waitOneCompositionCycle(): SimpleResult {
    try {
      const raw = asRaw(this.binding.flushComposition());
      if (!raw) return { ok: false, error: 'invalid_native_result' };
      return raw.ok ? { ok: true } : failure(raw);
    } catch {
      return { ok: false, error: 'native_threw' };
    }
  }

  private call<T extends { ok: boolean }>(
    window: WindowLike,
    run: (hwnd: Buffer) => T | NativeFailure,
  ): T | NativeFailure {
    try {
      if (window.isDestroyed()) return { ok: false, error: 'window_destroyed' };
      return run(window.getNativeWindowHandle());
    } catch {
      return { ok: false, error: 'native_threw' };
    }
  }
}

// ── Production wiring ──────────────────────────────────────────────────────────────────────────

export interface RuntimePaths {
  isPackaged: boolean;
  /** `process.resourcesPath` (packaged). */
  resourcesPath: string;
  /** `app.getAppPath()`: inside `app.asar` when packaged. */
  appPath: string;
  /** Development only: `apps/desktop/native/dist`, where `scripts/build-native.mjs` writes. */
  devNativeDir: string;
}

/**
 * Production dependencies. Packaged: `.node` under `<resources>/native/<platform>-<arch>/`, hash
 * from `native-manifest.json` inside the asar. Development: both from `devNativeDir`
 * (`<tag>/display_affinity.node` and `<tag>/display_affinity.node.sha256`, written by the build script).
 */
export function productionDeps(
  paths: RuntimePaths,
  io: {
    readFile(file: string): Buffer;
    readText(file: string): string;
    platform?: string;
    arch?: string;
    dlopen?: (module: { exports: unknown }, file: string) => void;
  },
): LoaderDeps {
  const dlopen = io.dlopen ?? ((module, file) => process.dlopen(module as NodeJS.Module, file));
  return {
    platform: io.platform ?? process.platform,
    arch: io.arch ?? process.arch,
    moduleRoot: paths.isPackaged ? path.join(paths.resourcesPath, 'native') : paths.devNativeDir,
    readFile: io.readFile,
    readExpectedHash(tag) {
      try {
        if (paths.isPackaged) {
          return hashFromManifest(io.readText(path.join(paths.appPath, NATIVE_MANIFEST_NAME)), tag);
        }
        const text = (
          io
            .readText(path.join(paths.devNativeDir, tag, `${NATIVE_MODULE_FILE}.sha256`))
            .trim()
            .split(/\s+/)[0] ?? ''
        ).toLowerCase();
        return HEX64.test(text) ? text : null;
      } catch {
        return null;
      }
    },
    loadBinding(file) {
      const holder: { exports: unknown } = { exports: {} };
      dlopen(holder, file);
      return holder.exports;
    },
  };
}
