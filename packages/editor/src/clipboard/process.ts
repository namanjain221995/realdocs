/**
 * Clipboard HTML pipeline: sanitize → normalize → report.
 *
 * 1. DOMPurify removes everything executable (scripts, event handlers,
 *    unsafe URLs, frames, objects, forms) inside an inert document.
 * 2. The normalizer rebuilds the content from an allow-list of elements and
 *    freshly generated attributes, so nothing from the source markup is
 *    copied verbatim. It understands the dialects of Google Docs, Word,
 *    Google Sheets, Excel, code editors and ordinary web pages on a
 *    best-effort basis.
 * 3. Everything that was simplified or dropped is counted in a paste report.
 *
 * Nothing here touches the network: remote images become labelled links,
 * embedded `data:` images are handed to the caller for upload.
 */
import DOMPurify from 'dompurify';
import { sanitizeLinkHref } from '../schema/links';
import { CALLOUT_VARIANTS } from '../schema/nodes';
import {
  fontSizeToPx,
  fontTagSizeToPx,
  isBoldWeight,
  isDefaultInk,
  isMonospaceFamily,
  lengthToPx,
  normalizeColor,
  parseStyle,
} from './css';
import { PasteNotes, buildReport, type PasteReport, type PasteSource } from './report';

/** Largest HTML payload that is imported with formatting (characters). */
export const MAX_PASTE_HTML_LENGTH = 2_000_000;
/** Largest plain-text payload accepted in one paste (characters). */
export const MAX_PASTE_TEXT_LENGTH = 1_000_000;
/** Embedded images taken from one paste. */
export const MAX_PASTE_IMAGES = 30;

export interface PastedImage {
  uploadId: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
}

export interface ProcessOptions {
  /** Document the content is pasted into (to recognise same-document assets). */
  documentId: string;
  /** Creates the stable id of an upload placeholder. */
  createUploadId: () => string;
  /**
   * Decides whether an embedded image may be uploaded (type and size checks
   * against the server limits). Return false to drop it with a note.
   * Omit to drop every embedded image (viewer / static contexts).
   */
  acceptImage?: (image: { mime: string; sizeBytes: number }) => boolean;
  maxHtmlLength?: number;
}

export interface ProcessedPaste {
  /** Clean HTML in the editor's own dialect, or null to fall back to plain text. */
  html: string | null;
  report: PasteReport;
  /** Embedded images to upload; each has a placeholder in `html`. */
  images: PastedImage[];
}

// ── Sanitizer ───────────────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'big',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
];

const ALLOWED_ATTR = [
  'align',
  'alt',
  'aria-checked',
  'checked',
  'class',
  'color',
  'colspan',
  'colwidth',
  'face',
  'href',
  'id',
  'role',
  'rowspan',
  'size',
  'src',
  'start',
  'style',
  'title',
  'type',
];

const EMBEDDED_TAGS = new Set([
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'video',
  'audio',
  'canvas',
  'svg',
  'math',
  'portal',
  'picture',
]);
const FORM_TAGS = new Set(['form', 'button', 'select', 'textarea', 'fieldset', 'option']);

/** True when DOMPurify can run here. Without it no HTML is ever imported. */
export function isSanitizerAvailable(): boolean {
  return DOMPurify.isSupported === true;
}

/**
 * Sanitizes untrusted HTML into the `<body>` of an inert document and counts
 * what was removed. Returns null if the sanitizer is unavailable.
 */
export function sanitizeClipboardHtml(html: string, notes: PasteNotes): HTMLElement | null {
  if (!isSanitizerAvailable()) return null;
  const body = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
    RETURN_DOM: true,
    SANITIZE_DOM: true,
    WHOLE_DOCUMENT: false,
  });
  let active = 0;
  let embedded = 0;
  let forms = 0;
  for (const entry of DOMPurify.removed) {
    const removedElement = (entry as { element?: Node }).element;
    if (removedElement && removedElement.nodeType === 1) {
      const tag = (removedElement as Element).localName.toLowerCase();
      if (tag === 'script') active += 1;
      else if (EMBEDDED_TAGS.has(tag) || tag.startsWith('v:') || tag === 'o:oleobject')
        embedded += 1;
      else if (FORM_TAGS.has(tag)) forms += 1;
      continue;
    }
    const attribute = (entry as { attribute?: Attr | null }).attribute;
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on')) active += 1;
    else if (
      (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') &&
      /^\s*(javascript|vbscript|data:text\/html)/i.test(attribute.value)
    ) {
      active += 1;
    }
  }
  notes.add('active-content', active);
  notes.add('embedded-objects', embedded);
  notes.add('forms', forms);
  return body as unknown as HTMLElement;
}

// ── Source detection ────────────────────────────────────────────────────────

