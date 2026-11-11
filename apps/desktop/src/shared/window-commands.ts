/**
 * Keyboard commands for the panel window itself (size and position). Pure:
 * the panel page listens for `keydown` and calls the same validated bridge
 * actions as its buttons, so a real key press and an automated one take the
 * identical path.
 *
 * The chord is Ctrl+Alt+Shift (Control+Option+Shift on macOS) so it cannot
 * collide with text editing or the editor's own shortcuts:
 *
 *   + Arrow keys   grow/shrink the panel
 *   + 1…5          size presets (compact, standard, wide, tall, large)
 *   + 0            reset position
 *   + C            collapse / expand
 *
 * These work only while the panel has keyboard focus. The three *global*
 * shortcuts (show/hide, click-through, pin) are separate, configurable and
 * handled by the main process.
 */
import { SIZE_PRESET_NAMES, type SizePreset } from './geometry';

export interface KeyInput {
  /** `keyDown` for a key press. */
  type: string;
  key: string;
  code: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** True while an input method is composing text; such key presses are never commands. */
  composing?: boolean;
}

export type WindowCommand =
  | { kind: 'nudge-size'; deltaWidth: number; deltaHeight: number }
  | { kind: 'preset'; preset: SizePreset }
  | { kind: 'reset-position' }
  | { kind: 'toggle-collapse' };

export const KEYBOARD_RESIZE_STEP = 24;

export function matchWindowCommand(input: KeyInput): WindowCommand | null {
  if (input.type !== 'keyDown' || input.composing === true) return null;
  if (!input.control || !input.alt || !input.shift || input.meta) return null;

  switch (input.code) {
    case 'ArrowRight':
      return { kind: 'nudge-size', deltaWidth: KEYBOARD_RESIZE_STEP, deltaHeight: 0 };
    case 'ArrowLeft':
      return { kind: 'nudge-size', deltaWidth: -KEYBOARD_RESIZE_STEP, deltaHeight: 0 };
    case 'ArrowDown':
      return { kind: 'nudge-size', deltaWidth: 0, deltaHeight: KEYBOARD_RESIZE_STEP };
    case 'ArrowUp':
      return { kind: 'nudge-size', deltaWidth: 0, deltaHeight: -KEYBOARD_RESIZE_STEP };
    case 'Digit0':
      return { kind: 'reset-position' };
    case 'KeyC':
      return { kind: 'toggle-collapse' };
    default: {
      const digit = /^Digit([1-5])$/.exec(input.code);
      if (!digit) return null;
      const preset = SIZE_PRESET_NAMES[Number(digit[1]) - 1];
      return preset ? { kind: 'preset', preset } : null;
    }
  }
}

/** Shown in menus and the settings window. */
export function windowCommandHints(platform: 'win32' | 'darwin' | 'linux'): {
  chord: string;
  items: { keys: string; label: string }[];
} {
  const chord = platform === 'darwin' ? 'Control+Option+Shift' : 'Ctrl+Alt+Shift';
  return {
    chord,
    items: [
      { keys: `${chord}+Arrow keys`, label: 'Resize the panel' },
      { keys: `${chord}+1 … 5`, label: 'Size presets (compact, standard, wide, tall, large)' },
      { keys: `${chord}+0`, label: 'Reset the panel position' },
      { keys: `${chord}+C`, label: 'Collapse or expand the panel' },
    ],
  };
}
