import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTICS_ABSENT_LABEL,
  DisplayAffinityDiagnostics,
  NATIVE_MANIFEST_NAME,
  WDA_EXCLUDEFROMCAPTURE,
  WDA_MONITOR,
  WDA_NONE,
  hashFromManifest,
  loadDisplayAffinity,
  productionDeps,
  type LoaderDeps,
  type RawBinding,
  type WindowLike,
} from '../../src/main/native/display-affinity';

const FILE_BYTES = Buffer.from('pretend native library');
const GOOD_HASH = createHash('sha256').update(FILE_BYTES).digest('hex');

function binding(overrides: Partial<RawBinding> = {}): RawBinding {
  return {
    getDisplayAffinity: vi.fn(() => ({ ok: true, affinity: WDA_EXCLUDEFROMCAPTURE })),
    setDisplayAffinity: vi.fn(() => ({ ok: true })),
    isCompositionEnabled: vi.fn(() => ({ ok: true, enabled: true })),
    flushComposition: vi.fn(() => ({ ok: true })),
    ...overrides,
  };
}

function deps(overrides: Partial<LoaderDeps> = {}, raw: unknown = binding()): LoaderDeps {
  return {
    platform: 'win32',
    arch: 'x64',
    moduleRoot: path.join('C:', 'app', 'resources', 'native'),
    readExpectedHash: () => GOOD_HASH,
    readFile: () => FILE_BYTES,
    loadBinding: () => raw,
    ...overrides,
  };
}

function windowLike(destroyed = false): WindowLike & { handle: Buffer } {
  const handle = Buffer.alloc(8, 1);
  return { handle, getNativeWindowHandle: () => handle, isDestroyed: () => destroyed };
}

function module(raw: RawBinding = binding()): DisplayAffinityDiagnostics {
  const outcome = loadDisplayAffinity(deps({}, raw));
  if (!outcome.module) throw new Error(outcome.detail);
  return outcome.module;
}

describe('native loader: refusals return null with a reason', () => {
  it.each(['linux', 'darwin'])('does not load on %s', (platform) => {
    const loadBinding = vi.fn();
    const outcome = loadDisplayAffinity(deps({ platform, loadBinding }));
    expect(outcome).toMatchObject({ module: null, reason: 'wrong_platform' });
    expect(loadBinding).not.toHaveBeenCalled();
  });

  it('rejects an unsupported architecture', () => {
    expect(loadDisplayAffinity(deps({ arch: 'ia32' }))).toMatchObject({
      reason: 'unsupported_arch',
    });
  });

  it('reports a missing file', () => {
    const outcome = loadDisplayAffinity(
      deps({
        readFile: () => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      }),
    );
    expect(outcome).toMatchObject({
      module: null,
      reason: 'file_missing',
      label: DIAGNOSTICS_ABSENT_LABEL,
    });
  });

  it('refuses a file whose hash differs, without loading it', () => {
    const loadBinding = vi.fn();
    const outcome = loadDisplayAffinity(
      deps({ readExpectedHash: () => 'a'.repeat(64), loadBinding }),
    );
    expect(outcome).toMatchObject({ module: null, reason: 'hash_mismatch' });
    expect(loadBinding).not.toHaveBeenCalled();
  });

  it('refuses to load when no expected hash is shipped', () => {
    const loadBinding = vi.fn();
    expect(loadDisplayAffinity(deps({ readExpectedHash: () => null, loadBinding }))).toMatchObject({
      reason: 'hash_missing',
    });
    expect(loadBinding).not.toHaveBeenCalled();
  });

  it('reports a load error', () => {
    const outcome = loadDisplayAffinity(
      deps({
        loadBinding: () => {
          throw new Error('not a valid Win32 application');
        },
      }),
    );
    expect(outcome).toMatchObject({
      module: null,
      reason: 'load_error',
      detail: 'not a valid Win32 application',
    });
  });

  it('refuses a binding that does not export exactly the four functions', () => {
    for (const raw of [
      {},
      { ...binding(), extra: () => undefined },
      { getDisplayAffinity: 1 },
      null,
    ]) {
      expect(loadDisplayAffinity(deps({}, raw))).toMatchObject({ reason: 'invalid_binding' });
    }
  });

  it('loads and reports the verified hash when everything agrees', () => {
    const outcome = loadDisplayAffinity(deps());
    expect(outcome.module).toBeInstanceOf(DisplayAffinityDiagnostics);
    if (outcome.module) {
      expect(outcome.sha256).toBe(GOOD_HASH);
      expect(outcome.path).toBe(
        path.join('C:', 'app', 'resources', 'native', 'win32-x64', 'display_affinity.node'),
      );
    }
  });
});

