/**
 * Generated document title of an interview session:
 * `{Candidate_Name}_{Company_Name}_Round_{N}_{YYYY-MM-DD_HH-mm}`, with the
 * date and time in the session's own time zone. Pure functions; the caller
 * decides what to do about a title that is already taken.
 */
import { randomInt } from 'node:crypto';

export const TITLE_MAX_LENGTH = 120;
/** `_` plus four characters. */
export const COLLISION_SUFFIX_LENGTH = 5;

const SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// eslint-disable-next-line no-control-regex
const CONTROL_OR_UNSAFE = /[\u0000-\u001f\u007f-\u009f/\\:*?"<>|]/gu;
// Zero-width and bidirectional formatting characters can make two titles look identical.
// Every format character (category Cf) is removed: all bidirectional controls and
// isolates, zero-width characters, soft hyphen, byte-order mark.
const INVISIBLE = /\p{Cf}/gu;

/** One name part: NFC, no unsafe characters, whitespace runs as `_`, no repeated or edge `_`. */
export function sanitizeTitlePart(text: string): string {
  return text
    .normalize('NFC')
    .replace(CONTROL_OR_UNSAFE, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[_.]+|[_.]+$/gu, '');
}

/** Cuts to `max` code points without splitting a character. */
function clip(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return characters
    .slice(0, Math.max(0, max))
    .join('')
    .replace(/[_.]+$/u, '');
}

/** `YYYY-MM-DD_HH-mm` of an instant in an IANA time zone. */
export function formatTitleDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}`;
}

export interface TitleInput {
  candidateName: string;
  companyName: string;
  roundNumber: number;
  scheduledAt: Date;
  timezone: string;
}

/**
 * Builds the title. When it would exceed `maxLength`, the candidate and
 * company parts are shortened (the longer one first); the round and the date
 * are never cut.
 */
export function generateTitle(input: TitleInput, maxLength: number = TITLE_MAX_LENGTH): string {
  const tail = `Round_${input.roundNumber}_${formatTitleDate(input.scheduledAt, input.timezone)}`;
  let name = sanitizeTitlePart(input.candidateName) || 'Candidate';
  let company = sanitizeTitlePart(input.companyName) || 'Company';
  // Two separators between the three parts.
  const budget = Math.max(2, maxLength - tail.length - 2);
  while (Array.from(name).length + Array.from(company).length > budget) {
    const nameLength = Array.from(name).length;
    const companyLength = Array.from(company).length;
    if (nameLength >= companyLength && nameLength > 1)
      name = clip(name, nameLength - 1) || name.slice(0, 1);
    else if (companyLength > 1) company = clip(company, companyLength - 1) || company.slice(0, 1);
    else break;
  }
  return `${name}_${company}_${tail}`;
}

/** Four random base32 characters. */
export function collisionSuffix(): string {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return suffix;
}

/**
 * Title that is not in `taken` (compared case-insensitively): the plain title
 * when free, otherwise a title shortened to leave room for `_XXXX`.
 */
export function uniqueTitle(
  input: TitleInput,
  isTaken: (title: string) => Promise<boolean> | boolean,
): Promise<string> {
  return (async () => {
    const plain = generateTitle(input);
    if (!(await isTaken(plain))) return plain;
    const shortened = generateTitle(input, TITLE_MAX_LENGTH - COLLISION_SUFFIX_LENGTH);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `${shortened}_${collisionSuffix()}`;
      if (!(await isTaken(candidate))) return candidate;
    }
    return `${shortened}_${collisionSuffix()}${collisionSuffix()}`.slice(0, 200);
  })();
}
