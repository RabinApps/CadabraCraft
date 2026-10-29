import type { BlockMarkKind, BlockPages } from "@cadabracraft/export-pdf";

/** What Typst reported for one chapter, as Page view needs it. */
export interface ExactSource {
  /** Physical page the chapter starts on (the report's `page` for it). */
  base: number;
  /** Physical page its last block ends on, as the report's own entry says. */
  end: number;
  blocks: BlockPages[];
}

/** A page of the chapter begins here: before a block (`word` null), or before a word of an ordinary paragraph (`wordStarts` index). */
export interface ExactBreak {
  block: number;
  word: number | null;
}

/** Kinds whose last page the marks cannot tell from the page the next block starts on, unless that is the same page. */
const BOUNDED: ReadonlySet<BlockMarkKind> = new Set(["q", "h", "o"]);

/**
 * The page breaks Typst made inside a chapter, as positions in the editor's document, or null when the marks cannot be trusted for
 * this document (then Page view keeps its estimate): the blocks the report knows must be the blocks the document has, of the same
 * kind (`kinds` is one per top-level node; a node the report skipped must be a paragraph, the exporter leaves out blank ones), the
 * pages must follow one another without gaps, a word a page begins with must exist in the paragraph (`wordCount`), and a block the
 * report cannot see the end of (anything but an ordinary paragraph or a scene break) must not be followed by a later page.
 *
 * Edits since the report only matter where they change that structure; typing inside a paragraph keeps the breaks where they were
 * until the next measure.
 */
export function exactBreaks(
  src: ExactSource,
  kinds: readonly BlockMarkKind[],
  wordCount: (block: number) => number,
): ExactBreak[] | null {
  const { blocks, base } = src;
  let known = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (blocks[known]?.block === i) {
      if (blocks[known]!.kind !== kinds[i]) return null;
      known++;
    } else if (kinds[i] !== "p" && kinds[i] !== "q") return null;
  }
  if (known !== blocks.length) return null;

  const out: ExactBreak[] = [];
  let page = 0;
  for (let k = 0; k < blocks.length; k++) {
    const m = blocks[k]!;
    const start = m.page - base;
    if (k === 0 ? start !== 0 : start !== page && start !== page + 1) return null;
    if (start === page + 1) {
      out.push({ block: m.block, word: null });
      page = start;
    }
    if (m.splits.length > 0) {
      if (m.kind !== "p") return null;
      const words = wordCount(m.block);
      let prev = 0;
      for (const s of m.splits) {
        if (s.page - base !== page + 1 || s.word <= prev || s.word >= words) return null;
        out.push({ block: m.block, word: s.word });
        page++;
        prev = s.word;
      }
    }
    if (BOUNDED.has(m.kind)) {
      const next = (blocks[k + 1]?.page ?? src.end) - base;
      if (next !== page) return null;
    }
  }
  return src.end - base >= page ? out : null;
}
