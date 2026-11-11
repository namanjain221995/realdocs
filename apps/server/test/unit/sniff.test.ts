import { describe, expect, it } from 'vitest';
import {
  attachmentContentMatches,
  isPdf,
  isZip,
  looksLikeSvg,
  sniffRaster,
} from '../../src/assets/sniff';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));

const PNG_HEAD = bytes(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
  0x49,
  0x48,
  0x44,
  0x52,
  0,
  0,
  0,
  1,
);

describe('sniffRaster', () => {
  it('recognises the four raster formats by magic bytes', () => {
    expect(sniffRaster(PNG_HEAD)).toEqual({ mime: 'image/png', extension: 'png' });
    expect(sniffRaster(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16))).toEqual({
      mime: 'image/jpeg',
      extension: 'jpg',
    });
    expect(sniffRaster(text('GIF89a....'))).toEqual({ mime: 'image/gif', extension: 'gif' });
    expect(sniffRaster(text('GIF87a....'))).toEqual({ mime: 'image/gif', extension: 'gif' });
    expect(sniffRaster(text('RIFF\0\0\0\0WEBPVP8 '))).toEqual({
      mime: 'image/webp',
      extension: 'webp',
    });
  });

  it('does not trust near misses', () => {
    // PNG signature without an IHDR chunk.
    expect(
      sniffRaster(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4)),
    ).toBeNull();
    expect(sniffRaster(text('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(sniffRaster(text('GIF90a'))).toBeNull();
    expect(sniffRaster(text('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffRaster(text('MZ\x90\0\x03'))).toBeNull();
    expect(sniffRaster(bytes())).toBeNull();
  });
});

describe('looksLikeSvg', () => {
  it('finds the svg root behind declarations, comments and a doctype', () => {
    expect(looksLikeSvg(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
    expect(looksLikeSvg(text('  \n<?xml version="1.0"?>\n<!-- c --><svg>'))).toBe(true);
    expect(looksLikeSvg(text('<!DOCTYPE svg [<!ENTITY a "b">]><svg>'))).toBe(true);
    // UTF-8 byte-order mark in front.
    expect(looksLikeSvg(new Uint8Array([0xef, 0xbb, 0xbf, ...text('<svg/>')]))).toBe(true);
  });

  it('rejects other markup', () => {
    expect(looksLikeSvg(text('<html><svg/></html>'))).toBe(false);
    expect(looksLikeSvg(text('<svgx/>'))).toBe(false);
    expect(looksLikeSvg(text('hello <svg/>'))).toBe(false);
    expect(looksLikeSvg(PNG_HEAD)).toBe(false);
  });
});

describe('attachment content checks', () => {
  it('requires a PDF header for .pdf', () => {
    expect(isPdf(text('%PDF-1.7\n...'))).toBe(true);
    expect(attachmentContentMatches('pdf', text('%PDF-1.4'))).toBe(true);
    expect(attachmentContentMatches('pdf', text('<script>alert(1)</script>'))).toBe(false);
    expect(attachmentContentMatches('pdf', text('MZ this is an exe'))).toBe(false);
  });

  it('requires a ZIP container for archive and office formats', () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04, 20, 0);
    expect(isZip(zip)).toBe(true);
    for (const extension of ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'] as const) {
      expect(attachmentContentMatches(extension, zip)).toBe(true);
      expect(attachmentContentMatches(extension, text('not a zip'))).toBe(false);
    }
  });

  it('requires text formats to be free of NUL bytes and RTF to start like RTF', () => {
    expect(attachmentContentMatches('txt', text('plain text ✓'))).toBe(true);
    expect(attachmentContentMatches('csv', text('a,b\n1,2\n'))).toBe(true);
    expect(attachmentContentMatches('json', bytes(0x7b, 0x00, 0x7d))).toBe(false);
    expect(attachmentContentMatches('txt', bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(attachmentContentMatches('rtf', text('{\\rtf1\\ansi hello}'))).toBe(true);
    expect(attachmentContentMatches('rtf', text('hello'))).toBe(false);
  });
});
