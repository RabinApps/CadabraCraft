import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { wordStarts } from "@cadabracraft/shared";
import type { BlockMarkKind } from "@cadabracraft/export-pdf";
import type { ExactLeaf } from "../../lib/exactBreaks";
import type { DocWord } from "../../lib/pageWords";

/**
 * The editor's side of Typst's page marks (see `lib/exactBreaks.ts`): which nodes of a chapter the exporter marks (its leaves), what
 * kind each is by the exporter's own rule (`BlockMarkKind`), and their words, counted by the same function the exporter marked them
 * with (`wordStarts`).
 */

/** The inline items of a text block as `wordStarts` takes them: text, a footnote as the positions it takes, a hard break as null. */
export function plainItems(node: PMNode): (string | number | null)[] {
  const items: (string | number | null)[] = [];
  node.forEach((child) => {
    if (child.isText) items.push(child.text ?? "");
    else if (child.type.name === "footnote") items.push(child.nodeSize);
    else items.push(null);
  });
  return items;
}

const KINDS: Readonly<Record<string, BlockMarkKind>> = {
  paragraph: "p",
  definitionTerm: "p",
  heading: "h",
  sceneBreak: "s",
  image: "i",
  codeBlock: "k",
};

/** A node the exporter marks as a whole (one start mark, and words or lines inside it). */
export const isLeaf = (node: PMNode): boolean => node.type.name in KINDS;

/** A paragraph the exporter leaves out because it has no text (only unmarked spaces and tabs, or nothing). */
function isBlank(node: PMNode): boolean {
  if (node.type.name !== "paragraph") return false;
  let blank = true;
  node.forEach((child) => {
    if (!child.isText || child.marks.length > 0 || !/^[ \t]*$/.test(child.text ?? ""))
      blank = false;
  });
  return blank;
}

/** A table whose first row is all header cells has it repeated on every page, so the exporter marks nothing in it. */
export function hasHeaderRow(table: PMNode): boolean {
  if (table.type.name !== "table" || table.childCount === 0) return false;
  const row = table.child(0);
  let all = row.childCount > 0;
  row.forEach((cell) => {
    if (cell.type.name !== "tableHeader") all = false;
  });
  return all;
}

/** Number of words of a text leaf, of lines of a block of code, 0 for the rest. */
export function leafWords(node: PMNode): number {
  const kind = KINDS[node.type.name];
  if (kind === "k") return node.textContent.split("\n").length;
  return kind === "p" || kind === "h" ? wordStarts(plainItems(node)).length : 0;
}

/** A leaf of the document: the node, the position before it and its facts for `exactBreaks`. */
export interface DocLeaf extends ExactLeaf {
  node: PMNode;
  pos: number;
}

/** The leaves of every top-level block in document order (the exporter's order), with the header row of a table left out. */
export function docLeaves(doc: PMNode): DocLeaf[][] {
  const out: DocLeaf[][] = [];
  const make = (node: PMNode, pos: number): DocLeaf => ({
    node,
    pos,
    kind: KINDS[node.type.name]!,
    blank: isBlank(node),
    words: leafWords(node),
  });
  doc.forEach((block, offset) => {
    if (isLeaf(block)) return out.push([make(block, offset)]);
    const leaves: DocLeaf[] = [];
    block.descendants((node, pos, parent, index) => {
      if (isLeaf(node)) {
        leaves.push(make(node, offset + 1 + pos));
        return false;
      }
      // The header row is the table's first child.
      return !(parent && index === 0 && node.type.name === "tableRow" && hasHeaderRow(parent));
    });
    out.push(leaves);
  });
  return out;
}

/**
 * The words of a text leaf as text with the offset `wordOffset` gives, for matching them against the words a PDF page shows (the
 * preview's jump to the word under the click). A block of code has none: its marks are lines.
 */
export function leafWordTexts(node: PMNode): { text: string; offset: number }[] {
  const kind = KINDS[node.type.name];
  if (kind !== "p" && kind !== "h") return [];
  const items = plainItems(node);
  // The flat text as `wordStarts` counts it: a footnote and a hard break are characters that belong to no word.
  const flat = items
    .map((i) => (typeof i === "string" ? i : typeof i === "number" ? "\uE000".repeat(i) : "\uE001"))
    .join("");
  return wordStarts(items).map((offset) => ({
    offset,
    text: /^[^ \t\uE000\uE001]+/.exec(flat.slice(offset))![0],
  }));
}

/** The offset inside a text leaf's content (a document position is the leaf's start + 1 + this) of word `word` (line `word` for code), or null. */
export function wordOffset(node: PMNode, word: number): number | null {
  if (node.type.name === "codeBlock") {
    const lines = node.textContent.split("\n");
    if (word >= lines.length) return null;
    return lines.slice(0, word).reduce((sum, l) => sum + l.length + 1, 0);
  }
  return wordStarts(plainItems(node))[word] ?? null;
}

/** Table cells go whole to a page: Typst starting a page inside a row cannot be drawn. */
const isCell = (node: PMNode): boolean =>
  node.type.name === "tableCell" || node.type.name === "tableHeader";

/** The position is inside a table cell. */
export function insideCell(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let d = 1; d <= $pos.depth; d++) if (isCell($pos.node(d))) return true;
  return false;
}

/**
 * Where a page that begins at the leaf at `pos` begins in the flow: the position before the outermost node that starts with that leaf
 * (the list item, table row or nested list it begins, so a spacer sits between items and not inside the first one), `top` true when
 * that is the top-level block itself, or null when no spacer can be drawn there (the page begins in the middle of a table row).
 */
export function pageStartAt(doc: PMNode, pos: number): { pos: number; top: boolean } | null {
  const $pos: ResolvedPos = doc.resolve(pos);
  let depth = $pos.depth;
  let index = $pos.index();
  // The first child of a table with a header row is the second row.
  const first = (d: number): number => (hasHeaderRow($pos.node(d)) ? 1 : 0);
  while (depth > 0 && index <= first(depth)) {
    index = $pos.index(depth - 1);
    depth--;
  }
  if (isCell($pos.node(depth).child(index)) || insideCell(doc, $pos.posAtIndex(index, depth)))
    return null;
  return { pos: $pos.posAtIndex(index, depth), top: depth === 0 };
}

/** The words of a leaf with their document positions: those of a paragraph, heading or definition term as the exporter counts them, those of a block of code by spaces. */
function leafWordsAt(leaf: DocLeaf): DocWord[] {
  const base = leaf.pos + 1;
  if (leaf.kind === "k")
    return [...leaf.node.textContent.matchAll(/\S+/g)].map((m) => ({
      text: m[0],
      pos: base + m.index!,
    }));
  return leafWordTexts(leaf.node).map((w) => ({ text: w.text, pos: base + w.offset }));
}

/**
 * The words of the chapter from document position `from` on (the word at it, or the first after it), at most `limit` of them, in
 * document order: what the text of a PDF page that begins at `from` is compared with (`alignWord`). A table's header row has none.
 */
export function wordsFrom(doc: PMNode, from: number, limit: number): DocWord[] {
  const out: DocWord[] = [];
  for (const leaves of docLeaves(doc))
    for (const leaf of leaves) {
      if (leaf.pos + leaf.node.nodeSize <= from) continue;
      for (const word of leafWordsAt(leaf)) {
        if (word.pos < from) continue;
        out.push(word);
        if (out.length >= limit) return out;
      }
    }
  return out;
}
