import { describe, expect, it } from 'vitest';
import { validateSvg } from '../../src/assets/svg';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

function reason(source: string): string {
  const result = validateSvg(source);
  return result.ok ? 'ok' : result.reason;
}

describe('validateSvg: accepted documents', () => {
  it.each([
    [
      'a minimal drawing',
      `<svg ${NS} viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>`,
    ],
    [
      'an XML declaration, comments, title and description',
      `<?xml version="1.0" encoding="UTF-8"?><!-- logo --><svg ${NS} width="24" height="24"><title>Logo</title><desc>A &amp; B &#169;</desc><circle cx="12" cy="12" r="10"/></svg>`,
    ],
    [
      'gradients, clip paths and filters referenced by fragment',
      `<svg ${NS} viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><clipPath id="c"><rect width="50" height="50"/></clipPath><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="100" height="100" fill="url(#g)" clip-path="url(#c)" filter="url('#f')"/></svg>`,
    ],
    [
      '<use> of a plain shape through href and xlink:href',
      `<svg ${NS} ${XLINK}><defs><path id="p" d="M0 0h10v10z"/></defs><use href="#p"/><use xlink:href="#p" x="20"/></svg>`,
    ],
    [
      'harmless inline and embedded styles',
      `<svg ${NS}><style>.a { fill: #123456; stroke: url(#s) }</style><defs><linearGradient id="s"/></defs><text class="a" style="font-size: 12px; fill: blue" xml:space="preserve">Hello</text></svg>`,
    ],
  ])('accepts %s', (_label, source) => {
    expect(validateSvg(source)).toEqual({ ok: true });
  });
});

describe('validateSvg: active or external content is rejected', () => {
  it.each([
    ['a script element', `<svg ${NS}><script>alert(1)</script></svg>`],
    [
      'a script element with an external source',
      `<svg ${NS}><script href="https://evil.example/x.js"/></svg>`,
    ],
    ['an onload handler on the root', `<svg ${NS} onload="alert(1)"><rect/></svg>`],
    [
      'an onclick handler on a shape',
      `<svg ${NS}><rect onclick="alert(1)" width="1" height="1"/></svg>`,
    ],
    ['a mixed-case event handler', `<svg ${NS}><rect OnMouseOver="alert(1)"/></svg>`],
    [
      'foreignObject with HTML',
      `<svg ${NS}><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject></svg>`,
    ],
    ['an external image', `<svg ${NS}><image href="https://evil.example/pixel.png"/></svg>`],
    [
      'an embedded data image',
      `<svg ${NS}><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>`,
    ],
    ['a javascript: link', `<svg ${NS}><a href="javascript:alert(1)"><rect/></a></svg>`],
    [
      '<use> pointing to another file',
      `<svg ${NS}><use href="https://evil.example/sprite.svg#icon"/></svg>`,
    ],
    [
      '<use> with an external xlink:href',
      `<svg ${NS} ${XLINK}><use xlink:href="//evil.example/a.svg#b"/></svg>`,
    ],
    [
      'an href hidden behind a character reference',
      `<svg ${NS}><use href="&#106;avascript:alert(1)"/></svg>`,
    ],
    [
      'a style attribute with an external url()',
      `<svg ${NS}><rect style="fill: url(https://evil.example/a.svg#x)"/></svg>`,
    ],
    [
      'a presentation attribute with an external url()',
      `<svg ${NS}><rect fill="url(https://evil.example/a.svg#x)"/></svg>`,
    ],
    [
      'a filter attribute with a data: url()',
      `<svg ${NS}><rect filter="url(data:image/svg+xml,x)"/></svg>`,
    ],
    [
      '@import in a style element',
      `<svg ${NS}><style>@import url("https://evil.example/a.css");</style></svg>`,
    ],
    [
      '@import split across text and CDATA',
      `<svg ${NS}><style>@imp<![CDATA[ort 'https://evil.example/a.css';]]></style></svg>`,
    ],
    [
      '@import split by an XML comment',
      `<svg ${NS}><style>@im<!-- x -->port "https://evil.example/a.css";</style></svg>`,
    ],
    ['a CSS expression()', `<svg ${NS}><rect style="width: expression(alert(1))"/></svg>`],
    [
      'CSS escapes hiding a keyword',
      `<svg ${NS}><style>@\\69mport url(https://evil.example/a.css);</style></svg>`,
    ],
    [
      'an external font face',
      `<svg ${NS}><style>@font-face { font-family: x; src: url(https://evil.example/f.woff) }</style></svg>`,
    ],
    [
      'SMIL animation of an href',
      `<svg ${NS}><a><animate attributeName="href" values="javascript:alert(1)"/><rect/></a></svg>`,
    ],
    ['a set element', `<svg ${NS}><set attributeName="onmouseover" to="alert(1)"/></svg>`],
    ['an iframe', `<svg ${NS}><iframe src="https://evil.example"/></svg>`],
    [
      'a DOCTYPE with entities (billion laughs)',
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg ${NS}><text>&b;</text></svg>`,
    ],
    [
      'a plain DOCTYPE',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg ${NS}/>`,
    ],
    [
      'an xml-stylesheet processing instruction',
      `<?xml version="1.0"?><?xml-stylesheet href="https://evil.example/a.css" type="text/css"?><svg ${NS}/>`,
    ],
    [
      'a javascript: URL in a presentation attribute',
      `<svg ${NS}><rect fill="java\tscript:alert(1)"/></svg>`,
    ],
  ])('rejects %s', (_label, source) => {
    expect(reason(source)).toBe('active_content');
  });
});

