/**
 * Safe Mermaid rendering.
 *
 * - Mermaid is loaded lazily (dynamic import) the first time a diagram is shown.
 * - It runs with `securityLevel: 'strict'`, HTML labels disabled and a bounded
 *   source size; diagram directives cannot change those settings.
 * - The produced SVG is sanitized with DOMPurify and is only ever displayed as
 *   an inert image (`<img src="data:image/svg+xml…">`): an SVG image cannot
 *   run script, handle events or load remote resources, even if something
 *   slipped through both sanitizers.
 * - Rendering is serialized, cached by source and theme, and never throws:
 *   a failure is returned as a readable message for the node view to show.
 */
import DOMPurify from 'dompurify';
import type { Mermaid } from 'mermaid';

export type DiagramTheme = 'dark' | 'light';

export type DiagramResult =
  { ok: true; dataUrl: string; width: number; height: number } | { ok: false; message: string };

type MermaidApi = Mermaid;

/** Fonts that exist both in the page and inside an SVG image (no web fonts there). */
const DIAGRAM_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans Devanagari", sans-serif';

/**
 * Mermaid draws the background of an edge label half transparent, so the edge
 * shows through the text like a strike-through once labels are SVG text
 * instead of HTML. An opaque background keeps labels readable.
 */
const DIAGRAM_CSS = '.edgeLabel rect { opacity: 1; }';

const CACHE_LIMIT = 60;
const cache = new Map<string, DiagramResult>();
let loader: Promise<MermaidApi> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;
let maxSourceLength = 20_000;

/** Applies the server's limit for diagram sources (from `GET /api/meta`). */
export function setDiagramSourceLimit(limit: number): void {
  if (Number.isFinite(limit) && limit > 0) maxSourceLength = Math.floor(limit);
}

function load(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((module) => module.default);
  loader.catch(() => {
    // Allow another attempt after a failed chunk load.
    loader = null;
  });
  return loader;
}

function configure(mermaid: MermaidApi, theme: DiagramTheme): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // SVG <text> labels only: no <foreignObject> with HTML inside the diagram.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: maxSourceLength,
    maxEdges: 500,
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: DIAGRAM_FONT,
    themeCSS: DIAGRAM_CSS,
    // Errors are returned to the caller; nothing is injected into the page.
    suppressErrorRendering: true,
    logLevel: 'fatal',
    // Keys a diagram's own `%%{init: …}%%` directive may not override.
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'maxTextSize',
      'suppressErrorRendering',
      'maxEdges',
      'htmlLabels',
      'fontFamily',
      // Our own stylesheet below; a directive could otherwise add CSS that
      // refers to a remote URL while Mermaid measures the diagram in the page.
      'themeCSS',
    ],
  });
}

function readableError(error: unknown): string {
  let message = '';
  if (error instanceof Error) message = error.message;
  else if (typeof error === 'string') message = error;
  else if (error && typeof (error as { str?: unknown }).str === 'string') {
    message = (error as { str: string }).str;
  }
  message = message.replace(/\r/g, '').trim();
  if (!message) return 'The diagram could not be rendered.';
  return message.length > 700 ? `${message.slice(0, 700)}…` : message;
}

/**
 * Sanitizes Mermaid's SVG and returns it as a data URL plus its intrinsic
 * size. Returns null if nothing safe is left.
 */
export function svgToDataUrl(
  svg: string,
): { dataUrl: string; width: number; height: number } | null {
  if (!DOMPurify.isSupported) return null;
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script', 'image', 'a', 'use', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'onload', 'onclick', 'onerror'],
    RETURN_DOM: true,
  }) as unknown as HTMLElement;
  const element = clean.querySelector('svg');
  if (!element) return null;
  element.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const viewBox = (element.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .map((part) => Number(part));
  let width = Number.parseFloat(element.getAttribute('width') ?? '');
  let height = Number.parseFloat(element.getAttribute('height') ?? '');
  if (viewBox.length === 4 && viewBox.every((part: number) => Number.isFinite(part))) {
    if (!Number.isFinite(width) || /%$/.test(element.getAttribute('width') ?? '')) {
      width = viewBox[2] ?? 0;
    }
    if (!Number.isFinite(height)) height = viewBox[3] ?? 0;
  }
  if (!(width > 0) || !(height > 0)) {
    width = 600;
    height = 400;
  }
  // Intrinsic pixel size so the <img> has stable dimensions.
  element.setAttribute('width', String(Math.ceil(width)));
  element.setAttribute('height', String(Math.ceil(height)));
  element.removeAttribute('style');
  const markup = new XMLSerializer().serializeToString(element);
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
    width: Math.ceil(width),
    height: Math.ceil(height),
  };
}

async function renderNow(source: string, theme: DiagramTheme): Promise<DiagramResult> {
  if (source.length > maxSourceLength) {
    return {
      ok: false,
      message: `The diagram source is too long (${source.length.toLocaleString('en')} characters; the limit is ${maxSourceLength.toLocaleString('en')}).`,
    };
  }
  let mermaid: MermaidApi;
  try {
    mermaid = await load();
  } catch {
    return { ok: false, message: 'The diagram renderer could not be loaded.' };
  }
  try {
    configure(mermaid, theme);
    // Syntax check first: gives the most readable message.
    await mermaid.parse(source);
    counter += 1;
    const { svg } = await mermaid.render(`rd-mermaid-${counter}`, source);
    const image = svgToDataUrl(svg);
    if (!image) return { ok: false, message: 'The diagram produced no drawable output.' };
    return { ok: true, ...image };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  } finally {
    // Mermaid can leave its measuring container behind after an error.
    if (typeof document !== 'undefined') {
      for (const stale of document.querySelectorAll(
        `[id^="drd-mermaid-"], #rd-mermaid-${counter}`,
      )) {
        stale.remove();
      }
    }
  }
}

/** Synchronous cache lookup, so an already rendered diagram shows without a flash. */
export function cachedDiagram(source: string, theme: DiagramTheme): DiagramResult | null {
  return cache.get(`${theme}\u0000${source}`) ?? null;
}

/** Renders one diagram. Calls are queued; results are cached by source and theme. */
export function renderDiagram(source: string, theme: DiagramTheme): Promise<DiagramResult> {
  const key = `${theme}\u0000${source}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (!source.trim()) {
    return Promise.resolve({
      ok: false,
      message: 'The diagram is empty. Add Mermaid source to see it.',
    });
  }
  const job = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    const result = await renderNow(source, theme);
    cache.set(key, result);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return result;
  });
  queue = job.catch(() => undefined);
  return job;
}
