import { describe, expect, it } from 'vitest';
import {
  MAX_FILENAME_LENGTH,
  contentDisposition,
  extensionOf,
  replaceExtension,
  sanitizeFilename,
} from '../../src/assets/filename';

const fromCodePoints = (...points: number[]) => String.fromCodePoint(...points);

describe('sanitizeFilename', () => {
  it('keeps ordinary names, including Unicode', () => {
    expect(sanitizeFilename('Quarterly report (final).pdf')).toBe('Quarterly report (final).pdf');
    expect(sanitizeFilename('रिपोर्ट 2026.docx')).toBe('रिपोर्ट 2026.docx');
    expect(sanitizeFilename('photo 🚀.png')).toBe('photo 🚀.png');
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\Windows\\System32\\config.sys', 'config.sys'],
    ['/absolute/path/to/file.txt', 'file.txt'],
    ['C:\\Users\\me\\Desktop\\notes.md', 'notes.md'],
    ['a/b/../../c.png', 'c.png'],
    ['....//....//secret.txt', 'secret.txt'],
  ])('drops path components from %j', (input, expected) => {
    const result = sanitizeFilename(input);
    expect(result).toBe(expected);
    expect(result).not.toMatch(/[/\\]/);
  });

  it('removes control characters, NUL bytes and line breaks', () => {
    const nul = fromCodePoints(0);
    expect(sanitizeFilename(`evil${nul}.png.exe`)).toBe('evil.png.exe');
    expect(sanitizeFilename('line\r\nbreak\t.txt')).toBe('linebreak.txt');
    expect(sanitizeFilename(`bell${fromCodePoints(7)}name.pdf`)).toBe('bellname.pdf');
  });

  it('removes direction overrides that can disguise an extension', () => {
    const rlo = fromCodePoints(0x202e);
    // "invoice<RLO>fdp.exe" would be displayed as "invoiceexe.pdf".
    expect(sanitizeFilename(`invoice${rlo}fdp.exe`)).toBe('invoicefdp.exe');
    expect(sanitizeFilename(`a${fromCodePoints(0x200b)}b${fromCodePoints(0xfeff)}.txt`)).toBe(
      'ab.txt',
    );
  });

  it('neutralises names that are special on Windows', () => {
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('nul.txt')).toBe('_nul.txt');
    expect(sanitizeFilename('LPT1.pdf')).toBe('_LPT1.pdf');
    expect(sanitizeFilename('a<b>c:d"e|f?g*.txt')).toBe('a_b_c_d_e_f_g_.txt');
  });

  it('strips leading dots and trailing dots or spaces', () => {
    expect(sanitizeFilename('.htaccess')).toBe('htaccess');
    expect(sanitizeFilename('...hidden.txt')).toBe('hidden.txt');
    expect(sanitizeFilename('name.txt. . .')).toBe('name.txt');
    expect(sanitizeFilename('  spaced   out  .md ')).toBe('spaced out .md');
  });

  it.each(['', '   ', '.', '..', '../', '/', '\\', '...', fromCodePoints(0, 1, 2)])(
    'returns null when nothing usable remains (%j)',
    (input) => {
      expect(sanitizeFilename(input)).toBeNull();
    },
  );

  it('returns null for non-strings', () => {
    expect(sanitizeFilename(undefined)).toBeNull();
    expect(sanitizeFilename(42)).toBeNull();
    expect(sanitizeFilename({ toString: () => 'x.png' })).toBeNull();
  });

  it('caps the length and keeps the extension', () => {
    const long = `${'a'.repeat(500)}.pdf`;
    const result = sanitizeFilename(long);
    expect(result).not.toBeNull();
    expect([...(result ?? '')].length).toBe(MAX_FILENAME_LENGTH);
    expect(result?.endsWith('.pdf')).toBe(true);
    expect([...(sanitizeFilename('x'.repeat(500)) ?? '')].length).toBe(MAX_FILENAME_LENGTH);
  });
});

describe('extension helpers', () => {
  it('reads the lower-cased extension', () => {
    expect(extensionOf('Photo.JPG')).toBe('jpg');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
    expect(extensionOf('weird.ex e')).toBe('');
  });

  it('replaces or appends an extension', () => {
    expect(replaceExtension('photo.pdf', 'png')).toBe('photo.png');
    expect(replaceExtension('photo', 'png')).toBe('photo.png');
  });
});

describe('contentDisposition', () => {
  it('produces an ASCII fallback and an RFC 5987 name', () => {
    expect(contentDisposition('attachment', 'report.pdf')).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf',
    );
    const value = contentDisposition('inline', 'naïve "quote" (1).png');
    expect(value).toContain('filename="na_ve _quote_ (1).png"');
    expect(value).toContain("filename*=UTF-8''na%C3%AFve%20%22quote%22%20%281%29.png");
    // Nothing that could start a new header or parameter.
    expect(value).not.toMatch(/[\r\n]/);
  });
});