describe('native loader: manifest and production wiring', () => {
  const manifest = JSON.stringify({
    schema: 1,
    files: { 'win32-x64/display_affinity.node': GOOD_HASH.toUpperCase() },
  });

  it('reads one hash from the manifest and ignores anything malformed', () => {
    expect(hashFromManifest(manifest, 'win32-x64')).toBe(GOOD_HASH);
    expect(hashFromManifest(manifest, 'win32-arm64')).toBeNull();
    expect(hashFromManifest('{', 'win32-x64')).toBeNull();
    expect(hashFromManifest(JSON.stringify({ schema: 2, files: {} }), 'win32-x64')).toBeNull();
    expect(
      hashFromManifest(
        JSON.stringify({ schema: 1, files: { 'win32-x64/display_affinity.node': 'zz' } }),
        'win32-x64',
      ),
    ).toBeNull();
  });

  it('packaged: file under resources/native, hash from the manifest inside the asar', () => {
    const reads: string[] = [];
    const production = productionDeps(
      { isPackaged: true, resourcesPath: '/r', appPath: '/r/app.asar', devNativeDir: '/dev' },
      {
        platform: 'win32',
        arch: 'x64',
        readFile: (file) => (reads.push(file), FILE_BYTES),
        readText: (file) => (reads.push(file), manifest),
      },
    );
    expect(production.moduleRoot).toBe(path.join('/r', 'native'));
    expect(production.readExpectedHash('win32-x64')).toBe(GOOD_HASH);
    expect(reads).toEqual([path.join('/r/app.asar', NATIVE_MANIFEST_NAME)]);
  });

  it('development: file and .sha256 under the build output directory', () => {
    const production = productionDeps(
      { isPackaged: false, resourcesPath: '/r', appPath: '/app', devNativeDir: '/dev/native/dist' },
      {
        platform: 'win32',
        arch: 'arm64',
        readFile: () => FILE_BYTES,
        readText: (file) => {
          expect(file).toBe(
            path.join('/dev/native/dist', 'win32-arm64', 'display_affinity.node.sha256'),
          );
          return `${GOOD_HASH}  display_affinity.node\n`;
        },
      },
    );
    expect(production.moduleRoot).toBe('/dev/native/dist');
    expect(production.readExpectedHash('win32-arm64')).toBe(GOOD_HASH);
  });

  it('a missing hash source gives null, not an exception', () => {
    const production = productionDeps(
      { isPackaged: true, resourcesPath: '/r', appPath: '/r/app.asar', devNativeDir: '/d' },
      {
        readFile: () => FILE_BYTES,
        readText: () => {
          throw new Error('ENOENT');
        },
      },
    );
    expect(production.readExpectedHash('win32-x64')).toBeNull();
  });

  it('dlopens through the injected function and returns its exports', () => {
    const production = productionDeps(
      { isPackaged: true, resourcesPath: '/r', appPath: '/a', devNativeDir: '/d' },
      {
        readFile: () => FILE_BYTES,
        readText: () => manifest,
        dlopen: (holder, file) => {
          holder.exports = { loadedFrom: file };
        },
      },
    );
    expect(production.loadBinding('/x.node')).toEqual({ loadedFrom: '/x.node' });
  });
});

