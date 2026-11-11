/**
 * Display-name sanitisation for uploads. Storage keys are random and never
 * derived from these names; this only makes the name safe to show, to put in
 * a `Content-Disposition` header and to save on any operating system.
 */

export const MAX_FILENAME_LENGTH = 120;
const MAX_EXTENSION_LENGTH = 16;

/** Device names Windows refuses as file names, with or without an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Code point ranges removed from names: C0/C1 controls, zero-width and
 * directional formatting characters (which can disguise an extension), line
 * separators and the byte-order mark. Written as numbers so no invisible
 * character appears in this file.
 */
const STRIPPED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];

function stripInvisible(input: string): string {
  let output = '';
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!STRIPPED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)) {
      output += character;
    }
  }
  return output;
}

/** Lower-cased extension without the dot, or '' when the name has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  const extension = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(extension) ? extension : '';
}

export function replaceExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${extension}`;
}

/**
 * Returns a safe display name, or null when nothing usable remains.
 * Path components are dropped (only the last segment survives), so
 * `../../etc/passwd` becomes `passwd` and can never address a location.
 */
export function sanitizeFilename(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let name = stripInvisible(raw.normalize('NFC'));
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSeparator >= 0) name = name.slice(lastSeparator + 1);
  name = name
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (name === '') return null;
  if (RESERVED_NAME.test(name)) name = `_${name}`;

  const characters = [...name];
  if (characters.length > MAX_FILENAME_LENGTH) {
    const extension = extensionOf(name);
    if (extension && extension.length <= MAX_EXTENSION_LENGTH) {
      const keep = MAX_FILENAME_LENGTH - extension.length - 1;
      const base = [...name.slice(0, name.length - extension.length - 1)].slice(0, keep).join('');
      name = `${base.replace(/[. ]+$/, '')}.${extension}`;
    } else {
      name = characters
        .slice(0, MAX_FILENAME_LENGTH)
        .join('')
        .replace(/[. ]+$/, '');
    }
  }
  return name === '' ? null : name;
}

/**
 * `Content-Disposition` value with an ASCII fallback and an RFC 5987 encoded
 * UTF-8 name. The input must already be sanitised.
 */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = [...name]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code < 0x7f && character !== '"' && character !== '\\'
        ? character
        : '_';
    })
    .join('');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
