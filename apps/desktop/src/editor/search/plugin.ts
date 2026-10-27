import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findInText, type TextRange } from "./match";

export interface SearchSettings {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
}

export interface SearchState extends SearchSettings {
  /** Document positions, ascending, never overlapping and never spanning a block boundary. */
  matches: TextRange[];
  /** Index into `matches`, -1 when there are none. */
  current: number;
  decorations: DecorationSet;
}

export const searchKey = new PluginKey<SearchState>("search");

const initial: SearchState = {
  query: "", replacement: "", matchCase: false, wholeWord: false, matches: [], current: -1, decorations: DecorationSet.empty,
};

/** `settings` merges new settings and rescans; `rescan` rescans with the current ones; `current` only moves the current match. */
interface Meta {
  settings?: Partial<SearchSettings>;
  current?: number;
  rescan?: boolean;
}

/**
 * Every match in the document. Text is searched per run of adjacent text nodes inside one inline-content node, so a
 * match never crosses a paragraph, cell or code block, nor an inline node (hard break, footnote). Footnote text is
 * searched too: the footnote node holds plain inline content, so it is its own run and can be found and replaced.
 */
export function findAll(doc: PMNode, s: SearchSettings): TextRange[] {
  if (!s.query) return [];
  const out: TextRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.inlineContent) return;
    let text = "";
    let start = 0;
    const flush = () => {
      for (const r of findInText(text, s.query, s)) out.push({ from: start + r.from, to: start + r.to });
      text = "";
    };
    node.forEach((child, offset) => {
      if (!child.isText) return flush();
      if (!text) start = pos + 1 + offset;
      text += child.text;
    });
    flush();
  });
  return out;
}

const decorate = (doc: PMNode, matches: TextRange[], current: number) =>
  matches.length
    ? DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? "search-match search-match-current" : "search-match" })))
    : DecorationSet.empty;

function withMatches(doc: PMNode, base: SearchState, matches: TextRange[], wanted: number): SearchState {
  const current = matches.length ? Math.max(0, Math.min(wanted, matches.length - 1)) : -1;
  return { ...base, matches, current, decorations: decorate(doc, matches, current) };
}

/** Maps matches through an edit; a match whose text was touched (its text changed or it collapsed) is dropped. */
function mapState(prev: SearchState, tr: Transaction): SearchState {
  const kept: TextRange[] = [];
  let current = -1;
  prev.matches.forEach((m, i) => {
    const from = tr.mapping.map(m.from, 1);
    const to = tr.mapping.map(m.to, -1);
    if (to - from !== m.to - m.from || tr.doc.textBetween(from, to) !== tr.before.textBetween(m.from, m.to)) return;
    if (i === prev.current) current = kept.length;
    kept.push({ from, to });
  });
  return withMatches(tr.doc, prev, kept, current === -1 ? prev.current : current);
}

const searchPlugin = new Plugin<SearchState>({
  key: searchKey,
  state: {
    init: () => initial,
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(searchKey) as Meta | undefined;
      if (meta?.settings) {
        const state = { ...prev, ...meta.settings };
        const matches = findAll(next.doc, state);
        // New search text: start at the first match at or after the caret.
        const idx = matches.findIndex((m) => m.from >= next.selection.from);
        return withMatches(next.doc, state, matches, idx === -1 ? 0 : idx);
      }
      if (meta?.rescan) return withMatches(next.doc, prev, findAll(next.doc, prev), meta.current ?? prev.current);
      if (meta?.current !== undefined) return { ...prev, current: meta.current, decorations: decorate(next.doc, prev.matches, meta.current) };
      // Nothing searched: no scan, no mapping, no cost.
      if (!tr.docChanged || !prev.query) return prev;
      return mapState(prev, tr);
    },
  },
  props: { decorations: (state) => searchKey.getState(state)?.decorations },
});

const get = (state: EditorState) => searchKey.getState(state) ?? initial;

/** For a "3 of 12" label: `index` is 1-based, 0 when there is no match. */
export function getSearchInfo(editor: Editor): { total: number; index: number } {
  const s = get(editor.state);
  return { total: s.matches.length, index: s.current + 1 };
}

/** Replaces ranges (ascending) in `tr`, last first so earlier positions stay valid. The first replaced char's marks are kept. */
function replaceRanges(tr: Transaction, ranges: TextRange[], replacement: string) {
  const doc = tr.doc;
  const { schema } = doc.type;
  for (const { from, to } of [...ranges].reverse()) {
    if (replacement) tr.replaceWith(from, to, schema.text(replacement, doc.nodeAt(from)?.marks));
    else tr.delete(from, to);
  }
}

