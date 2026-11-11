/**
 * Find (viewers and editors) and replace (editors).
 *
 * Matches are plain decorations, so the feature works on a read-only editor
 * and never touches the document until a replace is requested. While a query
 * is active, typing only maps the existing decorations; the match list is
 * recomputed after a short debounce.
 */
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  /** Index into `matches`, or -1. */
  current: number;
  decorations: DecorationSet;
}

export interface FindSummary {
  query: string;
  total: number;
  /** 1-based position of the current match, 0 if none. */
  position: number;
}

/** Recompute matches this long after the last document change. */
export const FIND_DEBOUNCE_MS = 150;
/** Stop collecting after this many matches (keeps huge documents responsive). */
export const FIND_MAX_MATCHES = 2_000;

export const findPluginKey = new PluginKey<FindState>('rdFind');

type FindMeta =
  | { type: 'query'; query: string; caseSensitive: boolean }
  | { type: 'step'; direction: 1 | -1 }
  | { type: 'refresh' }
  | { type: 'clear' };

const EMPTY: FindState = {
  query: '',
  caseSensitive: false,
  matches: [],
  current: -1,
  decorations: DecorationSet.empty,
};

/**
 * Finds every occurrence of `query` inside text blocks. A match never spans
 * two blocks. Non-text inline nodes count as an object-replacement character,
 * so positions stay aligned.
 */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): FindMatch[] {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  doc.descendants((node, pos) => {
    if (matches.length >= FIND_MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, '\ufffc');
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    // Lower-casing can change the length of a few characters; then the
    // offsets would not line up, so search that block case-sensitively.
    const source = haystack.length === text.length ? haystack : text;
    const probe = haystack.length === text.length ? needle : query;
    let index = source.indexOf(probe);
    while (index !== -1 && matches.length < FIND_MAX_MATCHES) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + probe.length });
      index = source.indexOf(probe, index + Math.max(1, probe.length));
    }
    return false;
  });
  return matches;
}

function decorate(doc: PMNode, matches: FindMatch[], current: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === current ? 'rd-find-match rd-find-match--current' : 'rd-find-match',
      }),
    ),
  );
}

function compute(
  doc: PMNode,
  query: string,
  caseSensitive: boolean,
  preferred: number,
  near?: number,
): FindState {
  if (!query) return EMPTY;
  const matches = findMatches(doc, query, caseSensitive);
  let current = -1;
  if (matches.length > 0) {
    if (near !== undefined) {
      current = matches.findIndex((match) => match.from >= near);
      if (current === -1) current = 0;
    } else {
      current = Math.min(Math.max(preferred, 0), matches.length - 1);
    }
  }
  return { query, caseSensitive, matches, current, decorations: decorate(doc, matches, current) };
}

export function getFindSummary(state: EditorState): FindSummary {
  const find = findPluginKey.getState(state) ?? EMPTY;
  return {
    query: find.query,
    total: find.matches.length,
    position: find.current >= 0 ? find.current + 1 : 0,
  };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    rdFind: {
      /** Sets the search query and highlights every match. */
      setFindQuery: (query: string, options?: { caseSensitive?: boolean }) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      clearFind: () => ReturnType;
      /** Replaces the current match (editors only). */
      replaceCurrentMatch: (replacement: string) => ReturnType;
      /** Replaces every match in one undoable step (editors only). */
      replaceAllMatches: (replacement: string) => ReturnType;
    };
  }
}

function replaceRange(tr: Transaction, match: FindMatch, replacement: string): void {
  if (replacement) tr.insertText(replacement, match.from, match.to);
  else tr.delete(match.from, match.to);
}

export const FindReplace = Extension.create({
  name: 'rdFind',

  addCommands() {
    return {
      setFindQuery:
        (query, options) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const meta: FindMeta = {
              type: 'query',
              query,
              caseSensitive: options?.caseSensitive ?? false,
            };
            dispatch(tr.setMeta(findPluginKey, meta).setMeta('addToHistory', false));
          }
          return true;
        },
      findNext:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const meta: FindMeta = { type: 'step', direction: 1 };
            dispatch(tr.setMeta(findPluginKey, meta).setMeta('addToHistory', false));
          }
          return true;
        },
      findPrevious:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const meta: FindMeta = { type: 'step', direction: -1 };
            dispatch(tr.setMeta(findPluginKey, meta).setMeta('addToHistory', false));
          }
          return true;
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const meta: FindMeta = { type: 'clear' };
            dispatch(tr.setMeta(findPluginKey, meta).setMeta('addToHistory', false));
          }
          return true;
        },
      replaceCurrentMatch:
        (replacement) =>
        ({ tr, state, dispatch, editor }) => {
          const find = findPluginKey.getState(state);
          const match = find?.matches[find.current];
          if (!find || !match || !editor.isEditable) return false;
          if (dispatch) {
            replaceRange(tr, match, replacement);
            const meta: FindMeta = { type: 'refresh' };
            dispatch(tr.setMeta(findPluginKey, meta));
          }
          return true;
        },
      replaceAllMatches:
        (replacement) =>
        ({ tr, state, dispatch, editor }) => {
          const find = findPluginKey.getState(state);
          if (!find || find.matches.length === 0 || !editor.isEditable) return false;
          if (dispatch) {
            // Back to front, so earlier positions stay valid.
            for (const match of [...find.matches].reverse()) replaceRange(tr, match, replacement);
            const meta: FindMeta = { type: 'refresh' };
            dispatch(tr.setMeta(findPluginKey, meta));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findPluginKey,
        state: {
          init: () => EMPTY,
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(findPluginKey) as FindMeta | undefined;
            if (meta?.type === 'clear') return EMPTY;
            if (meta?.type === 'query') {
              return compute(
                tr.doc,
                meta.query,
                meta.caseSensitive,
                0,
                // Start at the reader's position rather than the top.
                meta.query === value.query ? undefined : newState.selection.from,
              );
            }
            if (meta?.type === 'refresh') {
              return compute(tr.doc, value.query, value.caseSensitive, value.current);
            }
            if (meta?.type === 'step') {
              if (value.matches.length === 0) return value;
              const count = value.matches.length;
              const current = (value.current + meta.direction + count) % count;
              return { ...value, current, decorations: decorate(tr.doc, value.matches, current) };
            }
            if (!tr.docChanged || !value.query) return value;
            // Typing path: keep the highlights roughly in place; the view
            // below schedules an exact recomputation.
            const matches = value.matches
              .map((match) => ({
                from: tr.mapping.map(match.from, 1),
                to: tr.mapping.map(match.to, -1),
              }))
              .filter((match) => match.to > match.from);
            return {
              ...value,
              matches,
              current: Math.min(value.current, matches.length - 1),
              decorations: value.decorations.map(tr.mapping, tr.doc),
            };
          },
        },
        props: {
          decorations(state) {
            return findPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const refresh = (): void => {
            timer = null;
            if (view.isDestroyed) return;
            if (view.composing) {
              timer = setTimeout(refresh, FIND_DEBOUNCE_MS);
              return;
            }
            const meta: FindMeta = { type: 'refresh' };
            view.dispatch(
              view.state.tr.setMeta(findPluginKey, meta).setMeta('addToHistory', false),
            );
          };
          return {
            update(updated, previous) {
              const find = findPluginKey.getState(updated.state);
              if (!find?.query || updated.state.doc === previous.doc) return;
              if (timer !== null) clearTimeout(timer);
              timer = setTimeout(refresh, FIND_DEBOUNCE_MS);
            },
            destroy() {
              if (timer !== null) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
