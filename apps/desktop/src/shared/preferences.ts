/**
 * Local preferences: schema, defaults and a corruption-tolerant sanitiser.
 *
 * Preferences are plain JSON in the user-data directory. They never contain
 * credentials, share secrets or document content (those live in the
 * encrypted session reference, see `src/main/credential-store.ts`).
 *
 * `sanitizePreferences` accepts anything (a damaged file, an older version, a
 * hand-edited value) and always returns a complete, in-range object: each
 * field is salvaged on its own, so one bad value never resets the rest.
 */
import { PANEL, isUsableRect, roundRect, type Rect } from './geometry';
import { isCanonicalHttpOrigin } from './server-origin';
import { sanitizeShortcutMap, type DesktopPlatform, type ShortcutMap } from './shortcuts';

/**
 * Version 2: private mode is on unless the user turned it off
 * (`capture.chosen`); the taskbar/Dock setting (`window.showInTaskbar`, off:
 * the panel is left out of the taskbar and the Dock) and the first-run guide
 * flag were added; the manual-check records of version 1 were retired (the
 * Privacy Test Center keeps its own records). A version 1 file is read like
 * any other: fields it does not have get their defaults, retired ones go.
 *
 * Version 3: a pinned panel is meant to stay in front of full-screen applications. The defaults
 * became pin level `screen-saver`, visible on all workspaces and on full-screen applications, and
 * a file written by an older version takes these three once (the earlier defaults left the panel
 * behind a full-screen browser or meeting window). They remain ordinary settings afterwards.
 */
export const PREFERENCES_VERSION = 3;
/** Files written before this version take the new stacking defaults once. */
const STACKING_DEFAULTS_VERSION = 3;

export const ALPHA_RANGE = { min: 0.1, max: 1, step: 0.01, default: 0.86 } as const;
export const FONT_SCALE_RANGE = { min: 0.8, max: 1.8, step: 0.05, default: 1 } as const;

export const FOREGROUNDS = ['light', 'dark'] as const;
/** `light`: light text on a dark panel surface. `dark`: dark text on a light surface. */
export type Foreground = (typeof FOREGROUNDS)[number];

export const READABILITY_MODES = ['off', 'outline', 'scrim'] as const;
/** Help for low background alpha: a contrast outline around glyphs or a scrim behind text blocks. */
export type ReadabilityMode = (typeof READABILITY_MODES)[number];

export const READING_WIDTHS = ['narrow', 'normal', 'wide', 'full'] as const;
export type ReadingWidth = (typeof READING_WIDTHS)[number];

export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
/** Line spacing and the space between blocks, on this computer only (never the shared document). */
export type Density = (typeof DENSITIES)[number];

export const DOCUMENT_MODE_VALUES = ['presenter', 'normal'] as const;

export const PIN_LEVELS = ['floating', 'screen-saver'] as const;
/**
 * Always-on-top level passed to `setAlwaysOnTop`. `floating` stays below the
 * Dock/taskbar; `screen-saver` asks to sit above them. Neither is a promise
 * to cover every system surface or fullscreen application.
 */
export type PinLevel = (typeof PIN_LEVELS)[number];

export const PROBE_RESULTS = ['works', 'glitches', 'broken'] as const;
export type ProbeResult = (typeof PROBE_RESULTS)[number];

export interface AppearancePreferences {
  backgroundAlpha: number;
  foreground: Foreground;
  readability: ReadabilityMode;
  fontScale: number;
  readingWidth: ReadingWidth;
  density: Density;
}

/** Where the ordinary framed window was (normal mode keeps its own bounds). */
export interface DocumentWindowPreferences {
  bounds: Rect | null;
  displayId: number | null;
}

export interface WindowPreferences {
  /** Private Presenter Mode (the panel) or an ordinary window. */
  mode: (typeof DOCUMENT_MODE_VALUES)[number];
  bounds: Rect | null;
  displayId: number | null;
  /** Height to restore when the panel is expanded again. */
  expandedHeight: number;
  collapsed: boolean;
  pinned: boolean;
  pinLevel: PinLevel;
  /** macOS/Linux: show the panel on every Space/workspace. */
  visibleOnAllWorkspaces: boolean;
  /** macOS: also show above fullscreen applications (only with the option above). */
  visibleOnFullScreen: boolean;
  /**
   * Show the panel in the taskbar (Windows) / RealtimeDocs in the Dock
   * (macOS). Off by default: the panel is left out of both, but only while
   * another way back to it exists (`shared/presence.ts`).
   */
  showInTaskbar: boolean;
}

export interface BehaviourPreferences {
  /** Passed to the editor's Follow Latest toggle; off by default. */
  followLatest: boolean;
}

export interface ConnectionPreferences {
  serverOrigin: string | null;
  /** Development override: allow plain HTTP to private-network hosts. Off by default. */
  allowInsecureLan: boolean;
  /** See `LinkOriginContext.acceptedLinkOrigin`. Cleared whenever the server changes. */
  acceptedLinkOrigin: string | null;
}