function scrollTo(editor: Editor, pos: number) {
  try {
    const node = editor.view.domAtPos(pos).node;
    (node instanceof Element ? node : node.parentElement)?.scrollIntoView({ block: "center", inline: "nearest" });
  } catch {
    // No DOM (tests, detached view): nothing to scroll.
  }
}

/** Transaction that moves to the next or previous match (wrapping); `reveal` also selects it, otherwise the selection stays put. */
export function stepTransaction(state: EditorState, dir: 1 | -1, reveal: boolean): Transaction | null {
  const { matches, current } = get(state);
  const next = (current + dir + matches.length) % matches.length;
  const target = matches[next];
  if (!target) return null;
  const tr = state.tr.setMeta(searchKey, { current: next } satisfies Meta).setMeta("addToHistory", false);
  if (reveal) tr.setSelection(TextSelection.create(tr.doc, target.from, target.to));
  return tr;
}

/** Transaction replacing the current match (null when there is none). */
export function replaceCurrentTransaction(state: EditorState, tr: Transaction = state.tr): Transaction | null {
  const s = get(state);
  const at = s.matches[s.current];
  // Rescan so a match edited in place is never replaced from stale positions.
  const fresh = findAll(state.doc, s);
  const index = at ? fresh.findIndex((m) => m.from === at.from) : -1;
  const target = fresh[index];
  if (!target) return null;
  replaceRanges(tr, [target], s.replacement);
  // The replaced match is gone, so the next one now sits at the same index.
  return tr.setMeta(searchKey, { rescan: true, current: index } satisfies Meta);
}

/** One transaction (one undo step) replacing every match (null when there are none). */
export function replaceAllTransaction(state: EditorState, tr: Transaction = state.tr): Transaction | null {
  const s = get(state);
  const fresh = findAll(state.doc, s);
  if (!fresh.length) return null;
  replaceRanges(tr, fresh, s.replacement);
  return tr.setMeta(searchKey, { rescan: true, current: 0 } satisfies Meta);
}

export const setSearchTransaction = (state: EditorState, partial: Partial<SearchSettings>, tr: Transaction = state.tr): Transaction =>
  tr.setMeta(searchKey, { settings: partial } satisfies Meta).setMeta("addToHistory", false);

function step(editor: Editor, dir: 1 | -1, reveal: boolean): boolean {
  const tr = stepTransaction(editor.state, dir, reveal);
  if (!tr) return false;
  editor.view.dispatch(tr);
  const s = get(editor.state);
  const m = s.matches[s.current];
  if (m) scrollTo(editor, m.from);
  return true;
}

/** The commands `Search` adds to `editor.commands` (typed here because `@tiptap/core` is not a direct dependency to augment). */
export interface SearchCommands {
  /** Merges settings and rescans (callers debounce typing). An empty query clears the matches. */
  setSearch: (partial: Partial<SearchSettings>) => boolean;
  /** Moves to the next/previous match, wrapping, and scrolls to it. `reveal` also selects it (the editor is not focused). */
  findNext: (reveal?: boolean) => boolean;
  findPrevious: (reveal?: boolean) => boolean;
  replaceCurrent: () => boolean;
  replaceAll: () => boolean;
  clearSearch: () => boolean;
}

export const searchCommands = (editor: Editor): SearchCommands => editor.commands as unknown as SearchCommands;

interface Props { state: EditorState; tr: Transaction }

export const Search = Extension.create({
  name: "search",
  addProseMirrorPlugins: () => [searchPlugin],
  addCommands() {
    const commands = {
      setSearch: (partial: Partial<SearchSettings>) => ({ state, tr }: Props) => setSearchTransaction(state, partial, tr) !== null,
      findNext: (reveal = false) => () => step(this.editor, 1, reveal),
      findPrevious: (reveal = false) => () => step(this.editor, -1, reveal),
      replaceCurrent: () => ({ state, tr }: Props) => replaceCurrentTransaction(state, tr) !== null,
      replaceAll: () => ({ state, tr }: Props) => replaceAllTransaction(state, tr) !== null,
      clearSearch: () => ({ state, tr }: Props) => setSearchTransaction(state, { query: "", replacement: "" }, tr) !== null,
    };
    return commands as never;
  },
});
