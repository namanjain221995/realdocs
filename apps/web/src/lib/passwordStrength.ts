/**
 * A strength *hint* for new passwords. The only hard rule is the minimum
 * length (enforced again by the server); everything else here is advice, so
 * the estimate is deliberately simple and explains itself.
 */

export type PasswordStrengthLevel = 'too_short' | 'weak' | 'fair' | 'strong';

export interface PasswordStrength {
  level: PasswordStrengthLevel;
  /** 0 – 3, for a meter. */
  score: 0 | 1 | 2 | 3;
  label: string;
  /** One sentence of advice. */
  hint: string;
}

const COMMON_FRAGMENTS = [
  'password',
  'passwort',
  'qwerty',
  'azerty',
  'letmein',
  'welcome',
  'admin',
  'iloveyou',
  'realtimedocs',
  '123456',
  'abcdef',
];

function characterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

/** True for "aaaaaaaaaaaa", "abababababab" and similar short repeats. */
function isRepetitive(password: string): boolean {
  if (new Set(password).size <= 3) return true;
  for (let unit = 1; unit <= 4; unit += 1) {
    if (password.length >= unit * 3) {
      const chunk = password.slice(0, unit);
      if (chunk.repeat(Math.ceil(password.length / unit)).slice(0, password.length) === password) {
        return true;
      }
    }
  }
  return false;
}

/** Counts characters that continue an ascending or descending run ("abcd", "9876"). */
function sequentialShare(password: string): number {
  if (password.length < 2) return 0;
  let sequential = 0;
  for (let index = 1; index < password.length; index += 1) {
    const delta = password.charCodeAt(index) - password.charCodeAt(index - 1);
    if (delta === 1 || delta === -1) sequential += 1;
  }
  return sequential / (password.length - 1);
}

export function estimatePasswordStrength(
  password: string,
  minLength: number,
  personal: readonly string[] = [],
): PasswordStrength {
  const length = [...password].length;
  if (length < minLength) {
    const missing = minLength - length;
    return {
      level: 'too_short',
      score: 0,
      label: 'Too short',
      hint:
        length === 0
          ? `Use at least ${minLength} characters.`
          : `Add ${missing} more ${missing === 1 ? 'character' : 'characters'}.`,
    };
  }

  const lower = password.toLowerCase();
  const containsCommon = COMMON_FRAGMENTS.some((fragment) => lower.includes(fragment));
  const containsPersonal = personal
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 3)
    .some((value) => lower.includes(value));

  if (isRepetitive(password) || sequentialShare(password) > 0.6) {
    return {
      level: 'weak',
      score: 1,
      label: 'Weak',
      hint: 'Avoid repeated characters and runs such as "abcdef" or "123456".',
    };
  }
  if (containsCommon || containsPersonal) {
    return {
      level: 'weak',
      score: 1,
      label: 'Weak',
      hint: containsPersonal
        ? 'Leave your name and email address out of the password.'
        : 'Avoid common words such as "password".',
    };
  }

  const classes = characterClasses(password);
  const words = password
    .trim()
    .split(/[\s\-_.]+/)
    .filter((word) => word.length >= 3).length;
  if (length >= 20 || (length >= 16 && (classes >= 3 || words >= 3))) {
    return {
      level: 'strong',
      score: 3,
      label: 'Strong',
      hint: 'Long and varied. Keep it in a password manager.',
    };
  }
  if (length >= 14 || classes >= 3) {
    return {
      level: 'fair',
      score: 2,
      label: 'Fair',
      hint: 'Longer is stronger: several unrelated words make a good passphrase.',
    };
  }
  return {
    level: 'weak',
    score: 1,
    label: 'Weak',
    hint: 'Make it longer, or mix in unrelated words, numbers and symbols.',
  };
}
