import { DEFAULT_LIMITS } from '@realtimedocs/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftFileName } from '../src/features/drafts/DraftPreviewDialog';
import {
  clampFontScale,
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_KEY,
  FOLLOW_LATEST_KEY,
  isDefaultDisplayPreferences,
  parseDisplayPreferences,
  readFollowLatest,
  resetDisplayPreferencesCacheForTests,
  setDisplayPreferences,
  writeFollowLatest,
} from '../src/lib/displayPreferences';
import { pageTitle } from '../src/lib/hooks';
import { documentPath, documentPrintPath, loginPathFor, safeNextPath } from '../src/lib/navigation';
import { estimatePasswordStrength } from '../src/lib/passwordStrength';

const ORIGIN = 'https://docs.example.test';
const DOCUMENT = '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9';

describe('safeNextPath', () => {
  it('accepts paths inside the app, with their query and anchor', () => {
    expect(safeNextPath(`/d/${DOCUMENT}`, ORIGIN)).toBe(`/d/${DOCUMENT}`);
    expect(safeNextPath('/?view=archived&q=plan', ORIGIN)).toBe('/?view=archived&q=plan');
    expect(safeNextPath('/settings#recovery-drafts', ORIGIN)).toBe('/settings#recovery-drafts');
  });

  it.each([
    ['https://evil.example/phish'],
    ['//evil.example/phish'],
    ['/\\evil.example/phish'],
    ['javascript:alert(1)'],
    ['d/relative'],
    ['/path with space'],
    ['/tab\there'],
    [''],
  ])('falls back to the dashboard for %j', (value) => {
    expect(safeNextPath(value, ORIGIN)).toBe('/');
  });

  it('falls back when nothing was asked for', () => {
    expect(safeNextPath(null, ORIGIN)).toBe('/');
    expect(safeNextPath(undefined, ORIGIN)).toBe('/');
  });

  it('never sends someone back to the sign-in page', () => {
    expect(safeNextPath('/login?next=/settings', ORIGIN)).toBe('/');
  });
});

describe('paths', () => {
  it('builds the sign-in path with a return target', () => {
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/settings')).toBe('/login?next=%2Fsettings');
    expect(loginPathFor(`/d/${DOCUMENT}`, '?panel=share')).toBe(
      `/login?next=${encodeURIComponent(`/d/${DOCUMENT}?panel=share`)}`,
    );
  });

  it('round-trips through safeNextPath', () => {
    const login = new URL(loginPathFor(`/d/${DOCUMENT}`, '?panel=share'), ORIGIN);
    expect(safeNextPath(login.searchParams.get('next'), ORIGIN)).toBe(`/d/${DOCUMENT}?panel=share`);
  });

  it('builds document paths', () => {
    expect(documentPath(DOCUMENT)).toBe(`/d/${DOCUMENT}`);
    expect(documentPrintPath(DOCUMENT)).toBe(`/d/${DOCUMENT}/print`);
  });

  it('titles pages consistently', () => {
    expect(pageTitle('Documents')).toBe('Documents – RealtimeDocs');
    expect(pageTitle('  ')).toBe('RealtimeDocs');
    expect(pageTitle(null)).toBe('RealtimeDocs');
  });
});

describe('display preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDisplayPreferencesCacheForTests();
  });

  it('falls back to the defaults for anything it does not recognise', () => {
    expect(parseDisplayPreferences(null)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    expect(parseDisplayPreferences('big')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    expect(parseDisplayPreferences({ readingWidth: 'enormous' })).toEqual(
      DEFAULT_DISPLAY_PREFERENCES,
    );
  });

  it('keeps valid values and fills in missing ones', () => {
    expect(parseDisplayPreferences({ tone: 'light' })).toEqual({
      ...DEFAULT_DISPLAY_PREFERENCES,
      tone: 'light',
    });
  });

  it('clamps and steps the font scale', () => {
    expect(clampFontScale(5)).toBe(1.8);
    expect(clampFontScale(0.1)).toBe(0.8);
    expect(clampFontScale(1.234)).toBe(1.25);
    expect(clampFontScale(Number.NaN)).toBe(1);
    expect(parseDisplayPreferences({ fontScale: 9 }).fontScale).toBe(1.8);
  });

  it('stores only the three preference fields, in this browser', () => {
    setDisplayPreferences({ fontScale: 1.3, readingWidth: 'wide', tone: 'dark' });
    const stored = JSON.parse(
      window.localStorage.getItem(DISPLAY_PREFERENCES_KEY) ?? 'null',
    ) as unknown;
    expect(stored).toEqual({ fontScale: 1.3, readingWidth: 'wide', tone: 'dark' });
    expect(window.localStorage.length).toBe(1);
  });

  it('removes the stored value when the preferences return to the defaults', () => {
    setDisplayPreferences({ fontScale: 1.3, readingWidth: 'wide', tone: 'dark' });
    setDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES);
    expect(window.localStorage.getItem(DISPLAY_PREFERENCES_KEY)).toBeNull();
    expect(isDefaultDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES)).toBe(true);
  });
});