export interface CapturePreferences {
  /**
   * Private mode: request OS capture exclusion for every window of the app.
   * On unless the user turned it off.
   */
  enabled: boolean;
  /**
   * True once the user has used the private-mode switch. Only then can
   * `enabled` be false: "off" is always somebody's decision, never a default
   * and never the leftover of an older version (in version 1 the default was
   * off, so an "off" in such a file says nothing about what the user wanted).
   */
  chosen: boolean;
}

export interface GuidancePreferences {
  /** The "Before you share your screen" card was shown and closed by the user. */
  shareGuideSeen: boolean;
}

export interface ProbeRecord {
  result: ProbeResult;
  notes: string;
  osPlatform: string;
  osVersion: string;
  electronVersion: string;
  recordedAt: string;
}

export interface DiagnosticsPreferences {
  nativeResizeProbe: ProbeRecord | null;
}

export interface Preferences {
  version: number;
  appearance: AppearancePreferences;
  /** The panel (Private Presenter Mode). */
  window: WindowPreferences;
  /** The ordinary window (normal mode). */
  documentWindow: DocumentWindowPreferences;
  behaviour: BehaviourPreferences;
  connection: ConnectionPreferences;
  capture: CapturePreferences;
  guidance: GuidancePreferences;
  shortcuts: ShortcutMap;
  diagnostics: DiagnosticsPreferences;
}

export const MAX_NOTES_LENGTH = 500;

export function defaultPreferences(platform: DesktopPlatform): Preferences {
  return {
    version: PREFERENCES_VERSION,
    appearance: {
      backgroundAlpha: ALPHA_RANGE.default,
      foreground: 'light',
      readability: 'off',
      fontScale: FONT_SCALE_RANGE.default,
      readingWidth: 'normal',
      density: 'comfortable',
    },
    window: {
      mode: 'presenter',
      bounds: null,
      displayId: null,
      expandedHeight: PANEL.defaultHeight,
      collapsed: false,
      pinned: true,
      pinLevel: 'screen-saver',
      visibleOnAllWorkspaces: true,
      visibleOnFullScreen: true,
      showInTaskbar: false,
    },
    documentWindow: { bounds: null, displayId: null },
    behaviour: { followLatest: false },
    connection: { serverOrigin: null, allowInsecureLan: false, acceptedLinkOrigin: null },
    capture: { enabled: true, chosen: false },
    guidance: { shareGuideSeen: false },
    shortcuts: sanitizeShortcutMap(null, platform),
    diagnostics: { nativeResizeProbe: null },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Trims, strips control characters and bounds the length of free text. */
export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  let output = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Keep tab and newline; drop every other C0/C1 control character.
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f)) continue;
    output += character;
  }
  return output.trim().slice(0, maxLength);
}

function isoDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 40) return fallback;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function sanitizeProbe(value: unknown): ProbeRecord | null {
  const source = record(value);
  if (
    typeof source.result !== 'string' ||
    !(PROBE_RESULTS as readonly string[]).includes(source.result)
  ) {
    return null;
  }
  return {
    result: source.result as ProbeResult,
    notes: cleanText(source.notes, MAX_NOTES_LENGTH),
    osPlatform: cleanText(source.osPlatform, 32),
    osVersion: cleanText(source.osVersion, 64),
    electronVersion: cleanText(source.electronVersion, 32),
    recordedAt: isoDate(source.recordedAt, new Date(0).toISOString()),
  };
}

export interface SanitizeResult {
  preferences: Preferences;
  /** True when the input differed from the sanitised result (a damaged or hand-edited file). */
  repaired: boolean;
  /**
   * The version the input was written by, when that is an older one. Such a
   * file is not damaged: it is merely brought up to date.
   */
  migratedFrom: number | null;
}

