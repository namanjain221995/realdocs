import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesStore } from '../../src/main/preferences-store';
import { PANEL } from '../../src/shared/geometry';
import {
  ALPHA_RANGE,
  FONT_SCALE_RANGE,
  PREFERENCES_VERSION,
  applyPreferencePatch,
  cleanText,
  defaultPreferences,
  sanitizePreferences,
} from '../../src/shared/preferences';

describe('preference sanitiser', () => {
  it('returns complete defaults for anything that is not an object', () => {
    for (const input of [null, undefined, 42, 'x', [], true]) {
      const { preferences, repaired } = sanitizePreferences(input, 'win32');
      expect(preferences).toEqual(defaultPreferences('win32'));
      expect(repaired).toBe(true);
    }
  });

  it('starts with safe defaults: private mode ON, override off, no server, pinned, interactive', () => {
    const defaults = defaultPreferences('darwin');
    // Fresh preferences: private mode on, and not yet the user's own decision.
    expect(defaults.capture).toEqual({ enabled: true, chosen: false });
    // Presenter Mode, left out of the taskbar and the Dock until the user opts back in.
    expect(defaults.window.mode).toBe('presenter');
    expect(defaults.window.showInTaskbar).toBe(false);
    expect(defaults.appearance.density).toBe('comfortable');
    expect(defaults.guidance.shareGuideSeen).toBe(false);
    expect(defaults.connection).toEqual({
      serverOrigin: null,
      allowInsecureLan: false,
      acceptedLinkOrigin: null,
    });
    expect(defaults.behaviour.followLatest).toBe(false);
    expect(defaults.window.pinned).toBe(true);
    expect(defaults.window.bounds).toBeNull();
    expect(defaults.shortcuts).toEqual({
      toggleVisibility: 'Command+Alt+Shift+D',
      returnToInteractive: 'Command+Alt+Shift+T',
    });
    expect(defaultPreferences('win32').shortcuts.returnToInteractive).toBe('Control+Alt+Shift+T');
  });

  it('keeps an explicit "off" of private mode, and only an explicit one', () => {
    // The user turned it off (version 2 records that it was a decision): kept, also after reloads.
    const chosenOff = sanitizePreferences(
      { version: PREFERENCES_VERSION, capture: { enabled: false, chosen: true } },
      'win32',
    ).preferences;
    expect(chosenOff.capture).toEqual({ enabled: false, chosen: true });
    expect(sanitizePreferences(chosenOff, 'win32').preferences.capture).toEqual({
      enabled: false,
      chosen: true,
    });
    // An "off" that was nobody's decision (no `chosen`) is the old default: private mode is on.
    for (const capture of [{ enabled: false }, { enabled: false, chosen: false }, {}]) {
      expect(sanitizePreferences({ capture }, 'win32').preferences.capture.enabled).toBe(true);
    }
    // A version 1 file could not record a decision; its "off" was the default then.
    const v1 = sanitizePreferences(
      { version: 1, capture: { enabled: false, verifications: [] } },
      'win32',
    );
    expect(v1.preferences.capture).toEqual({ enabled: true, chosen: false });
    expect(v1.migratedFrom).toBe(1);
    expect(v1.repaired).toBe(false);
    // An explicit "on" stays on whatever else the file says.
    expect(
      sanitizePreferences({ capture: { enabled: true, chosen: true } }, 'win32').preferences
        .capture,
    ).toEqual({ enabled: true, chosen: true });
  });

  it('drops the retired manual-check records of version 1', () => {
    const { preferences } = sanitizePreferences(
      {
        version: 1,
        capture: {
          enabled: true,
          verifications: [{ id: 'abcdef123456', application: 'Example Meet 1.2' }],
        },
      },
      'win32',
    );
    expect(preferences.capture).toEqual({ enabled: true, chosen: false });
    expect(JSON.stringify(preferences)).not.toContain('Example Meet');
  });

  it('round-trips a valid object unchanged', () => {
    const valid = {
      ...defaultPreferences('win32'),
      appearance: {
        backgroundAlpha: 0.35,
        foreground: 'dark',
        readability: 'scrim',
        fontScale: 1.25,
        readingWidth: 'wide',
        density: 'spacious',
      },
      window: {
        mode: 'normal',
        bounds: { x: 10, y: 20, width: 800, height: 500 },
        displayId: 2528732444,
        expandedHeight: 500,
        collapsed: false,
        pinned: false,
        pinLevel: 'screen-saver',
        visibleOnAllWorkspaces: true,
        visibleOnFullScreen: true,
        showInTaskbar: true,
      },
      documentWindow: { bounds: { x: 40, y: 50, width: 1000, height: 700 }, displayId: 7 },
      connection: {
        serverOrigin: 'http://localhost:4310',
        allowInsecureLan: false,
        acceptedLinkOrigin: 'https://docs.example.com',
      },
      capture: { enabled: false, chosen: true },
      guidance: { shareGuideSeen: true },
    };
    const { preferences, repaired } = sanitizePreferences(
      JSON.parse(JSON.stringify(valid)),
      'win32',
    );
    expect(preferences).toEqual(valid);
    expect(repaired).toBe(false);
  });

  it('salvages good fields next to bad ones', () => {
    const { preferences } = sanitizePreferences(
      {
        appearance: {
          backgroundAlpha: 'opaque',
          foreground: 'dark',
          fontScale: 1.4,
          readingWidth: 7,
        },
        window: { bounds: 'top-left', pinned: 'yes', collapsed: true, mode: 'fullscreen' },
        capture: 'on',
        shortcuts: { returnToInteractive: 'Control+Alt+Shift+Y', toggleVisibility: 'Banana' },
      },
      'win32',
    );
    expect(preferences.appearance).toEqual({
      backgroundAlpha: ALPHA_RANGE.default,
      foreground: 'dark',
      readability: 'off',
      fontScale: 1.4,
      readingWidth: 'normal',
      density: 'comfortable',
    });
    expect(preferences.window.bounds).toBeNull();
    expect(preferences.window.pinned).toBe(true);
    expect(preferences.window.collapsed).toBe(true);
    expect(preferences.window.mode).toBe('presenter');
    expect(preferences.capture).toEqual({ enabled: true, chosen: false });
    expect(preferences.shortcuts).toEqual({
      toggleVisibility: 'Control+Alt+Shift+D',
      returnToInteractive: 'Control+Alt+Shift+Y',
    });
  });

  it('clamps numbers into range instead of discarding them', () => {
    const low = sanitizePreferences(
      { appearance: { backgroundAlpha: -3, fontScale: 0 } },
      'win32',
    ).preferences;
    expect(low.appearance.backgroundAlpha).toBe(ALPHA_RANGE.min);
    expect(low.appearance.fontScale).toBe(FONT_SCALE_RANGE.min);
    const high = sanitizePreferences(
      { appearance: { backgroundAlpha: 40, fontScale: 99 }, window: { expandedHeight: 1e9 } },
      'win32',
    ).preferences;
    expect(high.appearance.backgroundAlpha).toBe(1);
    expect(high.appearance.fontScale).toBe(FONT_SCALE_RANGE.max);
    expect(high.window.expandedHeight).toBe(PANEL.maxHeight);
    const nan = sanitizePreferences(
      { appearance: { backgroundAlpha: Number.NaN } },
      'win32',
    ).preferences;
    expect(nan.appearance.backgroundAlpha).toBe(ALPHA_RANGE.default);
  });

  it('never keeps a server address that is not a clean origin', () => {
    for (const serverOrigin of [
      'https://docs.example.com/path',
      'https://user:pw@docs.example.com',
      "https://docs.example.com; script-src 'unsafe-inline'",
      'https://docs.example.com;script-src-elem',
      'javascript:alert(1)',
      'file:///etc/passwd',
      42,
    ]) {
      const { preferences } = sanitizePreferences(
        { connection: { serverOrigin, acceptedLinkOrigin: 'https://alias.example' } },
        'win32',
      );
      expect(preferences.connection.serverOrigin).toBeNull();
      // An alias without a server is meaningless.
      expect(preferences.connection.acceptedLinkOrigin).toBeNull();
    }
  });

  it('never turns the development override on, or private mode off, from junk', () => {
    const { preferences } = sanitizePreferences(
      {
        connection: { allowInsecureLan: 'true' },
        capture: { enabled: 0, chosen: 'yes' },
        window: { showInTaskbar: 'no' },
      },
      'win32',
    );
    expect(preferences.connection.allowInsecureLan).toBe(false);
    expect(preferences.capture).toEqual({ enabled: true, chosen: false });
    expect(preferences.window.showInTaskbar).toBe(false);
  });

  it('requires all-workspaces for fullscreen visibility', () => {
    const { preferences } = sanitizePreferences(
      { window: { visibleOnAllWorkspaces: false, visibleOnFullScreen: true } },
      'darwin',
    );
    expect(preferences.window.visibleOnFullScreen).toBe(false);
  });

  it('strips control characters and bounds free text', () => {
    expect(cleanText('  Zoom\u0000\u0007 6.4\u009f  ', 120)).toBe('Zoom 6.4');
    expect(cleanText('line one\nline two\ttabbed', 120)).toBe('line one\nline two\ttabbed');
    expect(cleanText('x'.repeat(600), 500)).toHaveLength(500);
    expect(cleanText(42, 10)).toBe('');
  });

  it('applies renderer patches through the same clamping', () => {
    const base = defaultPreferences('win32');
    const next = applyPreferencePatch(
      base,
      { appearance: { backgroundAlpha: 0.01, fontScale: 3 } },
      'win32',
    );
    expect(next.appearance.backgroundAlpha).toBe(ALPHA_RANGE.min);
    expect(next.appearance.fontScale).toBe(FONT_SCALE_RANGE.max);
    expect(next.connection).toEqual(base.connection);
    const follow = applyPreferencePatch(base, { behaviour: { followLatest: true } }, 'win32');
    expect(follow.behaviour.followLatest).toBe(true);
  });
});

