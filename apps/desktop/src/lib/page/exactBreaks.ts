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
  /**
   * Set for a leaf in a body row of a table: its row (the index among the table's rows) and its cell (the index in the row). Typst
   * lays a row out cell by cell on the same pages, and can end a page inside it, so these leaves are not one sequence.
   */
  cell?: { row: number; cell: number };
}

/** Where a page begins inside one cell of a table row: before a paragraph of the cell (`word` null) or at a word of one (`char` as in `ExactBreak`). */
export interface ExactCut {
  leaf: number;
  word: number | null;
  char?: number;
}

/**
 * A page of the chapter begins here: before the `leaf`th leaf (document order, blank ones counted) of a top-level block (`word`
 * null), or before a word of that leaf (`wordStarts` index; the line, from 0, for code), or `char` characters into that word (Typst
 * hyphenated it, or broke it after a hyphen, at the page break).
 *
 * A page that begins inside a table row has `cuts`: where it begins in each cell of the row that runs onto it (the cells that end
 * before it have none), in document order; `leaf`, `word` and `char` are the first of them. `rowStart` is a page that begins at a
 * table row, before its first cell with text (`leaf`), where the cell that has it need not be the first.
 */
export interface ExactBreak {
  block: number;
  leaf: number;
  word: number | null;
  char?: number;
  cuts?: ExactCut[];
  /** With `cuts`: the table row (`ExactLeaf.cell.row`) the page begins in; the break after it in the same row has the same number. */
  row?: number;
  rowStart?: true;
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
    const list = leaves[i]!;
    for (let j = 0; j < list.length; j++) {
      const leaf = list[j]!;
      if (leaf.cell) {
        // The cells of one row: they all start on the row's page, and each runs on from there by itself.
        let end = j;
        while (end < list.length && list[end]!.cell?.row === leaf.cell.row) end++;
        const row = rowBreaks(src, i, list, j, end, at, page);
        if (!row) return null;
        out.push(...row.breaks);
        at = row.at;
        page = row.page;
        j = end - 1;
        continue;
      }
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

/**
 * The breaks inside one table row (`list[from..end)` are its leaves, `at` the report's next unit, `page` the page the table is on so
 * far), or null. Typst starts every cell of a row on the row's page; a cell runs onto the next page where its own text reaches the foot
 * of this one, so each cell's paragraphs follow one another from the row's page, and a page that begins inside the row begins in every
 * cell that is still going, at its own place. The row has a break per page it runs onto, each with the cuts of those cells, and a break
 * before the row when it starts a page.
 */
function rowBreaks(
  src: ExactSource,
  block: number,
  list: readonly ExactLeaf[],
  from: number,
  end: number,
  at: number,
  page: number,
): { breaks: ExactBreak[]; at: number; page: number } | null {
  const { blocks, base } = src;
  const breaks: ExactBreak[] = [];
  const first = list.findIndex((l, k) => k >= from && k < end && !l.blank);
  // A row of blank cells has no marks at all.
  if (first < 0) return { breaks, at, page };
  const rowStart = (blocks[at]?.page ?? 0) - base;
  if (at === 0 ? rowStart !== 0 : rowStart !== page && rowStart !== page + 1) return null;
  if (rowStart === page + 1) breaks.push({ block, leaf: first, word: null, rowStart: true });
  // Per cell: the page its last paragraph has reached; per page the row runs onto: where it begins in each cell.
  const cellPage = new Map<number, number>();
  const cuts = new Map<number, ExactCut[]>();
  const add = (p: number, cut: ExactCut) => cuts.set(p, [...(cuts.get(p) ?? []), cut]);
  let last = rowStart;
  for (let j = from; j < end; j++) {
    const leaf = list[j]!;
    if (leaf.blank) continue;
    const m = blocks[at++];
    if (m?.block !== block || m.kind !== leaf.kind) return null;
    const cell = leaf.cell!.cell;
    const start = m.page - base;
    const known = cellPage.get(cell);
    // The first paragraph of a cell is at the top of the row; a later one follows the one before it, on its last page or the next.
    if (known === undefined ? start !== rowStart : start !== known && start !== known + 1)
      return null;
    let now = known ?? rowStart;
    if (start === now + 1) {
      add(start, { leaf: j, word: null });
      now = start;
    }
    if (m.splits.length > 0 && !SPLITS.has(m.kind)) return null;
    let prev = 0;
    for (const s of m.splits) {
      if (s.page - base !== now + 1 || s.word <= prev || s.word >= leaf.words) return null;
      add(s.page - base, {
        leaf: j,
        word: s.word,
        ...(s.char === undefined ? {} : { char: s.char }),
      });
      now++;
      prev = s.word;
    }
    cellPage.set(cell, now);
    last = Math.max(last, now);
  }
  for (let p = rowStart + 1; p <= last; p++) {
    // Every page the row reaches has a cut: a cell gets to a page only through the one before it.
    const here = cuts.get(p)!;
    const head = here[0]!;
    breaks.push({
      block,
      leaf: head.leaf,
      word: head.word,
      ...(head.char === undefined ? {} : { char: head.char }),
      cuts: here,
      row: list[from]!.cell!.row,
    });
  }
  return { breaks, at, page: last };
}