describe('Follow Latest', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is off until the reader turns it on, and is remembered in this browser', () => {
    expect(readFollowLatest()).toBe(false);
    writeFollowLatest(true);
    expect(readFollowLatest()).toBe(true);
    expect(window.localStorage.getItem(FOLLOW_LATEST_KEY)).toBe('true');
  });

  it('leaves nothing behind when it is turned off again', () => {
    writeFollowLatest(true);
    writeFollowLatest(false);
    expect(readFollowLatest()).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it('treats anything but a stored true as off', () => {
    window.localStorage.setItem(FOLLOW_LATEST_KEY, '"yes"');
    expect(readFollowLatest()).toBe(false);
    window.localStorage.setItem(FOLLOW_LATEST_KEY, 'not json');
    expect(readFollowLatest()).toBe(false);
  });
});

describe('draftFileName', () => {
  it('names the file after the document, in any script, without path or shell characters', () => {
    expect(draftFileName('Q3 plan: pricing / launch')).toBe(
      'Q3-plan-pricing-launch-recovery-draft.json',
    );
    expect(draftFileName('Überblick 2027')).toBe('Überblick-2027-recovery-draft.json');
    expect(draftFileName('../../etc/passwd')).toBe('etc-passwd-recovery-draft.json');
    expect(draftFileName('नमस्ते दुनिया')).toMatch(/-recovery-draft\.json$/);
  });

  it('falls back to a plain name for a title without letters or digits', () => {
    expect(draftFileName('')).toBe('document-recovery-draft.json');
    expect(draftFileName(' — … ')).toBe('document-recovery-draft.json');
  });
});

describe('estimatePasswordStrength', () => {
  const min = DEFAULT_LIMITS.passwordMinLength;

  it('says how many characters are missing', () => {
    expect(estimatePasswordStrength('', min)).toMatchObject({
      level: 'too_short',
      hint: `Use at least ${min} characters.`,
    });
    expect(estimatePasswordStrength('abcdefghijk', min)).toMatchObject({
      level: 'too_short',
      hint: 'Add 1 more character.',
    });
  });

  it('calls out repeats, runs and common words', () => {
    expect(estimatePasswordStrength('aaaaaaaaaaaaaa', min).level).toBe('weak');
    expect(estimatePasswordStrength('abcdefghijklmnop', min).level).toBe('weak');
    expect(estimatePasswordStrength('Password-2026!x', min).level).toBe('weak');
  });

  it('calls out the person’s own name or email', () => {
    const result = estimatePasswordStrength('asha.rao-notes-77', min, ['Asha Rao', 'asha.rao']);
    expect(result.level).toBe('weak');
    expect(result.hint).toMatch(/name and email/);
  });

  it('rates length and variety', () => {
    expect(estimatePasswordStrength('tulip-harbor-9', min).level).toBe('fair');
    expect(estimatePasswordStrength('copper lantern orbit sky', min).level).toBe('strong');
    expect(estimatePasswordStrength('vZ8#kq2!Lm0@xW5e', min).level).toBe('strong');
  });

  it('counts characters, not UTF-16 units', () => {
    // Twelve emoji are twelve characters even though each is two code units.
    expect(estimatePasswordStrength('🙂'.repeat(11), min).level).toBe('too_short');
  });
});
