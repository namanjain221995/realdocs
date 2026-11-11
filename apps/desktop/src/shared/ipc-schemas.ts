/**
 * Input schemas for every IPC channel. The main process parses each message
 * with these before doing anything; objects are strict (unknown keys reject)
 * and every number and string is bounded. Ranges here are deliberately a
 * little wider than the product limits — the handlers clamp to the real
 * limits, so a slightly-off value is corrected instead of rejected.
 */
import { ConnectionState, EffectiveRole, SaveState } from '@realtimedocs/contracts';
import { z } from 'zod';
import { RESIZE_EDGES, SIZE_PRESET_NAMES } from './geometry';
import {
  DENSITIES,
  FOREGROUNDS,
  MAX_NOTES_LENGTH,
  PIN_LEVELS,
  PROBE_RESULTS,
  READABILITY_MODES,
  READING_WIDTHS,
} from './preferences';
import { SHORTCUT_ACTIONS } from './shortcuts';
import { SETTINGS_TABS } from './state';

const coordinate = z.number().min(-100_000).max(100_000);
const dimension = z.number().min(1).max(20_000);
const delta = z.number().min(-20_000).max(20_000);
const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

/** Channels without input must be called with no argument at all. */
export const NoInput = z.undefined();

export const PrefsUpdateInput = z
  .strictObject({
    appearance: z
      .strictObject({
        backgroundAlpha: z.number().min(0).max(1).optional(),
        foreground: z.enum(FOREGROUNDS).optional(),
        readability: z.enum(READABILITY_MODES).optional(),
        fontScale: z.number().min(0.1).max(10).optional(),
        readingWidth: z.enum(READING_WIDTHS).optional(),
        density: z.enum(DENSITIES).optional(),
      })
      .optional(),
    behaviour: z.strictObject({ followLatest: z.boolean().optional() }).optional(),
  })
  .refine((value) => value.appearance !== undefined || value.behaviour !== undefined, {
    message: 'Nothing to update',
  });
export type PrefsUpdateInput = z.infer<typeof PrefsUpdateInput>;

export const WINDOW_ACTIONS = [
  'show',
  'hide',
  'toggle-visibility',
  'collapse',
  'expand',
  'toggle-collapse',
  'pin',
  'unpin',
  'toggle-pin',
  'reset-position',
  'open-settings',
  'close-settings',
  'show-share-guide',
  'dismiss-share-guide',
  /** The emergency way back: leave click-through, un-park, expand, show, raise, fully on screen. */
  'return-to-interactive',
  /** Show the open document in Private Presenter Mode / in an ordinary window. */
  'presenter-mode',
  'normal-window',
] as const;
export type WindowActionName = (typeof WINDOW_ACTIONS)[number];

export const WindowActionInput = z.strictObject({
  action: z.enum(WINDOW_ACTIONS),
  /** Only used by `open-settings`. */
  tab: z.enum(SETTINGS_TABS).optional(),
});
export type WindowActionInput = z.infer<typeof WindowActionInput>;

export const SetBoundsInput = z
  .strictObject({
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to change',
  });
export type SetBoundsInput = z.infer<typeof SetBoundsInput>;

export const PresetInput = z.strictObject({ preset: z.enum(SIZE_PRESET_NAMES) });
export type PresetInput = z.infer<typeof PresetInput>;

export const NudgeInput = z.strictObject({
  deltaWidth: delta.default(0),
  deltaHeight: delta.default(0),
  deltaX: delta.default(0),
  deltaY: delta.default(0),
});
export type NudgeInput = z.input<typeof NudgeInput>;

export const ResizeStartInput = z.strictObject({ edge: z.enum(RESIZE_EDGES) });
export type ResizeStartInput = z.infer<typeof ResizeStartInput>;

export const ResizeMoveInput = z.strictObject({ dx: delta, dy: delta });
export type ResizeMoveInput = z.infer<typeof ResizeMoveInput>;

export const ClickThroughInput = z.strictObject({ enabled: z.boolean() });
export const ClickThroughHoverInput = z.strictObject({ hovering: z.boolean() });

export const WorkspaceInput = z
  .strictObject({
    visibleOnAllWorkspaces: z.boolean().optional(),
    visibleOnFullScreen: z.boolean().optional(),
    pinLevel: z.enum(PIN_LEVELS).optional(),
    /** "Show in taskbar / Dock": opt back in to the taskbar button (Windows) / Dock icon (macOS). */
    showInTaskbar: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to change',
  });
export type WorkspaceInput = z.infer<typeof WorkspaceInput>;

export const SetServerInput = z.strictObject({ origin: z.string().max(300) });
export type SetServerInput = z.infer<typeof SetServerInput>;

export const ConnectionOptionsInput = z
  .strictObject({
    allowInsecureLan: z.boolean().optional(),
    /**
     * Accept links that carry the server's self-reported public origin. The
     * renderer can only toggle this; the main process supplies the origin.
     */
    acceptPublicOrigin: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to change',
  });
export type ConnectionOptionsInput = z.infer<typeof ConnectionOptionsInput>;

export const OpenShareLinkInput = z.strictObject({ link: z.string().min(1).max(2048) });
export type OpenShareLinkInput = z.infer<typeof OpenShareLinkInput>;

export const DismissNoticeInput = z.strictObject({ id: opaqueId });

export const SessionReportInput = z.strictObject({
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  connection: ConnectionState,
  save: SaveState,
  role: EffectiveRole.nullable(),
  title: z.string().max(300).nullable(),
});
export type SessionReportInput = z.infer<typeof SessionReportInput>;

export const CaptureEnabledInput = z.strictObject({ enabled: z.boolean() });

/** The preload's answer to a `frameRequest`: the nonce it was given. */
export const FrameAckInput = z.strictObject({ nonce: opaqueId });

export const ShortcutSetInput = z.strictObject({
  action: z.enum(SHORTCUT_ACTIONS),
  accelerator: z.string().min(1).max(64),
});
export type ShortcutSetInput = z.infer<typeof ShortcutSetInput>;

export const ShortcutResetInput = z.strictObject({ action: z.enum(SHORTCUT_ACTIONS).optional() });
export const ShortcutRecordingInput = z.strictObject({ active: z.boolean() });

export const ExternalOpenInput = z.strictObject({ url: z.string().min(1).max(2048) });

export const ProbeRecordInput = z.strictObject({
  result: z.enum(PROBE_RESULTS),
  notes: z.string().max(MAX_NOTES_LENGTH).default(''),
});
export type ProbeRecordInput = z.input<typeof ProbeRecordInput>;

/**
 * Summary of a refused Content-Security-Policy action, reported by the preload
 * script. It carries where and what kind, never page content or a code sample.
 */
export const PolicyViolationInput = z.strictObject({
  /** Effective directive, e.g. `script-src`, `connect-src`. */
  directive: z.string().regex(/^[a-z-]{1,64}$/),
  /** `inline`, `eval`, an origin, or a bare scheme such as `data:`. */
  blocked: z.string().max(200),
  /** File name of the script that triggered it, if any. */
  source: z.string().max(160),
  line: z.number().int().min(0).max(100_000_000),
});
export type PolicyViolationInput = z.infer<typeof PolicyViolationInput>;

/** Every IPC reply uses this envelope; errors carry a code and a displayable message only. */
export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
