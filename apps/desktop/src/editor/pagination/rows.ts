import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { CellCut, DocSpan, PageBreak } from "../../lib/pageLayout";
import type { ExactCut } from "../../lib/exactBreaks";
import type { FlowBlock } from "./core";
import { flowY, nodeBottomY, splitY } from "./dom";
import { leafWordTexts, rowAround, wordOffset, type DocLeaf } from "./exact";
import type { PageConfig } from "./plugin";

/**
 * A page that begins inside a table row, as one break with a cut per cell that runs onto it, or null when one cannot be placed (then
 * the chapter keeps the estimate). Typst lays the cells of a row side by side and cuts each at the foot of the page; each cell gets a
 * spacer at its own cut, sized by where its own text was cut, so every cell's next lines start at the top of the next page and the
 * row is as tall as its tallest cell. What follows the row sits where the cell that runs longest puts it, so the break's `y` (the
 * page's end in the flow, from which the next page is counted) is where that cell was cut, less what the others add to the row
 * (`last`: the final page of the row), or the lowest cut of the page before it.
 */
export function rowBreak(
  v: EditorView,
  c: PageConfig,
  doc: PMNode,
  flow: FlowBlock,
  leaves: DocLeaf[],
  cuts: ExactCut[],
  cellY: Map<number, number>,
  last: boolean,
): { at: NonNullable<PageBreak["at"]> } | null {
  const top = c.geometry.margins.top;
  const made: CellCut[] = [];
  for (const cut of cuts) {
    const leaf = leaves[cut.leaf];
    const around = leaf ? rowAround(doc, leaf.pos) : null;
    if (!leaf || !around) return null;
    let pos: number;
    let y: number;
    let marginBottom = 0;
    if (cut.word === null) {
      const f = flowY(v, flow, leaf.pos, c.zoom, top);
      if (!f) return null;
      pos = leaf.pos;
      y = f.y;
      marginBottom = f.marginBottom;
    } else {
      const offset = wordOffset(leaf.node, cut.word);
      if (offset === null) return null;
      if (
        cut.char !== undefined &&
        !(cut.char < (leafWordTexts(leaf.node)[cut.word]?.text.length ?? 0))
      )
        return null;
      pos = leaf.pos + 1 + offset + (cut.char ?? 0);
      const at = splitY(v, flow, leaf.pos, pos, c.zoom, top);
      if (at === null) return null;
      y = at;
    }
    const prevY = cellY.get(around.cell.from) ?? null;
    if (prevY !== null && y <= prevY) return null;
    cellY.set(around.cell.from, y);
    made.push({
      pos,
      y,
      prevY,
      inline: cut.word !== null,
      marginBottom,
      cell: around.cell,
      row: around.row,
    });
  }
  let y = Math.max(...made.map((m) => m.y));
  if (last) {
    // The bottom of a cell's text in the flow without spacers.
    const bottom = (cell: DocSpan): number | null => {
      const child = doc.resolve(cell.to).nodeBefore;
      return child ? nodeBottomY(v, flow, cell.to - child.nodeSize, c.zoom, top) : null;
    };
    const bottoms = made[0]!.row.cells.map(bottom);
    const tails = made.map((m) => bottom(m.cell));
    if (bottoms.includes(null) || tails.includes(null)) return null;
    y =
      Math.max(...(bottoms as number[])) -
      Math.max(...made.map((m, i) => (tails[i] as number) - m.y));
  }
  return { at: { y, flow: true, marginBottom: 0, cuts: made } };
}
