/**
 * Strict allow-list validation for uploaded SVG files.
 *
 * SVG is XML that can carry script, event handlers, embedded HTML and
 * references to other resources. Uploaded SVGs are never rewritten: a file is
 * accepted unchanged only if every element is on the allow-list and nothing in
 * it can execute or load anything; otherwise it is rejected as a whole.
 * (Serving adds a sandboxing Content-Security-Policy as a second layer.)
 */
import { SaxesParser } from 'saxes';

export type SvgRejection =
  /** Scripts, event handlers, embedded HTML, external references, DTDs. */
  | 'active_content'
  /** Not well-formed XML or not an SVG document. */
  | 'content_mismatch'
  /** Well-formed and harmless-looking, but uses features outside the allow-list. */
  | 'type_not_allowed';

export type SvgValidation = { ok: true } | { ok: false; reason: SvgRejection; detail: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 20_000;
const MAX_ATTRIBUTE_LENGTH = 100_000;

/** Static drawing elements only. No script, animation, embedding or linking elements. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
]);

/** Elements that are dangerous by themselves (reported as active content). */
const ACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'canvas',
  'handler',
  'listener',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'set',
  'discard',
  'image',
  'feimage',
  'a',
  'link',
  'meta',
  'base',
  'html',
  'body',
]);

class Rejected extends Error {
  constructor(
    readonly reason: SvgRejection,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** Removes CSS comments and escapes so obfuscated keywords cannot slip through. */
function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\[0-9a-f]{1,6}\s?/gi, '?')
    .replace(/\\/g, '')
    .toLowerCase();
}