export function sanitizePreferences(input: unknown, platform: DesktopPlatform): SanitizeResult {
  const defaults = defaultPreferences(platform);
  const root = record(input);
  const appearance = record(root.appearance);
  const windowPrefs = record(root.window);
  const documentWindow = record(root.documentWindow);
  const behaviour = record(root.behaviour);
  const connection = record(root.connection);
  const capture = record(root.capture);
  const guidance = record(root.guidance);
  const diagnostics = record(root.diagnostics);
  const writtenBy =
    typeof root.version === 'number' && Number.isSafeInteger(root.version) && root.version >= 1
      ? root.version
      : null;
  // "Off" needs a decision. Without one (a new profile, or a file from a
  // version in which off was simply the default) private mode is on.
  const captureChosen = bool(capture.chosen, false);
  const captureEnabled = captureChosen ? bool(capture.enabled, true) : true;

  const bounds = isUsableRect(windowPrefs.bounds) ? roundRect(windowPrefs.bounds) : null;
  const serverOrigin = isCanonicalHttpOrigin(connection.serverOrigin)
    ? connection.serverOrigin
    : null;
  const acceptedLinkOrigin =
    serverOrigin !== null &&
    isCanonicalHttpOrigin(connection.acceptedLinkOrigin) &&
    connection.acceptedLinkOrigin !== serverOrigin
      ? connection.acceptedLinkOrigin
      : null;
  // A file from before version 3 holds the old stacking defaults, not a choice.
  const stackingFromDefaults = writtenBy !== null && writtenBy < STACKING_DEFAULTS_VERSION;
  const visibleOnAllWorkspaces = stackingFromDefaults
    ? defaults.window.visibleOnAllWorkspaces
    : bool(windowPrefs.visibleOnAllWorkspaces, defaults.window.visibleOnAllWorkspaces);

  const preferences: Preferences = {
    version: PREFERENCES_VERSION,
    appearance: {
      backgroundAlpha: clampNumber(
        appearance.backgroundAlpha,
        ALPHA_RANGE.min,
        ALPHA_RANGE.max,
        defaults.appearance.backgroundAlpha,
      ),
      foreground: oneOf(appearance.foreground, FOREGROUNDS, defaults.appearance.foreground),
      readability: oneOf(
        appearance.readability,
        READABILITY_MODES,
        defaults.appearance.readability,
      ),
      fontScale: clampNumber(
        appearance.fontScale,
        FONT_SCALE_RANGE.min,
        FONT_SCALE_RANGE.max,
        defaults.appearance.fontScale,
      ),
      readingWidth: oneOf(
        appearance.readingWidth,
        READING_WIDTHS,
        defaults.appearance.readingWidth,
      ),
      density: oneOf(appearance.density, DENSITIES, defaults.appearance.density),
    },
    window: {
      mode: oneOf(windowPrefs.mode, DOCUMENT_MODE_VALUES, defaults.window.mode),
      bounds,
      displayId:
        typeof windowPrefs.displayId === 'number' && Number.isSafeInteger(windowPrefs.displayId)
          ? windowPrefs.displayId
          : null,
      expandedHeight: Math.round(
        clampNumber(
          windowPrefs.expandedHeight,
          PANEL.minHeight,
          PANEL.maxHeight,
          defaults.window.expandedHeight,
        ),
      ),
      collapsed: bool(windowPrefs.collapsed, defaults.window.collapsed),
      pinned: bool(windowPrefs.pinned, defaults.window.pinned),
      pinLevel: stackingFromDefaults
        ? defaults.window.pinLevel
        : oneOf(windowPrefs.pinLevel, PIN_LEVELS, defaults.window.pinLevel),
      visibleOnAllWorkspaces,
      visibleOnFullScreen:
        visibleOnAllWorkspaces &&
        (stackingFromDefaults
          ? defaults.window.visibleOnFullScreen
          : bool(windowPrefs.visibleOnFullScreen, defaults.window.visibleOnFullScreen)),
      showInTaskbar: bool(windowPrefs.showInTaskbar, defaults.window.showInTaskbar),
    },
    documentWindow: {
      bounds: isUsableRect(documentWindow.bounds) ? roundRect(documentWindow.bounds) : null,
      displayId:
        typeof documentWindow.displayId === 'number' &&
        Number.isSafeInteger(documentWindow.displayId)
          ? documentWindow.displayId
          : null,
    },
    behaviour: { followLatest: bool(behaviour.followLatest, defaults.behaviour.followLatest) },
    connection: {
      serverOrigin,
      allowInsecureLan: bool(connection.allowInsecureLan, defaults.connection.allowInsecureLan),
      acceptedLinkOrigin,
    },
    capture: { enabled: captureEnabled, chosen: captureChosen },
    guidance: { shareGuideSeen: bool(guidance.shareGuideSeen, false) },
    shortcuts: sanitizeShortcutMap(root.shortcuts, platform),
    diagnostics: { nativeResizeProbe: sanitizeProbe(diagnostics.nativeResizeProbe) },
  };

  const migratedFrom = writtenBy !== null && writtenBy < PREFERENCES_VERSION ? writtenBy : null;
  return {
    preferences,
    // An older file always differs from the current shape; that is not damage.
    repaired: migratedFrom === null && !deepEqual(preferences, input),
    migratedFrom,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Fields of the appearance and behaviour sections that a renderer may change. */
export interface PreferencePatch {
  appearance?: Partial<AppearancePreferences>;
  behaviour?: Partial<BehaviourPreferences>;
}

/** Applies a (pre-validated) patch and re-sanitises, so ranges are always enforced in one place. */
export function applyPreferencePatch(
  current: Preferences,
  patch: PreferencePatch,
  platform: DesktopPlatform,
): Preferences {
  return sanitizePreferences(
    {
      ...current,
      appearance: { ...current.appearance, ...patch.appearance },
      behaviour: { ...current.behaviour, ...patch.behaviour },
    },
    platform,
  ).preferences;
}
