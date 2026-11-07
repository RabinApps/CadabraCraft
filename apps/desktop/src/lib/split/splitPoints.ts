import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { extractOutline } from "../outline";

/** A place a chapter can be cut: the top-level heading at `block` of the document's content starts the second half. */
export interface SplitPoint {
  /** Index in `doc.content` of the heading block. Never 0 (that would leave the first half empty). */
  block: number;
  level: number;
  text: string;
}

const blocksOf = (doc: ChapterDoc): readonly DocNode[] => doc.content ?? [];

/** Headings inside a node, itself included, in document order (the same count `extractOutline` numbers by). */
const headingsIn = (node: DocNode): number =>
  node.type === "text"
    ? 0
    : (node.type === "heading" ? 1 : 0) +
      (node.content ?? []).reduce((n, child) => n + headingsIn(child), 0);

/**
 * The headings a chapter can be cut at, in reading order: top-level headings with text (found with `extractOutline`, so
 * the text and level match the outline navigator) strictly after block `from` and before block `to` (default: the
 * whole document). A heading inside a scene, a quote or a list is not a cut point: it would split that block.
 */
export function splitPoints(
  doc: ChapterDoc,
  from = 0,
  to: number = blocksOf(doc).length,
): SplitPoint[] {
  const outline = new Map(extractOutline(doc).map((o) => [o.index, o]));
  const points: SplitPoint[] = [];
  let ordinal = 0;
  blocksOf(doc).forEach((node, block) => {
    if (node.type === "heading" && block > from && block < to) {
      const item = outline.get(ordinal);
      if (item) points.push({ block, level: item.level, text: item.text });
    }
    ordinal += headingsIn(node);
  });
  return points;
}

/** A copy of `doc` holding only blocks `from` up to (not including) `to`. */
export const sliceDoc = (doc: ChapterDoc, from: number, to: number): ChapterDoc => ({
  ...doc,
  content: blocksOf(doc).slice(from, to),
});

/** The two halves of a chapter cut before top-level block `block`. Throws when `block` is not inside the document. */
export function cutDoc(doc: ChapterDoc, block: number): { head: ChapterDoc; tail: ChapterDoc } {
  const n = blocksOf(doc).length;
  if (!Number.isInteger(block) || block <= 0 || block >= n)
    throw new RangeError(`cannot cut a ${n} block chapter before block ${block}`);
  return { head: sliceDoc(doc, 0, block), tail: sliceDoc(doc, block, n) };
}
