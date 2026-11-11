// @vitest-environment jsdom
/**
 * Link safety in the UI layer: what a person types into the link editor, what
 * a click on a link in the document does, and what may be handed to the host
 * or to `window.open`.
 */
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternalLink } from '../src/react/DocumentEditor';
import { LINK_ERROR, normalizeLinkInput } from '../src/react/LinkPopover';
import { createTestEditor, type TestEditor } from './editor-helpers';

let current: TestEditor | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
  vi.restoreAllMocks();
});

const UNSAFE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tscript:alert(1)',
  '\u0001javascript:alert(1)',
  'jav​ascript:alert(1)',
  'javascript :alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'file:///etc/passwd',
  'blob:https://example.com/9d5f1c1e-0000-4000-8000-000000000000',
  'about:blank',
  'chrome://settings',
  'ms-msdt:/id',
  'intent://scan/#Intent;scheme=zxing;end',
  'ftp://example.com/file',
  '//evil.example/path',
  '/relative/path',
  '#fragment',
  'https://',
  'not a url',
  '',
  '   ',
];

describe('normalizeLinkInput (link editor)', () => {
  it('accepts web addresses and normalises them', () => {
    expect(normalizeLinkInput('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(normalizeLinkInput('  http://example.com  ')).toBe('http://example.com/');
    expect(normalizeLinkInput('HTTPS://EXAMPLE.COM/Path')).toBe('https://example.com/Path');
  });

  it('upgrades a bare domain to https and a bare address to mailto', () => {
    expect(normalizeLinkInput('example.com/plan')).toBe('https://example.com/plan');
    expect(normalizeLinkInput('docs.example.co.uk')).toBe('https://docs.example.co.uk/');
    expect(normalizeLinkInput('asha@example.com')).toBe('mailto:asha@example.com');
    expect(normalizeLinkInput('mailto:asha@example.com?subject=Hi')).toBe(
      'mailto:asha@example.com?subject=Hi',
    );
    expect(normalizeLinkInput('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it.each(UNSAFE)('rejects %j', (value) => {
    expect(normalizeLinkInput(value)).toBeNull();
  });

  it('rejects addresses longer than the limit', () => {
    expect(normalizeLinkInput(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });

  it('explains what is accepted', () => {
    expect(LINK_ERROR).toContain('https://');
    expect(LINK_ERROR).toContain('mailto:');
  });
});

describe('openExternalLink', () => {
  it('never opens or forwards an unsafe address', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = vi.fn(() => true);
    for (const value of UNSAFE) {
      openExternalLink(value, host);
      openExternalLink(value, undefined);
    }
    expect(host).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('hands the sanitized address to the host and stops when the host handled it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = vi.fn(() => true);
    openExternalLink('example.com/x', host);
    expect(host).toHaveBeenCalledExactlyOnceWith('https://example.com/x');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a new tab without an opener when no host handles the link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternalLink('https://example.com/a', undefined);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/a',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockClear();
    openExternalLink('https://example.com/b', () => false);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/b',
      '_blank',
      'noopener,noreferrer',
    );
  });
});

const linked = (href: string, label: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] }],
});

function click(
  target: Element,
  init: MouseEventInit = {},
  type: 'click' | 'auxclick' = 'click',
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('links in the document', () => {
  const DOC: JSONContent = {
    type: 'doc',
    content: [
      linked('https://example.com/safe', 'safe'),
      // Written by another client, bypassing every check of this editor.
      linked('javascript:window.__pwned=1', 'hostile'),
      linked('data:text/html,<script>window.__pwned=2</script>', 'data'),
    ],
  };

  const anchor = (t: TestEditor, label: string): HTMLAnchorElement => {
    const found = [...t.editor.view.dom.querySelectorAll('a')].find(
      (element) => element.textContent === label,
    );
    if (!found) throw new Error(`no link "${label}"`);
    return found;
  };

  it('renders no unsafe scheme into the page, whatever the document contains', () => {
    current = createTestEditor({ content: DOC });
    const hrefs = [...current.editor.view.dom.querySelectorAll('a')].map(
      (element) => element.getAttribute('href') ?? '',
    );
    expect(hrefs).toHaveLength(3);
    expect(hrefs[0]).toBe('https://example.com/safe');
    for (const href of hrefs) expect(href).not.toMatch(/javascript:|data:/i);
    // Links never navigate the editor's own window.
    for (const element of current.editor.view.dom.querySelectorAll('a')) {
      expect(element.getAttribute('target')).toBe('_blank');
      expect(element.getAttribute('rel')).toContain('noopener');
    }
  });

  it('opens the link editor on a plain click while editing, and never navigates', () => {
    current = createTestEditor({ content: DOC });
    const event = click(anchor(current, 'safe'));
    expect(event.defaultPrevented).toBe(true);
    expect(current.activated).toEqual([anchor(current, 'safe')]);
    expect(current.opened).toEqual([]);
  });

  it('opens the sanitized address on Ctrl-, Cmd- and middle-click', () => {
    current = createTestEditor({ content: DOC });
    const safe = anchor(current, 'safe');
    expect(click(safe, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click(safe, { metaKey: true }).defaultPrevented).toBe(true);
    expect(click(safe, { button: 1 }, 'auxclick').defaultPrevented).toBe(true);
    expect(current.opened).toEqual([
      'https://example.com/safe',
      'https://example.com/safe',
      'https://example.com/safe',
    ]);
    expect(current.activated).toEqual([]);
  });

  it('opens the address on a plain click for a reader', () => {
    current = createTestEditor({ content: DOC, canEdit: false });
    const event = click(anchor(current, 'safe'));
    expect(event.defaultPrevented).toBe(true);
    expect(current.opened).toEqual(['https://example.com/safe']);
    expect(current.activated).toEqual([]);
  });

  it('does nothing for a link with an unsafe address, for editors and readers', () => {
    for (const canEdit of [true, false]) {
      const t = createTestEditor({ content: DOC, canEdit });
      for (const label of ['hostile', 'data']) {
        const target = anchor(t, label);
        for (const event of [
          click(target),
          click(target, { ctrlKey: true }),
          click(target, { button: 1 }, 'auxclick'),
        ]) {
          expect(event.defaultPrevented).toBe(true);
        }
      }
      expect(t.opened).toEqual([]);
      expect(t.activated).toEqual([]);
      t.destroy();
    }
    expect((window as { __pwned?: unknown }).__pwned).toBeUndefined();
  });

  it('sanitizes the address at click time, even if the page was tampered with', () => {
    for (const canEdit of [true, false]) {
      const t = createTestEditor({ content: DOC, canEdit });
      const target = anchor(t, 'safe');
      // Not something the editor renders: a browser extension or a bug elsewhere changed the DOM.
      target.setAttribute('href', 'javascript:window.__pwned=3');
      expect(click(target).defaultPrevented).toBe(true);
      expect(click(target, { ctrlKey: true }).defaultPrevented).toBe(true);
      target.setAttribute('href', ' JAVASCRIPT:window.__pwned=4');
      expect(click(target, { button: 1 }, 'auxclick').defaultPrevented).toBe(true);
      expect(t.opened).toEqual([]);
      expect(t.activated).toEqual([]);
      t.destroy();
    }
    expect((window as { __pwned?: unknown }).__pwned).toBeUndefined();
  });

  it('refuses unsafe addresses in the link commands the toolbar uses', () => {
    current = createTestEditor({
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pick me' }] }],
      },
    });
    const { editor } = current;
    editor.commands.selectAll();
    editor.commands.setLink({ href: 'javascript:alert(1)' });
    expect(JSON.stringify(editor.getJSON())).not.toContain('javascript');
    editor.commands.setLink({ href: 'https://example.com/ok' });
    expect(JSON.stringify(editor.getJSON())).toContain('https://example.com/ok');
  });

  it('does not treat a download link of an attachment as a document link', () => {
    current = createTestEditor({ content: DOC });
    const { dom } = current.editor.view;
    const download = document.createElement('a');
    download.setAttribute('href', '/api/documents/x/assets/y?download=1');
    download.setAttribute('data-rd-download', '');
    dom.append(download);
    // Observe the event after the editor's handlers ran, then stop it (jsdom cannot navigate).
    let preventedByEditor: boolean | null = null;
    document.addEventListener(
      'click',
      (event) => {
        preventedByEditor = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    click(download);
    // Left to the browser (a same-origin download), not routed through the link handler.
    expect(preventedByEditor).toBe(false);
    expect(current.opened).toEqual([]);
    expect(current.activated).toEqual([]);
    download.remove();
  });
});