describe('validateSvg: unsupported or malformed documents are rejected', () => {
  it.each([
    [
      'metadata in a foreign namespace',
      `<svg ${NS} xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>me</dc:creator></svg>`,
    ],
    ['an unknown SVG element', `<svg ${NS}><unknownThing/></svg>`],
    [
      'a foreign-namespace attribute',
      `<svg ${NS} xmlns:ink="http://www.inkscape.org/namespaces/inkscape" ink:label="x"/>`,
    ],
    ['xml:base', `<svg ${NS} xml:base="https://evil.example/"><rect/></svg>`],
    [
      'a nested <use> chain',
      `<svg ${NS}><defs><g id="a"><rect/></g><g id="b"><use href="#a"/><use href="#a"/></g></defs><use href="#b"/></svg>`,
    ],
  ])('rejects %s as not allowed', (_label, source) => {
    expect(reason(source)).toBe('type_not_allowed');
  });

  it('rejects an svg element outside the SVG namespace', () => {
    expect(reason('<svg><rect/></svg>')).toBe('type_not_allowed');
  });

  it('rejects HTML that merely contains an svg', () => {
    expect(reason(`<html xmlns="http://www.w3.org/1999/xhtml"><svg ${NS}/></html>`)).toBe(
      'active_content',
    );
  });

  it.each([
    ['unclosed elements', `<svg ${NS}><rect>`],
    ['an undefined entity', `<svg ${NS}><text>&nbsp;</text></svg>`],
    ['two root elements', `<svg ${NS}/><svg ${NS}/>`],
    ['plain text', 'just some text'],
    ['an empty file', ''],
  ])('rejects %s as malformed', (_label, source) => {
    expect(reason(source)).toBe('content_mismatch');
  });

  it('rejects documents that are nested too deeply', () => {
    const depth = 80;
    const source = `<svg ${NS}>${'<g>'.repeat(depth)}${'</g>'.repeat(depth)}</svg>`;
    expect(reason(source)).toBe('type_not_allowed');
  });

  it('rejects documents with an excessive number of elements', () => {
    const source = `<svg ${NS}>${'<rect/>'.repeat(20_001)}</svg>`;
    expect(reason(source)).toBe('type_not_allowed');
  });
});
