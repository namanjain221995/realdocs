import { describe, expect, it } from 'vitest';
import {
  contentHeightMm,
  contentWidthMm,
  DEFAULT_PAGE_SETTINGS,
  formatMeasurement,
  marginProblem,
  maxMarginMm,
  mmToPx,
  normalizePageSettings,
  pageDimensionsMm,
  pageRuleCss,
  parseMeasurement,
  snapMm,
  type PageSettings,
} from '../src/page';

describe('normalizePageSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const raw of [undefined, null, 5, 'a4', [], [1, 2], true, () => 1]) {
      expect(normalizePageSettings(raw)).toEqual(DEFAULT_PAGE_SETTINGS);
    }
    expect(normalizePageSettings({})).toEqual(DEFAULT_PAGE_SETTINGS);
  });

  it('replaces hostile values with defaults and never throws', () => {
    const hostile = {
      size: 'url(javascript:alert(1))',
      orientation: { toString: () => 'landscape' },
      marginTop: '25',
      marginRight: NaN,
      marginBottom: Infinity,
      marginLeft: -Infinity,
      unit: 'px',
      background: 'red; background-image: url(//evil)',
      headerSpacing: null,
      footerSpacing: {},
      __proto__: { size: 'letter' },
      constructor: 'x',
    };
    expect(normalizePageSettings(hostile)).toEqual(DEFAULT_PAGE_SETTINGS);
  });

  it('clamps and rounds lengths', () => {
    const s = normalizePageSettings({
      marginTop: -5,
      marginRight: 12.345,
      marginBottom: 1e9,
      marginLeft: 20,
      headerSpacing: 99,
      footerSpacing: 0.04,
    });
    expect(s.marginTop).toBe(0);
    expect(s.marginRight).toBe(12.3);
    expect(s.marginBottom).toBe(100);
    expect(s.headerSpacing).toBe(50);
    expect(s.footerSpacing).toBe(0);
  });

  it('keeps a text area of at least 50 mm in both directions', () => {
    const s = normalizePageSettings({
      marginLeft: 100,
      marginRight: 100,
      marginTop: 100,
      marginBottom: 100,
    });
    expect(contentWidthMm(s)).toBeGreaterThanOrEqual(50);
    expect(contentHeightMm(s)).toBeGreaterThanOrEqual(50);
    expect(s.marginLeft).toBe(s.marginRight);
    // Landscape letter is 279.4 x 215.9.
    const l = normalizePageSettings({
      size: 'letter',
      orientation: 'landscape',
      marginLeft: 100,
      marginRight: 100,
      marginTop: 100,
      marginBottom: 100,
    });
    expect(contentWidthMm(l)).toBeGreaterThanOrEqual(50);
    expect(contentHeightMm(l)).toBeGreaterThanOrEqual(50);
  });

  it('is idempotent', () => {
    const once = normalizePageSettings({ marginLeft: 99.99, marginRight: 77, size: 'letter' });
    expect(normalizePageSettings(once)).toEqual(once);
  });

  it('switching orientation re-applies the minimum', () => {
    const portrait = normalizePageSettings({ marginTop: 100, marginBottom: 90 });
    expect(contentHeightMm(portrait)).toBeGreaterThanOrEqual(50);
    const landscape = normalizePageSettings({ ...portrait, orientation: 'landscape' });
    expect(contentHeightMm(landscape)).toBeGreaterThanOrEqual(50);
  });
});

describe('dimensions and units', () => {
  it('knows paper sizes and orientation', () => {
    expect(pageDimensionsMm({ size: 'a4', orientation: 'portrait' })).toEqual({
      width: 210,
      height: 297,
    });
    expect(pageDimensionsMm({ size: 'letter', orientation: 'landscape' })).toEqual({
      width: 279.4,
      height: 215.9,
    });
  });

  it('converts millimetres to CSS pixels at 96 dpi', () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 10);
    expect(mmToPx(210)).toBeCloseTo(793.7, 1);
  });

  it('formats in either unit', () => {
    expect(formatMeasurement(25.4, 'mm')).toBe('25.4 mm');
    expect(formatMeasurement(20, 'mm')).toBe('20 mm');
    expect(formatMeasurement(25.4, 'in')).toBe('1 in');
    expect(formatMeasurement(19.1, 'in')).toBe('0.75 in');
    expect(formatMeasurement(NaN, 'mm')).toBe('0 mm');
  });

  it('parses typed lengths', () => {
    expect(parseMeasurement('25.4', 'mm')).toBe(25.4);
    expect(parseMeasurement('1', 'in')).toBe(25.4);
    expect(parseMeasurement('1in', 'mm')).toBe(25.4);
    expect(parseMeasurement('1"', 'mm')).toBe(25.4);
    expect(parseMeasurement(' 2,5 cm ', 'in')).toBe(25);
    expect(parseMeasurement('12 mm', 'in')).toBe(12);
    expect(parseMeasurement('.5in', 'mm')).toBe(12.7);
  });

  it('rejects text that is not a non-negative length', () => {
    for (const text of ['', ' ', 'abc', '-3', '1e3', '1 px', '1..2', '10 mm mm', '∞', '1/4']) {
      expect(parseMeasurement(text, 'mm')).toBeNull();
    }
  });

  it('round-trips format and parse', () => {
    for (const mm of [0, 6.4, 12.7, 19.1, 25.4, 100]) {
      expect(parseMeasurement(formatMeasurement(mm, 'mm'), 'mm')).toBe(mm);
    }
    expect(parseMeasurement(formatMeasurement(25.4, 'in'), 'mm')).toBe(25.4);
  });
});

describe('snapping', () => {
  it('snaps to whole millimetres', () => {
    expect(snapMm(25.4, 'mm')).toBe(25);
    expect(snapMm(25.6, 'mm')).toBe(26);
    expect(snapMm(-3, 'mm')).toBe(-3);
    expect(snapMm(NaN, 'mm')).toBe(0);
  });

  it('snaps to sixteenths of an inch', () => {
    expect(snapMm(25.4, 'in')).toBe(25.4);
    expect(snapMm(12.7, 'in')).toBe(12.7);
    expect(snapMm(1.6, 'in')).toBe(1.6);
    expect(snapMm(2.4, 'in')).toBe(3.2);
    expect(snapMm(0.4, 'in')).toBe(0);
  });
});

describe('margin helpers', () => {
  const base: PageSettings = { ...DEFAULT_PAGE_SETTINGS };

  it('explains invalid margins', () => {
    expect(marginProblem(base, 'marginLeft', null)).toMatch(/Enter a length/);
    expect(marginProblem(base, 'marginLeft', 101)).toMatch(/more than 100/);
    expect(marginProblem(base, 'marginLeft', 20)).toBeNull();
    expect(marginProblem({ ...base, marginRight: 90 }, 'marginLeft', 80)).toMatch(/50 mm wide/);
    expect(
      marginProblem({ ...base, orientation: 'landscape', marginBottom: 100 }, 'marginTop', 100),
    ).toMatch(/50 mm high/);
  });

  it('computes the room left for a margin', () => {
    expect(maxMarginMm({ ...base, marginRight: 100 }, 'marginLeft')).toBe(60);
    expect(maxMarginMm(base, 'marginLeft')).toBe(100);
  });

  it('writes an @page rule from numbers and keywords only', () => {
    expect(pageRuleCss({ ...base, size: 'letter', orientation: 'landscape' })).toBe(
      '@page { size: letter landscape; margin: 25.4mm 25.4mm 25.4mm 25.4mm; }',
    );
  });
});