describe('native wrapper: result mapping', () => {
  it('maps a successful read and names the affinity', () => {
    const win = windowLike();
    const raw = binding();
    expect(module(raw).getAffinity(win)).toEqual({
      ok: true,
      affinity: 0x11,
      name: 'exclude_from_capture',
    });
    expect(raw.getDisplayAffinity).toHaveBeenCalledWith(win.handle);
    for (const [value, name] of [
      [0, 'none'],
      [1, 'monitor'],
      [7, 'unknown'],
    ] as const) {
      const m = module(binding({ getDisplayAffinity: () => ({ ok: true, affinity: value }) }));
      expect(m.getAffinity(win)).toMatchObject({ ok: true, name });
    }
  });

  it('maps a Windows failure with its code', () => {
    const m = module(
      binding({ getDisplayAffinity: () => ({ ok: false, error: 'win32_error', win32Code: 5 }) }),
    );
    expect(m.getAffinity(windowLike())).toEqual({ ok: false, error: 'win32_error', win32Code: 5 });
  });

  it('maps composition and flush results', () => {
    expect(module().isCompositionEnabled()).toEqual({ ok: true, enabled: true });
    expect(module().waitOneCompositionCycle()).toEqual({ ok: true });
    const failing = module(
      binding({
        isCompositionEnabled: () => ({ ok: false, error: 'win32_error', win32Code: 1 }),
        flushComposition: () => ({ ok: false, error: 'win32_error', win32Code: 2 }),
      }),
    );
    expect(failing.isCompositionEnabled()).toMatchObject({ ok: false, win32Code: 1 });
    expect(failing.waitOneCompositionCycle()).toMatchObject({ ok: false, win32Code: 2 });
  });

  it('treats malformed or throwing native results as failures, never as success', () => {
    const win = windowLike();
    const bad = module(
      binding({
        getDisplayAffinity: () => ({ ok: true }),
        isCompositionEnabled: () => 'yes',
        flushComposition: () => {
          throw new Error('boom');
        },
        setDisplayAffinity: () => ({ ok: false, error: 'made-up' }),
      }),
    );
    expect(bad.getAffinity(win)).toEqual({ ok: false, error: 'invalid_native_result' });
    expect(bad.isCompositionEnabled()).toEqual({ ok: false, error: 'invalid_native_result' });
    expect(bad.waitOneCompositionCycle()).toEqual({ ok: false, error: 'native_threw' });
    expect(bad.setAffinity(win, WDA_NONE)).toEqual({ ok: false, error: 'invalid_native_result' });
  });

  it('does not touch a destroyed window', () => {
    const raw = binding();
    expect(module(raw).getAffinity(windowLike(true))).toEqual({
      ok: false,
      error: 'window_destroyed',
    });
    expect(raw.getDisplayAffinity).not.toHaveBeenCalled();
  });
});

describe('native wrapper: own-window rule and affinity values', () => {
  it('passes the module the window handle only, and surfaces its own-window refusal', () => {
    const raw = binding({
      getDisplayAffinity: () => ({ ok: false, error: 'not_own_window' }),
      setDisplayAffinity: () => ({ ok: false, error: 'not_own_window' }),
    });
    const m = module(raw);
    expect(m.getAffinity(windowLike())).toEqual({ ok: false, error: 'not_own_window' });
    expect(m.setAffinity(windowLike(), WDA_MONITOR)).toEqual({
      ok: false,
      error: 'not_own_window',
    });
  });

  it('surfaces the other in-addon refusals', () => {
    for (const error of ['not_a_window', 'not_top_level', 'invalid_handle_size'] as const) {
      const m = module(binding({ getDisplayAffinity: () => ({ ok: false, error }) }));
      expect(m.getAffinity(windowLike())).toEqual({ ok: false, error });
    }
  });

  it('accepts only WDA_NONE, WDA_MONITOR and WDA_EXCLUDEFROMCAPTURE', () => {
    const raw = binding();
    const m = module(raw);
    for (const value of [WDA_NONE, WDA_MONITOR, WDA_EXCLUDEFROMCAPTURE]) {
      expect(m.setAffinity(windowLike(), value)).toEqual({ ok: true });
    }
    expect(raw.setDisplayAffinity).toHaveBeenCalledTimes(3);
    for (const value of [2, 0x10, 0x12, -1, 0.5, 256, Number.NaN, Infinity]) {
      expect(m.setAffinity(windowLike(), value)).toEqual({ ok: false, error: 'invalid_affinity' });
    }
    expect(raw.setDisplayAffinity).toHaveBeenCalledTimes(3);
  });
});