describe('preference file handling', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rd-prefs-'));
    filePath = path.join(directory, 'nested', 'preferences.json');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const store = () => new PreferencesStore({ filePath, platform: 'win32', debounceMs: 5 });

  it('starts from defaults when no file exists and writes on first change', async () => {
    const preferences = store();
    expect(await preferences.load()).toBe('created');
    expect(preferences.get()).toEqual(defaultPreferences('win32'));
    preferences.update((current) => ({
      ...current,
      capture: { ...current.capture, enabled: false, chosen: true },
    }));
    await preferences.flush();
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      capture: { enabled: boolean; chosen: boolean };
    };
    expect(onDisk.capture).toEqual({ enabled: false, chosen: true });
    // No temp file is left behind by the atomic write.
    expect(await fs.readdir(path.dirname(filePath))).toEqual(['preferences.json']);
  });

  it('persists and reloads values', async () => {
    const first = store();
    await first.load();
    first.update((current) => ({
      ...current,
      window: { ...current.window, bounds: { x: 5, y: 6, width: 700, height: 400 }, displayId: 3 },
    }));
    await first.flush();
    const second = store();
    expect(await second.load()).toBe('loaded');
    expect(second.get().window.bounds).toEqual({ x: 5, y: 6, width: 700, height: 400 });
  });

  it.each([
    ['truncated JSON', '{"appearance": {"backgroundAlpha": 0.5'],
    ['binary garbage', '\u0000\u0001\u0002��'],
    ['an empty file', ''],
    ['HTML', '<html><body>404</body></html>'],
  ])('survives %s: keeps a backup and falls back to defaults', async (_name, contents) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
    const preferences = store();
    expect(await preferences.load()).toBe('corrupt_reset');
    expect(preferences.get()).toEqual(defaultPreferences('win32'));
    const backup = await fs.readFile(
      path.join(path.dirname(filePath), 'preferences.corrupt.json'),
      'utf8',
    );
    expect(backup).toBe(contents);
    // A fresh, valid file replaced the damaged one.
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual(defaultPreferences('win32'));
  });

  it('repairs a readable but damaged file in place', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        appearance: { backgroundAlpha: 0.4, foreground: 'neon' },
        window: { bounds: { x: 99999, y: 99999, width: 720, height: 460 }, displayId: 12 },
        unknownSection: { anything: true },
      }),
    );
    const preferences = store();
    expect(await preferences.load()).toBe('repaired');
    expect(preferences.get().appearance.backgroundAlpha).toBe(0.4);
    expect(preferences.get().appearance.foreground).toBe('light');
    // Off-screen coordinates are kept here; placement is corrected against real displays at startup.
    expect(preferences.get().window.bounds).toEqual({
      x: 99999,
      y: 99999,
      width: 720,
      height: 460,
    });
    const rewritten = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(rewritten.unknownSection).toBeUndefined();
  });

  it('treats an absurdly large file as damaged', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }));
    const preferences = store();
    expect(await preferences.load()).toBe('corrupt_reset');
    expect(preferences.get()).toEqual(defaultPreferences('win32'));
  });

  it('coalesces rapid updates into the final value', async () => {
    const preferences = store();
    await preferences.load();
    for (let x = 0; x < 200; x += 1) {
      preferences.update((current) => ({
        ...current,
        window: { ...current.window, bounds: { x, y: 0, width: 720, height: 460 } },
      }));
    }
    await preferences.flush();
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      window: { bounds: { x: number } };
    };
    expect(onDisk.window.bounds.x).toBe(199);
  });

  it('sanitises whatever an update produces', async () => {
    const preferences = store();
    await preferences.load();
    const next = preferences.update(
      (current) =>
        ({
          ...current,
          appearance: { ...current.appearance, backgroundAlpha: 9 },
          connection: { ...current.connection, serverOrigin: 'ftp://nope' },
        }) as never,
    );
    expect(next.appearance.backgroundAlpha).toBe(1);
    expect(next.connection.serverOrigin).toBeNull();
  });
});
