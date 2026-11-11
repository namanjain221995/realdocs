// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as kit from '../src/index';
import { cx } from '../src/index';

describe('cx', () => {
  it('joins strings and drops falsy parts', () => {
    expect(cx('rd-btn', false, null, undefined, '', 0, 'is-open')).toBe('rd-btn is-open');
    expect(cx()).toBe('');
    expect(cx(null, undefined, false)).toBe('');
  });

  it('keeps conditional classes written with &&', () => {
    const primary = true;
    const loading = false;
    expect(cx('rd-btn', primary && 'rd-btn--primary', loading && 'is-loading')).toBe(
      'rd-btn rd-btn--primary',
    );
  });

  it('flattens arrays, however deep', () => {
    expect(cx(['a', ['b', [null, 'c']]], 'd')).toBe('a b c d');
    expect(cx([])).toBe('');
  });

  it('keeps the keys of an object whose values are truthy', () => {
    expect(cx('a', { b: true, c: false, d: 1, e: 0, f: 'yes', g: null })).toBe('a b d f');
    expect(cx({})).toBe('');
  });

  it('accepts numbers and ignores a bare true', () => {
    expect(cx('col', 3, true)).toBe('col 3');
  });

  it('does not add stray spaces', () => {
    expect(cx('  a', 'b  ')).toBe('  a b  ');
    expect(cx('a', '', 'b')).toBe('a b');
  });
});

/** Added after the first contract, at the request of the apps that use the kit. */
const ADDED_EXPORTS = [
  'Link',
  'OverlayProvider',
  'Sheet',
  'useFocusTrap',
  'useOutsidePress',
  'useOverlayFocus',
  'useOverlayLayer',
  'useScrollLock',
];

describe('public API', () => {
  // The export names are a contract with the other packages. A change here is
  // a breaking change for them, so it has to be made on purpose.
  it('exports exactly the agreed names', () => {
    expect(Object.keys(kit).sort()).toEqual(
      [
        ...ADDED_EXPORTS,
        'Avatar',
        'AvatarStack',
        'Badge',
        'Banner',
        'Button',
        'Card',
        'Checkbox',
        'ConfirmDialog',
        'CopyField',
        'Dialog',
        'Divider',
        'DropdownMenu',
        'EmptyState',
        'ErrorState',
        'Field',
        'IconButton',
        'Kbd',
        'LinkButton',
        'Menu',
        'MenuItem',
        'MenuLabel',
        'MenuSeparator',
        'Popover',
        'ScrollArea',
        'SegmentedControl',
        'Select',
        'Skeleton',
        'Slider',
        'Spinner',
        'StatusDot',
        'Switch',
        'TabPanel',
        'Tabs',
        'TextArea',
        'TextField',
        'ThemeProvider',
        'ToastProvider',
        'Toolbar',
        'ToolbarGroup',
        'ToolbarSeparator',
        'Tooltip',
        'VisuallyHidden',
        'copyText',
        'cx',
        'useTheme',
        'useToast',
      ].sort(),
    );
  });

  it('re-exports nothing from lucide', () => {
    for (const name of ['X', 'Check', 'ChevronDown', 'Copy', 'icons', 'createLucideIcon']) {
      expect(name in kit).toBe(false);
    }
  });
});
