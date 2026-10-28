/**
 * Book-wide search and replace on plain TipTap JSON (no editor needed), for pages that are not open.
 *
 * Exports:
 *   interface BookPage { id: string; title: string; doc: JSONContent }
 *   interface BookSearchOptions { query: string; matchCase: boolean; wholeWord: boolean; regex?: boolean }
 *   interface BookSearchResult { total: number; pages: { id: string; title: string; count: number }[] }
 *   searchBook(pages: BookPage[], opts: BookSearchOptions): BookSearchResult
 *     Only pages with at least one match are listed, in input order. Empty query: { total: 0, pages: [] }.
 *   findInDoc(doc: JSONContent, opts: BookSearchOptions): DocMatch[]
 *     Match positions as { path, from, to }: path = child indices from the doc root to the block holding the run,
 *     from/to = UTF-16 offsets in that run's text (a run = adjacent text nodes, `to` exclusive).
 *   replaceInDoc(doc: JSONContent, opts: BookSearchOptions, replacement: string): { doc: JSONContent; count: number }
 *     Returns a new doc (input never mutated; the same object when nothing matched). Each replacement takes the
 *     marks of the first replaced character. With `regex` the replacement expands `$1`..`$9`, `$&`, `$$`.
 *
 * Semantics match plugin.ts `findAll`: literal Unicode (or a regex with `regex`, see match.ts), non-overlapping, and a match never crosses a block, a hard
 * break or a footnote (any non-text child ends the run; footnote text is its own run).
 */
import type { JSONContent } from "@tiptap/react";
import { expandReplacement, findInText, MAX_MATCHES } from "./match";

export interface BookPage {
  id: string;
  title: string;
  doc: JSONContent;
}
export interface BookSearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex?: boolean;
}
export interface BookSearchResult {
  total: number;
  pages: { id: string; title: string; count: number }[];
}
export interface DocMatch {
  path: number[];
  from: number;
  to: number;
}

const isText = (n: JSONContent) => n.type === "text";

/** Splits `content` into runs of adjacent text nodes; returns [startIndex, endIndexExclusive] pairs. */
function runsOf(content: JSONContent[]): [number, number][] {
  const runs: [number, number][] = [];
  let i = 0;
  while (i < content.length) {
    if (!isText(content[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < content.length && isText(content[j]!)) j++;
    runs.push([i, j]);
    i = j;
  }
  return runs;
}

const runText = (nodes: JSONContent[]) => nodes.map((n) => n.text ?? "").join("");

export function findInDoc(doc: JSONContent, opts: BookSearchOptions): DocMatch[] {
  if (!opts.query) return [];
  const out: DocMatch[] = [];
  const walk = (node: JSONContent, path: number[]) => {
    const content = node.content;
    if (!content) return;
    for (const [a, b] of runsOf(content)) {
      for (const r of findInText(runText(content.slice(a, b)), opts.query, opts))
        if (!opts.regex || out.length < MAX_MATCHES) out.push({ path, from: r.from, to: r.to });
    }
    content.forEach((child, i) => {
      if (!isText(child)) walk(child, [...path, i]);
    });
  };
  walk(doc, []);
  return out;
}

export function searchBook(pages: BookPage[], opts: BookSearchOptions): BookSearchResult {
  const result: BookSearchResult = { total: 0, pages: [] };
  if (!opts.query) return result;
  for (const page of pages) {
    const count = findInDoc(page.doc, opts).length;
    if (!count) continue;
    result.total += count;
    result.pages.push({ id: page.id, title: page.title, count });
  }
  return result;
}

/** Rebuilds one run of text nodes with the matches replaced. */
function replaceRun(
  nodes: JSONContent[],
  opts: BookSearchOptions,
  replacement: string,
): { nodes: JSONContent[]; count: number } {
  // No match cap when replacing: the cap is a display guard, and stopping at it would leave matches behind.
  const ranges = findInText(runText(nodes), opts.query, { ...opts, limit: Infinity });
  if (!ranges.length) return { nodes, count: 0 };
  const out: JSONContent[] = [];
  const push = (src: JSONContent, t: string) => {
    if (t) out.push({ ...src, text: t });
  };
  let ri = 0;
  let start = 0;
  for (const node of nodes) {
    const t = node.text ?? "";
    const end = start + t.length;
    let at = start;
    while (at < end) {
      const r = ranges[ri];
      if (!r || r.from >= end) {
        push(node, t.slice(at - start));
        break;
      }
      if (r.from > at) {
        push(node, t.slice(at - start, r.from - start));
        at = r.from;
      }
      // `at` is inside a match: it starts here, or began in an earlier node (then nothing is emitted).
      if (at === r.from) push(node, expandReplacement(r, replacement, opts.regex));
      if (r.to <= end) {
        at = r.to;
        ri++;
      } else at = end;
    }
    start = end;
  }
  return { nodes: out, count: ranges.length };
}

export function replaceInDoc(
  doc: JSONContent,
  opts: BookSearchOptions,
  replacement: string,
): { doc: JSONContent; count: number } {
  if (!opts.query) return { doc, count: 0 };
  let count = 0;
  const walk = (node: JSONContent): JSONContent => {
    const content = node.content;
    if (!content) return node;
    const next: JSONContent[] = [];
    let changed = false;
    let cursor = 0;
    const copyThrough = (to: number) => {
      for (; cursor < to; cursor++) {
        const child = content[cursor]!;
        const c = walk(child);
        changed ||= c !== child;
        next.push(c);
      }
    };
    for (const run of runsOf(content)) {
      copyThrough(run[0]);
      const r = replaceRun(content.slice(run[0], run[1]), opts, replacement);
      if (r.count) {
        changed = true;
        count += r.count;
      }
      next.push(...r.nodes);
      cursor = run[1];
    }
    copyThrough(content.length);
    return changed ? { ...node, content: next } : node;
  };
  return { doc: walk(doc), count };
}
