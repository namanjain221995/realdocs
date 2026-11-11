import type { ComponentProps, CSSProperties } from 'react';
import { Tooltip } from './Tooltip';
import { cx } from './utils';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | number;

export interface AvatarProps extends Omit<ComponentProps<'span'>, 'children' | 'color'> {
  /** The person's name. Used for the initials, the colour and the accessible name. */
  name: string;
  /**
   * Background colour, for example a collaborator's cursor colour. Hex,
   * `rgb()` and `hsl()` values get a readable text colour automatically.
   * Derived from the name when omitted.
   */
  color?: string;
  /** `xs` 20px, `sm` 24px (default), `md` 28px, `lg` 36px, or a size in px. */
  size?: AvatarSize;
}

const AVATAR_SIZES = { xs: 20, sm: 24, md: 28, lg: 36 } as const;

/**
 * Identity colours. Mid-light tints that read on ink and on paper, each with
 * at least 7:1 contrast against the dark initials drawn on top.
 */
const AVATAR_PALETTE = [
  '#f2a08f',
  '#f0b072',
  '#dcc15a',
  '#a9d06c',
  '#6fd6a0',
  '#5fd3c4',
  '#74c5ee',
  '#9fb6f7',
  '#c4a8f2',
  '#eda3d0',
] as const;

const INK = '#0a1215';
const PAPER = '#ffffff';

function hashName(name: string): number {
  // FNV-1a: small, stable and well spread for short strings.
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function colorForName(name: string): string {
  const key = name.trim().toLocaleLowerCase();
  return AVATAR_PALETTE[hashName(key) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0];
}

function firstGrapheme(word: string): string {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
    for (const { segment } of segments) return segment;
  }
  return Array.from(word)[0] ?? '';
}

/** Up to two initials; works for scripts without capital letters. */
function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(word));
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const head = firstGrapheme(first).toLocaleUpperCase();
  // A conjunct such as "प्रि" is already as wide as two Latin letters.
  if (!last || Array.from(head).length > 1) return head;
  const tail = firstGrapheme(last).toLocaleUpperCase();
  return Array.from(tail).length > 1 ? head : head + tail;
}

function parseColor(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) {
    const [r, g, b] = Array.from(hex).map((digit) => Number.parseInt(digit + digit, 16));
    return r !== undefined && g !== undefined && b !== undefined ? [r, g, b] : null;
  }
  if (hex && (hex.length === 6 || hex.length === 8)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(text);
  if (rgb) {
    const channel = (part: string | undefined): number => {
      if (!part) return 0;
      return part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part);
    };
    return [channel(rgb[1]), channel(rgb[2]), channel(rgb[3])];
  }
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(text);
  if (hsl) {
    const hue = (((Number.parseFloat(hsl[1] ?? '0') % 360) + 360) % 360) / 360;
    const saturation = Number.parseFloat(hsl[2] ?? '0') / 100;
    const lightness = Number.parseFloat(hsl[3] ?? '0') / 100;
    const q =
      lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const channel = (offset: number): number => {
      let t = hue + offset;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255];
  }
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (value: number): number => {
    const unit = Math.min(255, Math.max(0, value)) / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Ink or paper, whichever contrasts more with the background. */
function readableOn(background: string): string {
  const rgb = parseColor(background);
  if (!rgb) return PAPER;
  const luminance = relativeLuminance(rgb);
  const withInk = (luminance + 0.05) / (relativeLuminance([10, 18, 21]) + 0.05);
  const withPaper = 1.05 / (luminance + 0.05);
  return withInk >= withPaper ? INK : PAPER;
}

/** A person, shown as initials on their colour. */
export function Avatar({ name, color, size = 'sm', className, style, ...rest }: AvatarProps) {
  const pixels = typeof size === 'number' ? size : AVATAR_SIZES[size];
  const background = color ?? colorForName(name);
  const avatarStyle = {
    '--rd-avatar-size': `${pixels}px`,
    '--rd-avatar-bg': background,
    '--rd-avatar-fg': readableOn(background),
    ...style,
  } as CSSProperties;
  return (
    <span
      role="img"
      aria-label={name}
      {...rest}
      className={cx('rd-avatar', className)}
      style={avatarStyle}
    >
      <span aria-hidden="true">{initialsOf(name)}</span>
    </span>
  );
}

export interface AvatarPerson {
  id: string;
  name: string;
  color?: string;
  /** Tooltip text, for example `Asha Rao is editing`. Defaults to the name. */
  title?: string;
}

export interface AvatarStackProps extends Omit<ComponentProps<'div'>, 'children'> {
  people: readonly AvatarPerson[];
  /** Show at most this many avatars, then a `+N` counter. Defaults to 4. */
  max?: number;
  size?: AvatarSize;
}

/** The people in a document, overlapped to save space. */
export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
  className,
  ...rest
}: AvatarStackProps) {
  const limit = Math.max(1, Math.floor(max));
  // Never show "+1": the counter takes the room of the avatar it would hide.
  const shown = people.length > limit ? people.slice(0, limit - 1) : people;
  const hidden = people.slice(shown.length);
  const pixels = typeof size === 'number' ? size : AVATAR_SIZES[size];
  const hiddenNames = hidden.map((person) => person.name).join(', ');
  return (
    <div
      role="group"
      aria-label={people.length === 1 ? '1 person' : `${people.length} people`}
      {...rest}
      className={cx('rd-avatar-stack', className)}
    >
      {shown.map((person) => (
        <Tooltip key={person.id} content={person.title ?? person.name} describe={false}>
          <Avatar
            name={person.name}
            aria-label={person.title ?? person.name}
            color={person.color}
            size={size}
          />
        </Tooltip>
      ))}
      {hidden.length > 0 ? (
        <Tooltip content={hiddenNames} describe={false}>
          <span
            role="img"
            aria-label={`${hidden.length} more: ${hiddenNames}`}
            className="rd-avatar rd-avatar--more"
            style={{ '--rd-avatar-size': `${pixels}px` } as CSSProperties}
          >
            <span aria-hidden="true">+{hidden.length}</span>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
