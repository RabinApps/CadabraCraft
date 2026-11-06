import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { PageBreak } from "../../lib/page/pageLayout";
import { exactBreaks } from "../../lib/page/exactBreaks";
import type { FlowBlock } from "./core";
import { flowY, splitY } from "./dom";
import {
  docLeaves,
  insideCell,
  leafWordTexts,
  pageStartAt,
  rowAround,
  wordOffset,
  type DocLeaf,
} from "./exact";
import { rowBreak } from "./rows";
import type { PageConfig } from "./plugin";

type Placed = NonNullable<PageBreak["at"]>;
type TypstBreaks = NonNullable<ReturnType<typeof exactBreaks>>;
type TypstBreak = TypstBreaks[number];

/** Everything the breaks of one chapter are made from, and what is learned along the way. */
interface Env {
  v: EditorView;
  c: PageConfig;
  doc: PMNode;
  blocks: FlowBlock[];
  leaves: DocLeaf[][];
  exactPos: Map<string, number>;
  /** Per block: the breaks made inside it so far and where the last one is. */
  inside: Map<number, { n: number; y: number }>;
  /** Per cell of the table row being cut: where its text was cut last (the position of the cell's start is its identity). */
  row: { cellY: Map<number, number> };
}

/** Notes a break made inside `block` at flow position `y`, document position `pos`; its number there, or null when it is not below the last. */
function recordInside(env: Env, block: number, y: number, pos: number): number | null {
  const prev = env.inside.get(block);
  if (prev && y <= prev.y) return null;
  const n = (prev?.n ?? 0) + 1;
  env.inside.set(block, { n, y });
  env.exactPos.set(`${block}:${n}`, pos);
  return n;
}

/** A page that begins inside a table row: it begins in each cell that runs onto it, at that cell's own place. */
function breakInRow(
  env: Env,
  typst: TypstBreaks,
  k: number,
  flow: FlowBlock,
): PageBreak | undefined {
  const b = typst[k]!;
  const sameRow = (o: TypstBreak | undefined): boolean =>
    !!o?.cuts && o.block === b.block && o.row === b.row;
  if (!sameRow(typst[k - 1])) env.row.cellY = new Map();
  const last = !sameRow(typst[k + 1]);
  const cut = rowBreak(
    { v: env.v, c: env.c, doc: env.doc, flow },
    env.leaves[b.block]!,
    b.cuts!,
    env.row.cellY,
    last,
  );
  if (!cut) return undefined;
  const n = recordInside(env, b.block, cut.at.y, cut.at.cuts![0]!.pos);
  if (n === null) return undefined;
  return { block: b.block, linesBefore: n, blankBefore: false, at: cut.at };
}

type Start = { pos: number; at: Placed } | "top" | undefined;

/** A page that begins at a block or at an item of it (a list item, a row, a paragraph of a quote). */
function startAtNode(env: Env, b: TypstBreak, flow: FlowBlock, leaf: DocLeaf): Start {
  const { doc } = env;
  // A page that begins at a row begins before it, whichever of its cells has the first text.
  const rowFirst = b.rowStart ? rowAround(doc, leaf.pos)?.row.cells[0]?.from : undefined;
  const start = pageStartAt(doc, rowFirst ?? leaf.pos);
  if (!start) return undefined;
  if (start.top) return "top";
  const f = flowY(env.v, flow, start.pos, env.c.zoom, env.c.geometry.margins.top);
  if (!f) return undefined;
  return { pos: start.pos, at: { y: f.y, flow: true, marginBottom: f.marginBottom } };
}

/** A page that begins at a word of a paragraph. */
function startAtWord(env: Env, b: TypstBreak, flow: FlowBlock, leaf: DocLeaf): Start {
  const offset = wordOffset(leaf.node, b.word!);
  // A page cannot begin in the middle of a table row, nor inside a word the text no longer has that many characters of.
  if (offset === null || insideCell(env.doc, leaf.pos)) return undefined;
  if (b.char !== undefined && !(b.char < (leafWordTexts(leaf.node)[b.word!]?.text.length ?? 0)))
    return undefined;
  const pos = leaf.pos + 1 + offset + (b.char ?? 0);
  const scale = { zoom: env.c.zoom, columnTop: env.c.geometry.margins.top };
  const y = splitY(env.v, flow, leaf.pos, pos, scale);
  return y === null ? undefined : { pos, at: { y, flow: false } };
}

/** A page that begins at a block, or at a word, list item or paragraph inside one. */
function breakAtPoint(
  env: Env,
  b: TypstBreak,
  flow: FlowBlock,
  leaf: DocLeaf,
): PageBreak | undefined {
  const start = b.word === null ? startAtNode(env, b, flow, leaf) : startAtWord(env, b, flow, leaf);
  if (!start) return undefined;
  if (start === "top") return { block: b.block, linesBefore: 0, blankBefore: false };
  const n = recordInside(env, b.block, start.at.y, start.pos);
  if (n === null) return undefined;
  return { block: b.block, linesBefore: n, blankBefore: false, at: start.at };
}

/** True when the author has put a page break in the text. */
function hasPageBreak(doc: PMNode): boolean {
  let found = false;
  doc.forEach((n) => {
    if (n.type.name === "pageBreak") found = true;
  });
  return found;
}

/**
 * Typst's page breaks for this text as `paginate` takes them, or undefined when its marks do not fit the text or a break cannot be
 * placed (the estimate is used then, for the whole chapter). A page that begins at a block is a break before it. One that begins
 * inside a block (a word of a paragraph, an item of a list, a row of a table) is a break at a position of the document: `exactPos`
 * gets it, and the break says where in the flow it falls (`at.y`, read from the DOM) for the heights of the spacers and cards.
 */
export function forcedBreaks(
  v: EditorView,
  c: PageConfig,
  blocks: FlowBlock[],
  exactPos: Map<string, number>,
): PageBreak[] | undefined {
  const doc = v.state.doc;
  // The report comes from a render of the text as it was then, and it has no way to say that the author has since put a page break
  // in it: its pages would leave the break out, and the cards would disagree with the PDF. The estimate honours every break instead,
  // and the chip says the breaks are approximate until the text is rendered again.
  if (hasPageBreak(doc)) return undefined;
  const leaves = docLeaves(doc);
  const typst = exactBreaks(c.exact!, leaves);
  if (!typst) return undefined;
  const env: Env = {
    v,
    c,
    doc,
    blocks,
    leaves,
    exactPos,
    inside: new Map(),
    row: { cellY: new Map() },
  };
  const out: PageBreak[] = [];
  for (let k = 0; k < typst.length; k++) {
    const b = typst[k]!;
    const flow = blocks[b.block];
    const leaf = leaves[b.block]?.[b.leaf];
    if (!flow || !leaf) return undefined;
    const made = b.cuts ? breakInRow(env, typst, k, flow) : breakAtPoint(env, b, flow, leaf);
    if (!made) return undefined;
    out.push(made);
  }
  return out;
}
