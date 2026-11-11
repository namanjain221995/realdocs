/**
 * Minimal, allocation-light parsing of inline `style` attributes found in
 * pasted HTML. Only the handful of properties the normalizer understands are
 * read; values are validated and re-emitted in canonical form, so no original
 * style text ever reaches the document.
 */

export type StyleMap = Map<string, string>;

const EMPTY_STYLE: StyleMap = new Map();

/** Parses `a: b; c: d` into a map with lower-case property names. */
export function parseStyle(value: string | null | undefined): StyleMap {
  if (!value) return EMPTY_STYLE;
  const map: StyleMap = new Map();
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const raw = declaration
      .slice(separator + 1)
      .replace(/!important/gi, '')
      .trim();
    if (property && raw) map.set(property, raw);
  }
  return map;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  navy: '#000080',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  darkred: '#8b0000',
  darkgreen: '#006400',
  darkblue: '#00008b',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  lightblue: '#add8e6',
  lightgreen: '#90ee90',
  lightyellow: '#ffffe0',
  darkorange: '#ff8c00',
  indigo: '#4b0082',
  violet: '#ee82ee',
  turquoise: '#40e0d0',
  crimson: '#dc143c',
  tomato: '#ff6347',
  coral: '#ff7f50',
  salmon: '#fa8072',
  khaki: '#f0e68c',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  royalblue: '#4169e1',
  slategray: '#708090',
  dimgray: '#696969',
};

const hex2 = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');

/**
 * Normalises a CSS colour to `#rrggbb`, or null when it is transparent,
 * unsupported (gradients, `url()`, variables, system colours) or malformed.
 */
export function normalizeColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value || value.length > 64) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex && hex[1]) {
    const digits = hex[1];
    if (digits.length <= 4) {
      if (digits.length === 4 && digits[3] === '0') return null;
      return `#${[...digits.slice(0, 3)].map((digit) => digit + digit).join('')}`;
    }
    if (digits.length === 8 && digits.slice(6) === '00') return null;
    return `#${digits.slice(0, 6)}`;
  }
  const rgb =
    /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
      value,
    );
  if (rgb) {
    const channel = (part: string | undefined): number => {
      if (!part) return 0;
      return part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part);
    };
    const alphaPart = rgb[4];
    if (alphaPart !== undefined) {
      const alpha = alphaPart.endsWith('%')
        ? Number.parseFloat(alphaPart) / 100
        : Number.parseFloat(alphaPart);
      if (!(alpha > 0.05)) return null;
    }
    const [r, g, b] = [channel(rgb[1]), channel(rgb[2]), channel(rgb[3])];
    if (![r, g, b].every((part) => Number.isFinite(part))) return null;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return NAMED_COLORS[value] ?? null;
}

/** Relative luminance (0–1) and chroma (0–255) of a `#rrggbb` colour. */
function colorMetrics(hex: string): { luminance: number; chroma: number } {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return {
    luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
    chroma: Math.max(r, g, b) - Math.min(r, g, b),
  };
}

/** Near-black or near-white: the source's default ink or paper, not a choice. */
export function isDefaultInk(hex: string): boolean {
  const { luminance, chroma } = colorMetrics(hex);
  return chroma <= 40 && (luminance <= 0.22 || luminance >= 0.9);
}

/** Dark or light ink that stays readable on the given `#rrggbb` background. */
export function readableInk(hex: string): string {
  return colorMetrics(hex).luminance > 0.45 ? '#14181a' : '#f5f7f8';
}

/**
 * Converts a CSS length to CSS pixels. Understands px, pt, in, cm, mm, pc,
 * em/rem (16px) and percentages of 16px; returns null otherwise.
 */
export function lengthToPx(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = /^(-?[\d.]+)\s*(px|pt|in|cm|mm|pc|em|rem|%)?$/i.exec(input.trim());
  if (!match || !match[1]) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  switch ((match[2] ?? 'px').toLowerCase()) {
    case 'px':
      return amount;
    case 'pt':
      return (amount * 96) / 72;
    case 'in':
      return amount * 96;
    case 'cm':
      return (amount * 96) / 2.54;
    case 'mm':
      return (amount * 96) / 25.4;
    case 'pc':
      return amount * 16;
    case 'em':
    case 'rem':
      return amount * 16;
    case '%':
      return (amount / 100) * 16;
    default:
      return null;
  }
}

const SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
};

/** `<font size="1…7">` equivalents in px. */
const FONT_TAG_SIZES = [10, 13, 16, 18, 24, 32, 48];

export function fontSizeToPx(input: string | null | undefined): number | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  return SIZE_KEYWORDS[value] ?? lengthToPx(value);
}

export function fontTagSizeToPx(input: string | null | undefined): number | null {
  if (!input) return null;
  const size = Number.parseInt(input, 10);
  if (!Number.isFinite(size)) return null;
  return FONT_TAG_SIZES[Math.min(7, Math.max(1, size)) - 1] ?? null;
}

export function isBoldWeight(value: string | undefined): boolean | null {
  if (!value) return null;
  const weight = value.trim().toLowerCase();
  if (weight === 'bold' || weight === 'bolder') return true;
  if (weight === 'normal' || weight === 'lighter') return false;
  const numeric = Number.parseInt(weight, 10);
  return Number.isFinite(numeric) ? numeric >= 600 : null;
}

const MONOSPACE_RE =
  /\b(monospace|consolas|menlo|monaco|courier|"?courier new"?|"?fira code"?|"?jetbrains mono"?|"?source code pro"?|"?sf mono"?|"?cascadia|"?droid sans mono"?|"?ubuntu mono"?|"?dejavu sans mono"?)/i;

export function isMonospaceFamily(value: string | undefined): boolean {
  return !!value && MONOSPACE_RE.test(value);
}
