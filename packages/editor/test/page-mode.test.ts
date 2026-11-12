import { describe, expect, it } from 'vitest';
import { resolvePageMode } from '../src/page/mode';

describe('resolvePageMode', () => {
  it('web editor and viewer draw the sheet unless the host asks for the reading layout', () => {
    expect(resolvePageMode({ variant: 'editor' })).toBe('page');
    expect(resolvePageMode({ variant: 'viewer', layout: 'page' })).toBe('page');
    expect(resolvePageMode({ variant: 'editor', layout: 'reading' })).toBe('none');
  });

  it('pageMargins does not change the web variants', () => {
    expect(resolvePageMode({ variant: 'editor', pageMargins: true })).toBe('page');
    expect(resolvePageMode({ variant: 'viewer', layout: 'reading', pageMargins: true })).toBe(
      'none',
    );
  });

  it('the panel never draws the sheet; it takes the margins only when asked', () => {
    expect(resolvePageMode({ variant: 'panel' })).toBe('none');
    expect(resolvePageMode({ variant: 'panel', layout: 'page' })).toBe('none');
    expect(resolvePageMode({ variant: 'panel', pageMargins: true })).toBe('margins');
  });
});
