import type { BlockMarkKind, BlockPages } from "@cadabracraft/export-pdf";

/** What Typst reported for one chapter, as Page view needs it. */
export interface ExactSource {
  /** Physical page the chapter starts on (the report's `page` for it). */
  base: number;
  /** Physical page its last block ends on, as the report's own entry says. */
  end: number;
  blocks: BlockPages[];
}

/**
 * A leaf of the editor's document the way the exporter marks it (a paragraph, heading, scene break, image, block of code or
 * definition term; a quote, list or table is its leaves): what it is, whether the exporter leaves it out (a paragraph with no text),
 * and how many words (lines, for code) it has.
 */
export interface ExactLeaf {
  kind: BlockMarkKind;
  blank: boolean;
  words: number;
}

/**
 * A page of the chapter begins here: before the `leaf`th leaf (document order, blank ones counted) of a top-level block (`word`
 * null), or before a word of that leaf (`wordStarts` index; the line, from 0, for code), or `char` characters into that word (Typst
 * hyphenated it, or broke it after a hyphen, at the page break).
 */
export interface ExactBreak {
  block: number;
  leaf: number;
  word: number | null;
  char?: number;
}

/** Kinds the marks can see the middle of: Typst can end a page inside them. */
const SPLITS: ReadonlySet<BlockMarkKind> = new Set(["p", "h", "k"]);

/**
 * The page breaks Typst made inside a chapter, as positions in the editor's document, or null when the marks cannot be trusted for
 * this document (then Page view keeps its estimate for the whole chapter): the leaves the report knows must be the leaves the
 * document has, of the same kind and in the same order (`leaves` is one list per top-level node; the blank ones the exporter leaves
 * out are skipped), pages must follow one another without gaps, a scene break or an image must not run onto another page, and a word
 * a page begins with must exist in its leaf.
 *
 * Edits since the report only matter where they change that structure; typing inside a paragraph keeps the breaks where they were
 * until the next measure.
 */
export function exactBreaks(
  src: ExactSource,
  leaves: readonly (readonly ExactLeaf[])[],
): ExactBreak[] | null {
  const { blocks, base } = src;
  const out: ExactBreak[] = [];
  let at = 0;
  let page = 0;
  for (let i = 0; i < leaves.length; i++) {
    for (let j = 0; j < leaves[i]!.length; j++) {
      const leaf = leaves[i]![j]!;
      if (leaf.blank) continue;
      const m = blocks[at++];
      if (m?.block !== i || m.kind !== leaf.kind) return null;
      const start = m.page - base;
      if (at === 1 ? start !== 0 : start !== page && start !== page + 1) return null;
      if (start === page + 1) {
        out.push({ block: i, leaf: j, word: null });
        page = start;
      }
      if (m.splits.length > 0 && !SPLITS.has(m.kind)) return null;
      let prev = 0;
      for (const s of m.splits) {
        if (s.page - base !== page + 1 || s.word <= prev || s.word >= leaf.words) return null;
        out.push({
          block: i,
          leaf: j,
          word: s.word,
          ...(s.char === undefined ? {} : { char: s.char }),
        });
        page++;
        prev = s.word;
      }
    }
  }
  if (at !== blocks.length) return null;
  return src.end - base >= page ? out : null;
}
