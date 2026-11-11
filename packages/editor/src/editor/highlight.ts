/**
 * Syntax highlighting that stays off the typing path.
 *
 * The stock lowlight plugin re-highlights every code block synchronously
 * inside each transaction that touches one. Here a transaction only maps the
 * existing decorations (cheap); the actual highlighting runs later, in an
 * idle callback after a short debounce, only for blocks whose node changed,
 * with results cached by language and text. The grammar bundle is loaded
 * lazily when the first code block appears.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** Wait this long after the last change before re-highlighting. */
export const HIGHLIGHT_DEBOUNCE_MS = 120;
/** Blocks longer than this stay plain (highlighting cost grows with size). */
export const HIGHLIGHT_MAX_LENGTH = 60_000;
const CACHE_LIMIT = 200;

interface Span {
  from: number;
  to: number;
  className: string;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

interface Lowlight {
  highlight(language: string, value: string): { children: HastNode[] };
  registered(language: string): boolean;
  listLanguages(): string[];
}

let lowlightPromise: Promise<Lowlight> | null = null;

function loadLowlight(): Promise<Lowlight> {
  lowlightPromise ??= import('lowlight').then(
    ({ common, createLowlight }) => createLowlight(common) as unknown as Lowlight,
  );
  lowlightPromise.catch(() => {
    lowlightPromise = null;
  });
  return lowlightPromise;
}

/** Languages offered in the code block menu (the lowlight "common" set). */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'go', label: 'Go' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'ini', label: 'INI / TOML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'less', label: 'Less' },
  { value: 'lua', label: 'Lua' },
  { value: 'makefile', label: 'Makefile' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'objectivec', label: 'Objective-C' },
  { value: 'perl', label: 'Perl' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scss', label: 'SCSS' },
  { value: 'shell', label: 'Shell session' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'vbnet', label: 'VB.NET' },
  { value: 'wasm', label: 'WebAssembly' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'yaml', label: 'YAML' },
];

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  zsh: 'bash',
  html: 'xml',
  svg: 'xml',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  toml: 'ini',
};

/** A language name as it may appear in a document: short and made of name characters. */
const LANGUAGE_NAME = /^[a-z0-9][a-z0-9+#._-]{0,39}$/;

export function resolveLanguage(language: unknown): string | null {
  if (typeof language !== 'string' || !language) return null;
  const lower = language.toLowerCase();
  if (!LANGUAGE_NAME.test(lower)) return null;
  return (Object.hasOwn(LANGUAGE_ALIASES, lower) ? LANGUAGE_ALIASES[lower] : undefined) ?? lower;
}

function flatten(nodes: HastNode[], classes: string[], offset: { at: number }, out: Span[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      const length = node.value?.length ?? 0;
      if (length > 0 && classes.length > 0) {
        out.push({ from: offset.at, to: offset.at + length, className: classes.join(' ') });
      }
      offset.at += length;
    } else if (node.children) {
      flatten(node.children, [...classes, ...(node.properties?.className ?? [])], offset, out);
    }
  }
}

const spanCache = new Map<string, Span[]>();

function highlightText(lowlight: Lowlight, language: string | null, text: string): Span[] {
  if (!language || text.length > HIGHLIGHT_MAX_LENGTH || !lowlight.registered(language)) return [];
  const key = `${language}\u0000${text}`;
  const hit = spanCache.get(key);
  if (hit) return hit;
  let spans: Span[] = [];
  try {
    flatten(lowlight.highlight(language, text).children, [], { at: 0 }, spans);
  } catch {
    spans = [];
  }
  spanCache.set(key, spans);
  if (spanCache.size > CACHE_LIMIT) {
    const oldest = spanCache.keys().next().value;
    if (oldest !== undefined) spanCache.delete(oldest);
  }
  return spans;
}

interface BlockUpdate {
  from: number;
  to: number;
  decorations: Decoration[];
}

export const highlightPluginKey = new PluginKey<DecorationSet>('rdCodeHighlight');

type IdleHandle = { cancel: () => void };

function whenIdle(run: () => void, delay: number): IdleHandle {
  let idle: number | null = null;
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback === 'function') {
      idle = requestIdleCallback(run, { timeout: 400 });
    } else {
      run();
    }
  }, delay);
  return {
    cancel() {
      clearTimeout(timer);
      if (idle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
    },
  };
}

export function createHighlightPlugin(nodeName: string): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: highlightPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        const updates = tr.getMeta(highlightPluginKey) as BlockUpdate[] | undefined;
        if (updates) {
          for (const update of updates) {
            const stale = next.find(update.from, update.to);
            if (stale.length > 0) next = next.remove(stale);
            if (update.decorations.length > 0) next = next.add(tr.doc, update.decorations);
          }
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return highlightPluginKey.getState(state);
      },
    },
    view(view: EditorView) {
      // Nodes are immutable: an unchanged block keeps its identity.
      let done = new WeakSet<PMNode>();
      let handle: IdleHandle | null = null;
      let destroyed = false;

      const schedule = (delay: number): void => {
        handle?.cancel();
        handle = whenIdle(() => void scan(), delay);
      };

      const scan = async (): Promise<void> => {
        handle = null;
        if (destroyed) return;
        // Changing decorations inside the text being composed would break IME input.
        if (view.composing) {
          schedule(HIGHLIGHT_DEBOUNCE_MS * 2);
          return;
        }
        const pending: { node: PMNode; pos: number }[] = [];
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === nodeName) {
            if (!done.has(node)) pending.push({ node, pos });
            return false;
          }
          return !node.isTextblock;
        });
        if (pending.length === 0) return;
        let lowlight: Lowlight;
        try {
          lowlight = await loadLowlight();
        } catch {
          return;
        }
        if (destroyed || view.isDestroyed) return;
        if (view.composing) {
          schedule(HIGHLIGHT_DEBOUNCE_MS * 2);
          return;
        }
        const updates: BlockUpdate[] = [];
        const current = view.state.doc;
        for (const { node, pos } of pending) {
          // The document may have changed while the grammars were loading.
          if (current.nodeAt(pos) !== node) continue;
          const spans = highlightText(
            lowlight,
            resolveLanguage(node.attrs.language),
            node.textContent,
          );
          const start = pos + 1;
          updates.push({
            from: start,
            to: start + node.content.size,
            decorations: spans.map((span) =>
              Decoration.inline(start + span.from, start + span.to, { class: span.className }),
            ),
          });
          done.add(node);
        }
        if (updates.length === 0) {
          schedule(HIGHLIGHT_DEBOUNCE_MS);
          return;
        }
        view.dispatch(
          view.state.tr.setMeta(highlightPluginKey, updates).setMeta('addToHistory', false),
        );
      };

      schedule(0);
      return {
        update(updated, previous) {
          if (updated.state.doc !== previous.doc) schedule(HIGHLIGHT_DEBOUNCE_MS);
        },
        destroy() {
          destroyed = true;
          handle?.cancel();
          done = new WeakSet();
        },
      };
    },
  });
}