/** Every `url(...)` must point to a fragment of the same document. */
function hasExternalUrl(value: string): boolean {
  const lower = value.toLowerCase();
  let index = lower.indexOf('url(');
  while (index !== -1) {
    const rest = lower.slice(index + 4).trimStart();
    const unquoted = rest.replace(/^['"]\s*/, '');
    if (!unquoted.startsWith('#')) return true;
    index = lower.indexOf('url(', index + 4);
  }
  return false;
}

function checkCss(css: string, where: string): void {
  const normalized = normalizeCss(css);
  if (css.includes('\\')) {
    throw new Rejected('active_content', `${where} uses CSS escapes`);
  }
  if (
    normalized.includes('@import') ||
    normalized.includes('expression(') ||
    normalized.includes('javascript:') ||
    normalized.includes('behavior') ||
    normalized.includes('-moz-binding') ||
    normalized.includes('@font-face') ||
    normalized.includes('@namespace') ||
    normalized.includes('image-set(') ||
    normalized.includes('src(')
  ) {
    throw new Rejected('active_content', `${where} contains a disallowed CSS construct`);
  }
  if (hasExternalUrl(normalized)) {
    throw new Rejected('active_content', `${where} references an external resource`);
  }
}

const FRAGMENT_ONLY = /^#[A-Za-z0-9_.:-]*$/;

const ALLOWED_XML_ATTRIBUTES: ReadonlySet<string> = new Set(['space', 'lang', 'id']);
const MAX_USE_ELEMENTS = 500;

interface OpenElement {
  name: string;
  id: string | null;
  css: string;
}

export function validateSvg(source: string): SvgValidation {
  const parser = new SaxesParser({ xmlns: true });
  let elements = 0;
  let sawRoot = false;
  const stack: OpenElement[] = [];
  /** Ids of elements whose subtree contains a <use>. */
  const containsUse = new Set<string>();
  const useTargets: string[] = [];

  parser.on('error', (error) => {
    throw new Rejected('content_mismatch', `not well-formed XML: ${error.message.slice(0, 120)}`);
  });
  parser.on('doctype', () => {
    throw new Rejected('active_content', 'document type declarations are not allowed');
  });
  parser.on('processinginstruction', (instruction) => {
    throw new Rejected(
      'active_content',
      `processing instruction <?${instruction.target.slice(0, 40)}?> is not allowed`,
    );
  });

  parser.on('opentag', (tag) => {
    elements += 1;
    if (elements > MAX_ELEMENTS) throw new Rejected('type_not_allowed', 'too many elements');
    if (stack.length >= MAX_DEPTH) {
      throw new Rejected('type_not_allowed', 'elements are nested too deeply');
    }

    const local = tag.local;
    if (tag.uri !== SVG_NS) {
      throw new Rejected(
        ACTIVE_ELEMENTS.has(local.toLowerCase()) ? 'active_content' : 'type_not_allowed',
        `element <${tag.name.slice(0, 60)}> is not in the SVG namespace`,
      );
    }
    if (!sawRoot) {
      if (local !== 'svg') throw new Rejected('content_mismatch', 'the root element is not <svg>');
      sawRoot = true;
    }
    if (!ALLOWED_ELEMENTS.has(local)) {
      throw new Rejected(
        ACTIVE_ELEMENTS.has(local.toLowerCase()) ? 'active_content' : 'type_not_allowed',
        `element <${local.slice(0, 60)}> is not allowed`,
      );
    }

    let id: string | null = null;
    for (const attribute of Object.values(tag.attributes)) {
      const name = attribute.local.toLowerCase();
      const { prefix, value } = attribute;
      const shown = attribute.name.slice(0, 60);
      if (value.length > MAX_ATTRIBUTE_LENGTH) {
        throw new Rejected('type_not_allowed', `attribute ${shown} is too long`);
      }
      if (prefix === 'xmlns') {
        // Namespace declarations are harmless by themselves; elements and
        // attributes that use a foreign namespace are rejected where they appear.
        continue;
      }
      if (name.startsWith('on')) {
        throw new Rejected('active_content', `event handler attribute ${shown}`);
      }
      if (name === 'href' || name === 'src') {
        if (name === 'src' || !FRAGMENT_ONLY.test(value.trim())) {
          throw new Rejected(
            'active_content',
            `${shown} must reference a fragment of the same document`,
          );
        }
        if (prefix !== '' && !(prefix === 'xlink' && attribute.uri === XLINK_NS)) {
          throw new Rejected('type_not_allowed', `attribute ${shown} uses a foreign namespace`);
        }
        if (local === 'use') useTargets.push(value.trim().slice(1));
        continue;
      }
      if (prefix === 'xml') {
        if (!ALLOWED_XML_ATTRIBUTES.has(name)) {
          throw new Rejected('type_not_allowed', `attribute ${shown} is not allowed`);
        }
        continue;
      }
      if (prefix !== '') {
        throw new Rejected('type_not_allowed', `attribute ${shown} uses a foreign namespace`);
      }
      if (/(?:java|vb|live)script:/.test(value.toLowerCase().replace(/\s+/g, ''))) {
        throw new Rejected('active_content', `attribute ${shown} contains a script URL`);
      }
      if (name === 'style') {
        checkCss(value, 'a style attribute');
      } else if (hasExternalUrl(value)) {
        throw new Rejected('active_content', `attribute ${shown} references an external resource`);
      }
      if (name === 'id') id = value;
    }

    if (local === 'use') {
      if (useTargets.length > MAX_USE_ELEMENTS) {
        throw new Rejected('type_not_allowed', 'too many <use> elements');
      }
      for (const ancestor of stack) {
        if (ancestor.id !== null) containsUse.add(ancestor.id);
      }
    }
    stack.push({ name: local, id, css: '' });
  });

  parser.on('closetag', () => {
    const closed = stack.pop();
    // The whole text of a <style> element is checked at once, so a keyword
    // cannot be hidden by splitting it across text, CDATA and comments.
    if (closed?.name === 'style' && closed.css !== '') checkCss(closed.css, 'a <style> element');
  });

  const onText = (text: string) => {
    const current = stack[stack.length - 1];
    if (current?.name === 'style') current.css += text;
  };
  parser.on('text', onText);
  parser.on('cdata', onText);

  try {
    parser.write(source).close();
    // <use> may only instantiate plain shapes: a referenced subtree that itself
    // contains <use> can multiply into billions of elements when rendered.
    for (const target of useTargets) {
      if (containsUse.has(target)) {
        throw new Rejected('type_not_allowed', 'nested <use> references are not supported');
      }
    }
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, reason: error.reason, detail: error.detail };
    return { ok: false, reason: 'content_mismatch', detail: 'the file could not be parsed as XML' };
  }
  if (!sawRoot) return { ok: false, reason: 'content_mismatch', detail: 'no <svg> root element' };
  return { ok: true };
}