export function detectSource(html: string): PasteSource {
  const head = html.slice(0, 6000);
  if (/data-rd-doc=/.test(html)) return 'realtimedocs';
  if (/id=["']?docs-internal-guid-/i.test(head)) return 'google-docs';
  if (/google-sheets-html-origin|data-sheets-(root|value|userformat)/i.test(head)) {
    return 'google-sheets';
  }
  if (
    /urn:schemas-microsoft-com:office:excel/i.test(head) ||
    /content=["']?Excel\.Sheet/i.test(head) ||
    /name=["']?Generator["']?\s+content=["']?Microsoft Excel/i.test(head)
  ) {
    return 'excel';
  }
  if (
    /urn:schemas-microsoft-com:office:word/i.test(head) ||
    /content=["']?Word\.Document/i.test(head) ||
    /name=["']?Generator["']?\s+content=["']?Microsoft Word/i.test(head) ||
    /class=["']?Mso[A-Z]/.test(html.slice(0, 20_000))
  ) {
    return 'word';
  }
  return 'web';
}

// ── Normalizer state ────────────────────────────────────────────────────────

interface InlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  color: string | null;
  sizePx: number | null;
  highlight: string | null;
  href: string | null;
}

const PLAIN: InlineState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  color: null,
  sizePx: null,
  highlight: null,
  href: null,
};

interface BlockAttrs {
  align: 'center' | 'right' | 'justify' | null;
  indent: number;
  lineHeight: string | null;
}

const NO_BLOCK_ATTRS: BlockAttrs = { align: null, indent: 0, lineHeight: null };

interface Context {
  source: PasteSource;
  documentId: string;
  out: Document;
  notes: PasteNotes;
  images: PastedImage[];
  options: ProcessOptions;
  /** Dominant ink colour / font size of the source, treated as "default". */
  baseColor: string | null;
  baseSize: number | null;
  baseHighlight: string | null;
  inHeading: boolean;
  inList: boolean;
  inTable: boolean;
  /** Paragraph attributes inherited from a wrapping block (div with text-align …). */
  blockAttrs: BlockAttrs;
}

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'center',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',');

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1;
const tagOf = (element: Element): string => element.localName.toLowerCase();

function imageKind(element: Element): 'embedded' | 'remote' | 'unreadable' {
  const src = (element.getAttribute('src') ?? '').trim();
  if (/^data:image\//i.test(src)) return 'embedded';
  if (/^https?:\/\//i.test(src)) return 'remote';
  return 'unreadable';
}

const blockCache = new WeakMap<Element, boolean>();

function isBlockNode(node: Node): boolean {
  if (!isElement(node)) return false;
  const cached = blockCache.get(node);
  if (cached !== undefined) return cached;
  const tag = tagOf(node);
  let block: boolean;
  if (BLOCK_TAGS.has(tag)) block = true;
  else if (tag === 'img') block = imageKind(node) === 'embedded';
  else if (tag === 'br' || tag === 'input') block = false;
  else {
    block =
      node.querySelector(BLOCK_SELECTOR) !== null ||
      [...node.querySelectorAll('img')].some((image) => imageKind(image) === 'embedded');
  }
  blockCache.set(node, block);
  return block;
}

// ── Inline formatting ───────────────────────────────────────────────────────

function applyElement(state: InlineState, element: HTMLElement, context: Context): InlineState {
  const tag = tagOf(element);
  const style = parseStyle(element.getAttribute('style'));
  const next: InlineState = { ...state };

  switch (tag) {
    case 'b':
    case 'strong':
      next.bold = true;
      break;
    case 'i':
    case 'em':
    case 'cite':
    case 'var':
      next.italic = true;
      break;
    case 'u':
    case 'ins':
      next.underline = true;
      break;
    case 's':
    case 'strike':
    case 'del':
      next.strike = true;
      break;
    case 'code':
    case 'tt':
    case 'kbd':
    case 'samp':
      next.code = true;
      break;
    case 'mark':
      next.highlight =
        normalizeColor(element.getAttribute('data-color')) ??
        normalizeColor(style.get('background-color')) ??
        '#fde68a';
      break;
    case 'font': {
      const color = normalizeColor(element.getAttribute('color'));
      if (color) next.color = color;
      const size = fontTagSizeToPx(element.getAttribute('size'));
      if (size) next.sizePx = size;
      if (element.hasAttribute('face')) context.notes.add('fonts');
      break;
    }
    case 'a': {
      const raw = element.getAttribute('href');
      if (raw !== null && !raw.startsWith('#')) {
        const href = sanitizeLinkHref(raw);
        if (href) next.href = href;
        else context.notes.add('unsafe-links');
      }
      break;
    }
    default:
      break;
  }

  if (style.size === 0) return next;

  const weight = isBoldWeight(style.get('font-weight'));
  if (weight !== null) next.bold = weight;
  const fontStyle = style.get('font-style');
  if (fontStyle) next.italic = /italic|oblique/i.test(fontStyle);
  const decoration = style.get('text-decoration') ?? style.get('text-decoration-line');
  if (decoration) {
    if (/underline/i.test(decoration)) next.underline = true;
    if (/line-through/i.test(decoration)) next.strike = true;
    if (/^none\b/i.test(decoration)) {
      next.underline = false;
      next.strike = false;
    }
  }
  const color = normalizeColor(style.get('color'));
  if (color) next.color = color;
  const size = fontSizeToPx(style.get('font-size'));
  if (size && size > 0) next.sizePx = size;
  const background =
    normalizeColor(style.get('background-color')) ??
    normalizeColor(style.get('mso-highlight')) ??
    normalizeColor(style.get('background'));
  if (background && !BLOCK_TAGS.has(tag)) next.highlight = background;
  const family = style.get('font-family') ?? style.get('font');
  if (family) {
    // A monospace run inside prose is how Docs and Word express inline code.
    if (isMonospaceFamily(family)) {
      if (tag === 'span' || tag === 'font') next.code = true;
    } else {
      context.notes.add('fonts');
    }
  }
  if (
    style.has('page-break-before') ||
    style.has('page-break-after') ||
    style.has('break-before') ||
    style.has('column-count') ||
    style.has('float') ||
    (style.has('border') && !['td', 'th', 'table'].includes(tag))
  ) {
    context.notes.add('layout');
  }
  return next;
}

function keepColor(state: InlineState, context: Context): string | null {
  const color = state.color;
  if (!color || state.href) return null;
  // The editor's own colours are deliberate; elsewhere near-black and
  // near-white are the source's default ink and would be unreadable in the
  // other theme.
  if (context.source === 'realtimedocs') return color;
  if (color === context.baseColor || isDefaultInk(color)) return null;
  return color;
}

function keepSize(state: InlineState, context: Context): number | null {
  const size = state.sizePx;
  if (!size || context.inHeading) return null;
  if (context.baseSize !== null && Math.abs(size - context.baseSize) < 1.5) return null;
  if (context.baseSize === null && Math.abs(size - 16) < 1.5) return null;
  return Math.min(96, Math.max(8, Math.round(size)));
}

function keepHighlight(state: InlineState, context: Context): string | null {
  const highlight = state.highlight;
  if (!highlight) return null;
  if (context.source === 'realtimedocs') return highlight;
  if (highlight === context.baseHighlight || isDefaultInk(highlight)) return null;
  return highlight;
}

/** Appends `text` to `parent`, wrapped in the elements that express `state`. */
function emitText(text: string, state: InlineState, parent: Element, context: Context): void {
  if (!text) return;
  const { out } = context;
  let node: Node = out.createTextNode(text);
  const wrap = (tag: string, attributes: Record<string, string> = {}): void => {
    const element = out.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.append(node);
    node = element;
  };
  const color = keepColor(state, context);
  const size = keepSize(state, context);
  if (color || size) {
    const declarations: string[] = [];
    if (color) declarations.push(`color: ${color}`);
    if (size) declarations.push(`font-size: ${size}px`);
    wrap('span', { style: declarations.join('; ') });
  }
  const highlight = keepHighlight(state, context);
  if (highlight) {
    wrap('mark', { 'data-color': highlight, style: `background-color: ${highlight}` });
  }
  if (state.code) wrap('code');
  if (state.strike) wrap('s');
  // Links are underlined by the editor; a source underline inside one is noise.
  if (state.underline && !state.href) wrap('u');
  if (state.italic) wrap('em');
  if (state.bold && (!context.inHeading || context.source === 'realtimedocs')) wrap('strong');
  if (state.href) wrap('a', { href: state.href });
  parent.append(node);
}

function imageLabel(element: Element, src: string): string {
  const alt = (element.getAttribute('alt') ?? element.getAttribute('title') ?? '').trim();
  if (alt) return alt.slice(0, 120);
  try {
    const url = new URL(src);
    const file = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return (file || url.hostname).slice(0, 120);
  } catch {
    return 'image';
  }
}

function decodeDataImage(src: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:(image\/[a-z0-9.+-]+)((?:;[^;,]+)*?)(;base64)?,(.*)$/is.exec(src.trim());
  if (!match || !match[1]) return null;
  const mime = match[1].toLowerCase();
  const payload = match[4] ?? '';
  try {
    if (match[3]) {
      const binary = atob(payload.replace(/\s+/g, ''));
      const bytes = new Uint8Array(new ArrayBuffer(binary.length));
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      return { mime, bytes };
    }
    const text = new TextEncoder().encode(decodeURIComponent(payload));
    const bytes = new Uint8Array(new ArrayBuffer(text.byteLength));
    bytes.set(text);
    return { mime, bytes };
  } catch {
    return null;
  }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Emits an upload placeholder for an embedded image, or records why not. */
function emitEmbeddedImage(element: Element, parent: Element, context: Context): void {
  const src = element.getAttribute('src') ?? '';
  const accept = context.options.acceptImage;
  if (!accept || context.images.length >= MAX_PASTE_IMAGES) {
    context.notes.add('rejected-images');
    return;
  }
  // Rough size check before decoding megabytes of base64.
  const approximate = Math.floor((src.length * 3) / 4);
  const mimeGuess = /^data:(image\/[a-z0-9.+-]+)/i.exec(src)?.[1]?.toLowerCase() ?? '';
  if (!accept({ mime: mimeGuess, sizeBytes: Math.max(0, approximate - 64) })) {
    context.notes.add('rejected-images');
    return;
  }
  const decoded = decodeDataImage(src);
  if (!decoded || decoded.bytes.byteLength === 0) {
    context.notes.add('unreadable-images');
    return;
  }
  if (!accept({ mime: decoded.mime, sizeBytes: decoded.bytes.byteLength })) {
    context.notes.add('rejected-images');
    return;
  }
  const uploadId = context.options.createUploadId();
  const alt = (element.getAttribute('alt') ?? '').trim().slice(0, 1000);
  const name = `pasted-image-${context.images.length + 1}.${EXTENSION_BY_MIME[decoded.mime] ?? 'img'}`;
  context.images.push({ uploadId, mime: decoded.mime, bytes: decoded.bytes, name });
  const figure = context.out.createElement('figure');
  figure.setAttribute('data-type', 'image');
  figure.setAttribute('data-upload-id', uploadId);
  figure.setAttribute('data-name', name);
  figure.setAttribute('data-align', 'center');
  if (alt) figure.setAttribute('data-alt', alt);
  figure.append(context.out.createElement('img'));
  parent.append(figure);
}

function convertInline(node: Node, parent: Element, state: InlineState, context: Context): void {
  if (node.nodeType === 3) {
    emitText(node.nodeValue ?? '', state, parent, context);
    return;
  }
  if (!isElement(node)) return;
  const tag = tagOf(node);
  switch (tag) {
    case 'br':
      parent.append(context.out.createElement('br'));
      return;
    case 'img': {
      if (node.getAttribute('role') === 'checkbox' || node.hasAttribute('aria-roledescription')) {
        return;
      }
      const kind = imageKind(node);
      if (kind === 'remote') {
        const src = (node.getAttribute('src') ?? '').trim();
        const href = sanitizeLinkHref(src);
        context.notes.add('remote-images');
        if (href) emitText(`Image: ${imageLabel(node, src)}`, { ...state, href }, parent, context);
      } else if (kind === 'unreadable') {
        context.notes.add('unreadable-images');
      }
      return;
    }
    case 'input':
      if ((node.getAttribute('type') ?? '').toLowerCase() !== 'checkbox')
        context.notes.add('forms');
      return;
    case 'col':
    case 'colgroup':
      return;
    default:
      break;
  }
  const next = applyElement(state, node, context);
  for (const child of [...node.childNodes]) convertInline(child, parent, next, context);
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function blockAttrsOf(element: HTMLElement, inherited: BlockAttrs, context: Context): BlockAttrs {
  const style = parseStyle(element.getAttribute('style'));
  const attrs: BlockAttrs = { ...inherited };

  const align = (style.get('text-align') ?? element.getAttribute('align') ?? '').toLowerCase();
  if (align === 'center' || align === 'justify') attrs.align = align;
  else if (align === 'right' || align === 'end') attrs.align = 'right';
  else if (align === 'left' || align === 'start') attrs.align = null;

  const dataIndent = element.getAttribute('data-indent');
  if (dataIndent !== null && /^\d$/.test(dataIndent)) {
    attrs.indent = Math.min(8, Number(dataIndent));
  } else if (!context.inList && !context.inTable) {
    const margin = lengthToPx(style.get('margin-left') ?? style.get('padding-left'));
    // One level is 36pt (0.5in) in Docs and Word.
    if (margin !== null && margin >= 24) attrs.indent = Math.min(8, Math.round(margin / 48));
  }

  const dataLineHeight = element.getAttribute('data-line-height');
  if (dataLineHeight && ['1', '1.15', '1.5', '2'].includes(dataLineHeight)) {
    attrs.lineHeight = dataLineHeight;
  } else if (!context.inTable) {
    // Cell paragraphs carry the grid's own tight spacing; it is not a choice.
    const raw = style.get('line-height');
    if (raw && raw !== 'normal') {
      const value = raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
      const unitless = /^[\d.]+%?$/.test(raw.trim());
      if (unitless && Number.isFinite(value)) {
        if (context.source === 'google-docs') {
          // Docs writes its "1.15" as 1.38, "1.5" as 1.8 and "double" as 2.4.
          attrs.lineHeight = value < 1.3 ? '1' : value < 1.6 ? null : value < 2.1 ? '1.5' : '2';
        } else {
          attrs.lineHeight = value >= 1.9 ? '2' : value >= 1.4 ? '1.5' : null;
        }
      }
    }
  }
  return attrs;
}

function createTextBlock(tag: string, attrs: BlockAttrs, context: Context): HTMLElement {
  const element = context.out.createElement(tag);
  if (attrs.align) element.setAttribute('style', `text-align: ${attrs.align}`);
  if (attrs.indent > 0) element.setAttribute('data-indent', String(attrs.indent));
  if (attrs.lineHeight) element.setAttribute('data-line-height', attrs.lineHeight);
  return element;
}

const hasVisibleContent = (element: Element): boolean =>
  element.childNodes.length > 0 &&
  ((element.textContent ?? '').replace(/[\s\u00a0]+/g, '') !== '' ||
    element.querySelector('br, a, img') !== null);

/**
 * Converts the children of a block container. Runs of inline nodes become
 * text blocks (`tag`, default `p`); block children are converted in place.
 */
function convertFlow(
  source: Node,
  parent: Element,
  state: InlineState,
  context: Context,
  options: { tag?: string; attrs?: BlockAttrs; keepEmpty?: boolean } = {},
): void {
  const tag = options.tag ?? 'p';
  const attrs = options.attrs ?? context.blockAttrs;
  let current: HTMLElement | null = null;
  let emitted = false;
  const flush = (): void => {
    if (!current) return;
    if (hasVisibleContent(current)) {
      // A trailing <br> is only a line terminator in the source.
      while (
        current.lastChild &&
        isElement(current.lastChild) &&
        tagOf(current.lastChild) === 'br'
      ) {
        current.lastChild.remove();
      }
      parent.append(current);
      emitted = true;
    }
    current = null;
  };
  for (const child of [...source.childNodes]) {
    if (isBlockNode(child)) {
      flush();
      convertBlock(child as HTMLElement, parent, state, context);
      emitted = true;
      continue;
    }
    if (child.nodeType === 3 && !current && !(child.nodeValue ?? '').trim()) continue;
    if (child.nodeType !== 1 && child.nodeType !== 3) continue;
    current ??= createTextBlock(tag, attrs, context);
    convertInline(child, current, state, context);
  }
  flush();
  if (!emitted && options.keepEmpty) parent.append(createTextBlock(tag, attrs, context));
}

function isTaskItem(item: Element): boolean | null {
  if (item.getAttribute('data-type') === 'taskItem') {
    const checked = item.getAttribute('data-checked');
    return checked === '' || checked === 'true';
  }
  if (item.getAttribute('role') === 'checkbox') return item.getAttribute('aria-checked') === 'true';
  const box = item.querySelector('input[type="checkbox"]');
  // Only a checkbox of this item itself, not one of a nested list.
  if (box && box.closest('li') === item) return box.hasAttribute('checked');
  return null;
}

function convertList(
  list: HTMLElement,
  parent: Element,
  state: InlineState,
  context: Context,
): void {
  const ordered = tagOf(list) === 'ol';
  const items = [...list.children].filter((child) => tagOf(child) === 'li');
  const stray = [...list.childNodes].filter(
    (child) => !(isElement(child) && tagOf(child) === 'li') && (child.textContent ?? '').trim(),
  );
  if (items.length === 0 && stray.length === 0) return;
  const taskStates = items.map(isTaskItem);
  const isTaskList =
    list.getAttribute('data-type') === 'taskList' ||
    (items.length > 0 && taskStates.every((value) => value !== null));

  const target = context.out.createElement(ordered && !isTaskList ? 'ol' : 'ul');
  if (isTaskList) target.setAttribute('data-type', 'taskList');
  if (ordered && !isTaskList) {
    const start = Number.parseInt(list.getAttribute('start') ?? '', 10);
    if (Number.isFinite(start) && start > 1 && start < 100_000) {
      target.setAttribute('start', String(start));
    }
  }
  const listContext: Context = { ...context, inList: true, blockAttrs: NO_BLOCK_ATTRS };
  const appendItem = (source: Node, checked: boolean | null): void => {
    const item = context.out.createElement('li');
    if (isTaskList) {
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', checked ? 'true' : 'false');
    }
    const inner = isElement(source) ? applyElement(state, source, listContext) : state;
    // The editor's own task items keep their content in a <div>.
    const content =
      isElement(source) && source.getAttribute('data-type') === 'taskItem'
        ? (source.querySelector(':scope > div') ?? source)
        : source;
    convertFlow(content, item, { ...inner, href: null }, listContext, { keepEmpty: true });
    target.append(item);
  };
  items.forEach((item, index) => appendItem(item, taskStates[index] ?? null));
  if (stray.length > 0) {
    const holder = list.ownerDocument.createElement('div');
    for (const node of stray) holder.append(node.cloneNode(true));
    appendItem(holder, null);
  }
  parent.append(target);
}

function clampSpan(value: string | null): string | null {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 1) return null;
  return String(Math.min(parsed, 100));
}

function convertTable(
  table: HTMLElement,
  parent: Element,
  state: InlineState,
  context: Context,
): void {
  const rows = [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table);
  const target = context.out.createElement('table');
  const body = context.out.createElement('tbody');
  const cellContext: Context = {
    ...context,
    inList: false,
    inTable: true,
    blockAttrs: NO_BLOCK_ATTRS,
  };
  let sawCellStyle = false;
  for (const row of rows) {
    if (/display:\s*none/i.test(row.getAttribute('style') ?? '')) continue;
    const inHead = row.parentElement !== null && tagOf(row.parentElement) === 'thead';
    const cells = [...row.children].filter((cell) => ['td', 'th'].includes(tagOf(cell)));
    if (cells.length === 0) continue;
    const outRow = context.out.createElement('tr');
    for (const cell of cells as HTMLElement[]) {
      const style = parseStyle(cell.getAttribute('style'));
      if (/none/i.test(style.get('display') ?? '')) continue;
      const header = tagOf(cell) === 'th' || inHead;
      const outCell = context.out.createElement(header ? 'th' : 'td');
      const colspan = clampSpan(cell.getAttribute('colspan'));
      const rowspan = clampSpan(cell.getAttribute('rowspan'));
      if (colspan) outCell.setAttribute('colspan', colspan);
      if (rowspan) outCell.setAttribute('rowspan', rowspan);
      const colwidth = cell.getAttribute('colwidth');
      if (colwidth && /^\d{1,4}(,\d{1,4})*$/.test(colwidth))
        outCell.setAttribute('colwidth', colwidth);
      if (style.has('background-color') || style.has('background') || style.has('border')) {
        sawCellStyle = true;
      }
      const cellState = applyElement(state, cell, cellContext);
      const attrs = blockAttrsOf(cell, NO_BLOCK_ATTRS, cellContext);
      convertFlow(cell, outCell, { ...cellState, highlight: null, href: null }, cellContext, {
        attrs: { ...attrs, indent: 0, lineHeight: null },
        keepEmpty: true,
      });
      if (cell.hasAttribute('data-sheets-formula')) context.notes.add('formulas');
      outRow.append(outCell);
    }
    if (outRow.childNodes.length > 0) body.append(outRow);
  }
  if (body.childNodes.length === 0) return;
  if (sawCellStyle) context.notes.add('cell-styles');
  const caption = [...table.children].find((child) => tagOf(child) === 'caption');
  if (caption) convertFlow(caption, parent, state, context);
  target.append(body);
  parent.append(target);
}

function preText(element: Element): string {
  let text = '';
  const walk = (node: Node): void => {
    if (node.nodeType === 3) text += node.nodeValue ?? '';
    else if (isElement(node)) {
      if (tagOf(node) === 'br') text += '\n';
      else {
        for (const child of [...node.childNodes]) walk(child);
        // Line containers of code editors (one <div> per line).
        if (tagOf(node) === 'div' || tagOf(node) === 'p') {
          if (!text.endsWith('\n')) text += '\n';
        }
      }
    }
  };
  for (const child of [...element.childNodes]) walk(child);
  return text.replace(/\n$/, '');
}

function emitCodeBlock(
  text: string,
  language: string | null,
  parent: Element,
  context: Context,
): void {
  const pre = context.out.createElement('pre');
  const code = context.out.createElement('code');
  if (language && /^[a-z0-9+#-]{1,30}$/i.test(language)) {
    code.setAttribute('class', `language-${language.toLowerCase()}`);
  }
  code.textContent = text;
  pre.append(code);
  parent.append(pre);
}

const INTERNAL_IMAGE_ATTRS = [
  'data-asset-id',
  'data-alt',
  'data-caption',
  'data-width',
  'data-align',
  'data-natural-width',
  'data-natural-height',
  'data-name',
];
const INTERNAL_ATTACHMENT_ATTRS = ['data-asset-id', 'data-name', 'data-size', 'data-mime'];

/** Asset-backed nodes of the editor's own dialect. Returns true if handled. */
function convertInternalNode(element: HTMLElement, parent: Element, context: Context): boolean {
  const type = element.getAttribute('data-type');
  const tag = tagOf(element);
  if (tag === 'pre' && type === 'diagram') {
    const pre = context.out.createElement('pre');
    pre.setAttribute('data-type', 'diagram');
    pre.setAttribute('data-language', 'mermaid');
    const code = context.out.createElement('code');
    code.textContent = preText(element);
    pre.append(code);
    parent.append(pre);
    return true;
  }
  const isImage = tag === 'figure' && type === 'image';
  const isAttachment = tag === 'div' && type === 'attachment';
  if (!isImage && !isAttachment) return false;
  const sameDocument = element.getAttribute('data-rd-doc') === context.documentId;
  if (!sameDocument || !element.hasAttribute('data-asset-id')) {
    // Assets are authorised per document, and an unfinished upload belongs to
    // the session that started it.
    if (!sameDocument) context.notes.add('foreign-assets');
    return true;
  }
  const copy = context.out.createElement(tag);
  copy.setAttribute('data-type', type ?? '');
  for (const name of isImage ? INTERNAL_IMAGE_ATTRS : INTERNAL_ATTACHMENT_ATTRS) {
    const value = element.getAttribute(name);
    if (value !== null) copy.setAttribute(name, value.slice(0, 1000));
  }
  if (isImage) copy.append(context.out.createElement('img'));
  else copy.textContent = (element.getAttribute('data-name') ?? '').slice(0, 255);
  parent.append(copy);
  return true;
}

function convertBlock(
  element: HTMLElement,
  parent: Element,
  state: InlineState,
  context: Context,
): void {
  const tag = tagOf(element);
  if (convertInternalNode(element, parent, context)) return;
  if (tag === 'div' && element.getAttribute('data-type') === 'callout') {
    // A callout of the editor's own dialect (schema version 2). Only the listed variants are
    // kept; anything else becomes `info`.
    const box = context.out.createElement('div');
    box.setAttribute('data-type', 'callout');
    const variant = element.getAttribute('data-variant') ?? '';
    box.setAttribute(
      'data-variant',
      (CALLOUT_VARIANTS as readonly string[]).includes(variant) ? variant : 'info',
    );
    convertFlow(element, box, applyElement(state, element, context), {
      ...context,
      blockAttrs: NO_BLOCK_ATTRS,
    });
    if (box.childNodes.length > 0) parent.append(box);
    return;
  }
  switch (tag) {
    case 'p': {
      const attrs = blockAttrsOf(element, context.blockAttrs, context);
      convertFlow(element, parent, applyElement(state, element, context), context, {
        attrs,
        keepEmpty: true,
      });
      return;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Math.min(4, Number(tag[1]));
      const attrs = blockAttrsOf(element, NO_BLOCK_ATTRS, context);
      convertFlow(
        element,
        parent,
        { ...applyElement(state, element, context), bold: false, sizePx: null },
        { ...context, inHeading: true },
        { tag: `h${level}`, attrs: { ...attrs, lineHeight: null } },
      );
      return;
    }
    case 'ul':
    case 'ol':
      convertList(element, parent, state, context);
      return;
    case 'li': {
      // A list item outside any list.
      const list = context.out.createElement('ul');
      const item = context.out.createElement('li');
      convertFlow(element, item, state, { ...context, inList: true }, { keepEmpty: true });
      list.append(item);
      parent.append(list);
      return;
    }
    case 'blockquote': {
      const quote = context.out.createElement('blockquote');
      convertFlow(element, quote, applyElement(state, element, context), {
        ...context,
        blockAttrs: NO_BLOCK_ATTRS,
      });
      if (quote.childNodes.length > 0) parent.append(quote);
      return;
    }
    case 'pre': {
      const code = element.querySelector('code');
      const language =
        [...(code?.classList ?? []), ...element.classList]
          .map((name) => /^(?:language|lang)-(.+)$/.exec(name)?.[1])
          .find((name) => name) ?? null;
      emitCodeBlock(preText(element), language ?? null, parent, context);
      return;
    }
    case 'hr':
      parent.append(context.out.createElement('hr'));
      return;
    case 'table':
      convertTable(element, parent, state, context);
      return;
    case 'img':
      emitEmbeddedImage(element, parent, context);
      return;
    case 'tbody':
    case 'thead':
    case 'tfoot':
    case 'tr':
    case 'td':
    case 'th':
      // Table parts without a table: keep their text.
      convertFlow(element, parent, state, context);
      return;
    default: {
      // div, section, figure, inline wrappers around blocks, …
      const next = applyElement(state, element, context);
      const attrs = BLOCK_TAGS.has(tag)
        ? blockAttrsOf(element, context.blockAttrs, context)
        : context.blockAttrs;
      convertFlow(element, parent, next, { ...context, blockAttrs: attrs });
    }
  }
}

// ── Source-specific preparation (mutates the sanitized, inert DOM) ──────────

const styleText = (element: Element): string => element.getAttribute('style') ?? '';

function prepareWord(root: HTMLElement, context: Context): void {
  // Comments and their anchors.
  let comments = 0;
  for (const element of [...root.querySelectorAll('*')]) {
    const style = styleText(element);
    const className = element.getAttribute('class') ?? '';
    // Skip descendants of something removed earlier in this loop.
    if (!root.contains(element)) continue;
    if (
      /mso-element:\s*comment/i.test(style) ||
      /MsoComment(Reference|Text)|msocomanchor|msocomtxt|msocomoff/i.test(className) ||
      /^_com_\d+|^_anchor_\d+|^_msoanchor_\d+/i.test(element.getAttribute('id') ?? '')
    ) {
      comments += 1;
      element.remove();
    } else if (/mso-comment-(reference|continuation)/i.test(style)) {
      // The anchor around the commented words: the words stay, the comment goes.
      comments += 1;
      element.replaceWith(...element.childNodes);
    }
  }
  context.notes.add('comments', comments > 0 ? 1 : 0);

  // Tracked changes: deletions are not part of the text; insertions are.
  let tracked = 0;
  for (const element of [...root.querySelectorAll('del, .msoDel')]) {
    tracked += 1;
    element.remove();
  }
  for (const element of [...root.querySelectorAll('ins, .msoIns')]) {
    tracked += 1;
    element.replaceWith(...element.childNodes);
  }
  context.notes.add('tracked-changes', tracked > 0 ? 1 : 0);

  // Explicit breaks and section wrappers carry page layout only.
  for (const element of [...root.querySelectorAll('br')]) {
    if (/page-break|mso-special-character|mso-break-type/i.test(styleText(element))) {
      context.notes.add('layout');
      element.remove();
    }
  }

  convertWordLists(root);
}

interface WordListInfo {
  /** Word's list id (`l0`, `l1`, …); a new id starts a new list. */
  list: string;
  level: number;
  ordered: boolean;
}

function wordListInfo(paragraph: Element): WordListInfo | null {
  const style = styleText(paragraph);
  const match = /mso-list:\s*[^;]*?level(\d+)/i.exec(style);
  const listId = /mso-list:\s*(l\d+)/i.exec(style)?.[1] ?? '';
  const isListClass = /MsoListParagraph/i.test(paragraph.getAttribute('class') ?? '');
  if (!match && !isListClass) return null;
  if (/mso-list:\s*none/i.test(style)) return null;
  let markerText = '';
  let marker: Element | null = null;
  for (const span of [...paragraph.querySelectorAll('span')]) {
    if (/mso-list:\s*Ignore/i.test(styleText(span))) {
      marker = span;
      break;
    }
  }
  if (marker) {
    markerText = marker.textContent ?? '';
    marker.remove();
  } else {
    // No marker span survived: take a leading bullet or number from the text.
    const first = paragraph.firstChild;
    const lead = /^\s*((?:[·•◦▪▫‣o§\-–—*]|\(?[0-9]{1,3}[.)]|\(?[a-zA-Z][.)])[\s\u00a0]+)/.exec(
      first?.textContent ?? '',
    );
    if (!match && !lead) return null;
    if (lead && lead[1] && first && first.nodeType === 3) {
      markerText = lead[1];
      first.nodeValue = (first.nodeValue ?? '').slice(lead[0].length);
    }
  }
  return {
    list: listId,
    level: Math.min(9, Math.max(1, match && match[1] ? Number(match[1]) : 1)),
    ordered: /^\s*\(?(?:[0-9]{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,6})[.)]/.test(markerText),
  };
}

/** Word writes lists as paragraphs with `mso-list`; rebuild real lists. */
function convertWordLists(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const infos = new Map<Element, WordListInfo>();
  for (const paragraph of [...root.querySelectorAll('p')]) {
    const info = wordListInfo(paragraph);
    if (info) infos.set(paragraph, info);
  }
  const handled = new Set<Element>();
  for (const [first, firstInfo] of infos) {
    if (handled.has(first) || !first.parentNode) continue;
    const run: Element[] = [first];
    let cursor: Element | null = first.nextElementSibling;
    while (cursor && infos.get(cursor)?.list === firstInfo.list) {
      run.push(cursor);
      cursor = cursor.nextElementSibling;
    }
    const rootList = doc.createElement(firstInfo.ordered ? 'ol' : 'ul');
    first.before(rootList);
    const stack: { level: number; list: Element; last: Element | null }[] = [
      { level: firstInfo.level, list: rootList, last: null },
    ];
    for (const paragraph of run) {
      handled.add(paragraph);
      const info = infos.get(paragraph) as WordListInfo;
      while (stack.length > 1 && (stack.at(-1)?.level ?? 0) > info.level) stack.pop();
      let top = stack.at(-1) as (typeof stack)[number];
      if (info.level > top.level) {
        const nested = doc.createElement(info.ordered ? 'ol' : 'ul');
        if (!top.last) {
          top.last = doc.createElement('li');
          top.list.append(top.last);
        }
        top.last.append(nested);
        top = { level: info.level, list: nested, last: null };
        stack.push(top);
      }
      const item = doc.createElement('li');
      const content = doc.createElement('p');
      content.append(...paragraph.childNodes);
      item.append(content);
      top.list.append(item);
      top.last = item;
      paragraph.remove();
    }
  }
}

function prepareGoogleDocs(root: HTMLElement, context: Context): void {
  // Nested lists are written as siblings of the parent item.
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    for (const child of [...list.children]) {
      const tag = tagOf(child);
      if (tag !== 'ul' && tag !== 'ol') continue;
      let previous = child.previousElementSibling;
      if (!previous || tagOf(previous) !== 'li') {
        previous = root.ownerDocument.createElement('li');
        child.before(previous);
      }
      previous.append(child);
    }
  }
  // Comment anchors and the comment texts appended at the end.
  let comments = 0;
  for (const anchor of [...root.querySelectorAll('a[href^="#cmnt"], a[id^="cmnt"]')]) {
    comments += 1;
    const container =
      anchor.closest('sup') ?? (anchor.id.startsWith('cmnt') ? anchor.closest('div, p') : null);
    (container ?? anchor).remove();
  }
  context.notes.add('comments', comments > 0 ? 1 : 0);
}

/** Recognises "one styled <div>/<pre> with monospace text" as copied code. */
function codeEditorText(root: HTMLElement): string | null {
  const elements = [...root.children].filter((child) => tagOf(child) !== 'br');
  if (elements.length !== 1) return null;
  const only = elements[0] as HTMLElement;
  if (!['div', 'pre'].includes(tagOf(only))) return null;
  const style = parseStyle(only.getAttribute('style'));
  const whiteSpace = style.get('white-space') ?? '';
  if (!/pre/i.test(whiteSpace) || !isMonospaceFamily(style.get('font-family'))) return null;
  if (only.querySelector('table, ul, ol, h1, h2, h3, img')) return null;
  return preText(only);
}

// ── Statistics for "default ink" detection ──────────────────────────────────

function measure(root: HTMLElement, context: Context): void {
  const colors = new Map<string, number>();
  const sizes = new Map<number, number>();
  const highlights = new Map<string, number>();
  let total = 0;
  // Notes raised while measuring are discarded: the real walk raises them again.
  const quiet: Context = { ...context, notes: new PasteNotes() };
  const walk = (node: Node, state: InlineState): void => {
    if (node.nodeType === 3) {
      const length = (node.nodeValue ?? '').trim().length;
      if (length === 0) return;
      total += length;
      if (state.color) colors.set(state.color, (colors.get(state.color) ?? 0) + length);
      if (state.sizePx) {
        const key = Math.round(state.sizePx * 2) / 2;
        sizes.set(key, (sizes.get(key) ?? 0) + length);
      }
      if (state.highlight) {
        highlights.set(state.highlight, (highlights.get(state.highlight) ?? 0) + length);
      }
      return;
    }
    if (!isElement(node)) return;
    const tag = tagOf(node);
    // Headings and links have their own colours and sizes.
    if (/^h[1-6]$/.test(tag) || tag === 'a') return;
    const next = applyElement(state, node, quiet);
    for (const child of [...node.childNodes]) walk(child, next);
  };
  walk(root, PLAIN);
  const dominant = <T>(map: Map<T, number>): T | null => {
    let best: T | null = null;
    let bestLength = 0;
    for (const [key, length] of map) {
      if (length > bestLength) {
        best = key;
        bestLength = length;
      }
    }
    return best !== null && bestLength >= total * 0.5 ? best : null;
  };
  context.baseColor = dominant(colors);
  context.baseSize = dominant(sizes);
  context.baseHighlight = dominant(highlights);
}

// ── Entry point ─────────────────────────────────────────────────────────────

function createOutputDocument(): Document {
  return document.implementation.createHTMLDocument('');
}

/**
 * Turns untrusted clipboard HTML into clean HTML for the editor's parser.
 * `html === null` in the result means "use the plain-text flavour instead".
 */
export function processPastedHtml(html: string, options: ProcessOptions): ProcessedPaste {
  const notes = new PasteNotes();
  const source = detectSource(html);
  const limit = options.maxHtmlLength ?? MAX_PASTE_HTML_LENGTH;
  if (html.length > limit) {
    notes.add('too-large');
    return { html: null, report: buildReport(source, notes), images: [] };
  }
  if (/\bx:fmla=|data-sheets-formula=/i.test(html)) notes.add('formulas');

  const body = sanitizeClipboardHtml(html, notes);
  if (!body) {
    notes.add('no-sanitizer');
    return { html: null, report: buildReport(source, notes), images: [] };
  }

  const out = createOutputDocument();
  const context: Context = {
    source,
    documentId: options.documentId,
    out,
    notes,
    images: [],
    options,
    baseColor: null,
    baseSize: null,
    baseHighlight: null,
    inHeading: false,
    inList: false,
    inTable: false,
    blockAttrs: NO_BLOCK_ATTRS,
  };

  let root: HTMLElement = body;
  if (source === 'word') prepareWord(body, context);
  if (source === 'google-docs') prepareGoogleDocs(body, context);
  if (source === 'google-sheets' || source === 'excel') {
    const table = body.querySelector('table');
    if (table) {
      const holder = body.ownerDocument.createElement('div');
      holder.append(table);
      root = holder;
    }
  }

  const result = out.createElement('div');
  const code = source === 'web' ? codeEditorText(body) : null;
  if (code !== null) {
    context.source = 'code-editor';
    notes.add('code-colors');
    emitCodeBlock(code, null, result, context);
  } else {
    if (source !== 'realtimedocs') measure(root, context);
    convertFlow(root, result, PLAIN, context);
  }
  // Clipboard wrappers often end (or start) with an empty line of their own.
  const isEmptyParagraph = (node: ChildNode | null): boolean =>
    node !== null && isElement(node) && tagOf(node) === 'p' && node.childNodes.length === 0;
  while (result.childNodes.length > 1 && isEmptyParagraph(result.lastChild)) {
    result.lastChild?.remove();
  }
  while (result.childNodes.length > 1 && isEmptyParagraph(result.firstChild)) {
    result.firstChild?.remove();
  }
  return {
    html: result.innerHTML,
    report: buildReport(context.source, notes, context.images.length),
    images: context.images,
  };
}
