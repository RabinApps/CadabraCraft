import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { PageGeometry } from "../../lib/page/pageLayout";
import { createBlockCache } from "./cache";
import { PAGE_GAP, layoutPages, withTops, type FlowBlock, type PageLayoutResult } from "./core";
import { buildDecorations, type GapWidgetSpec } from "./decorations";
import { rowBreak } from "./rows";
import type { PageBreak } from "../../lib/page/pageLayout";
import { exactBreaks, type ExactSource } from "../../lib/page/exactBreaks";
import { cursorPage, findSplitPos, flowY, measureFlow, readPageTops, splitY } from "./dom";
import { docLeaves, insideCell, leafWordTexts, pageStartAt, rowAround, wordOffset } from "./exact";

/** What the pagination needs to know; set by the Page view frame, null (or `on: false`) when Page view is off. */
export interface PageConfig {
  on: boolean;
  geometry: PageGeometry;
  /** Extra height a DOM page holds beyond the text box (see `pageFillSlackPx`). */
  slackPx: number;
  firstPage: number;
  startsOn: "recto" | "any";
  opensChapter: boolean;
  /** A blank verso comes first (the book layout's `blankBefore`). */
  blankBefore: boolean;
  zoom: number;
  /** Typst's marks for this chapter: where its pages break. Null (or marks that do not fit the text) keeps the estimate. */
  exact: ExactSource | null;
  /** Changes whenever `exact` does (a new report), so a new measure re-paginates. */
  exactKey: string;
  /** Everything else the text layout depends on (template, font, trim): a change re-paginates and drops the style cache. */
  layoutKey: string;
  /** Called with the cards after every pagination, and with the cursor's page (0-based) when it moves. */
  onLayout: (layout: PageLayoutResult) => void;
  onCursorPage: (page: number) => void;
}

/** Wait after the last edit before measuring: typing never waits for it. */
const TYPING_DELAY_MS = 120;
const CURSOR_DELAY_MS = 80;

const configKey = (c: PageConfig): string =>
  JSON.stringify([
    c.geometry.page,
    c.geometry.margins,
    c.slackPx,
    c.firstPage,
    c.startsOn,
    c.opensChapter,
    c.blankBefore,
    c.layoutKey,
    c.exactKey,
    c.zoom,
  ]);

type Meta = { type: "set"; set: DecorationSet } | { type: "clear" };
export const paginationKey = new PluginKey<DecorationSet>("pagination");

/**
 * Typst's page breaks for this text as `paginate` takes them, or undefined when its marks do not fit the text or a break cannot be
 * placed (the estimate is used then, for the whole chapter). A page that begins at a block is a break before it. One that begins
 * inside a block (a word of a paragraph, an item of a list, a row of a table) is a break at a position of the document: `exactPos`
 * gets it, and the break says where in the flow it falls (`at.y`, read from the DOM) for the heights of the spacers and cards.
 */
function forcedBreaks(
  v: EditorView,
  c: PageConfig,
  blocks: FlowBlock[],
  exactPos: Map<string, number>,
): PageBreak[] | undefined {
  const doc = v.state.doc;
  // The report comes from a render of the text as it was then, and it has no way to say that the author has since put a page break
  // in it: its pages would leave the break out, and the cards would disagree with the PDF. The estimate honours every break instead,
  // and the chip says the breaks are approximate until the text is rendered again.
  let breaksPages = false;
  doc.forEach((n) => {
    if (n.type.name === "pageBreak") breaksPages = true;
  });
  if (breaksPages) return undefined;
  const leaves = docLeaves(doc);
  const typst = exactBreaks(c.exact!, leaves);
  if (!typst) return undefined;
  const top = c.geometry.margins.top;
  const out: PageBreak[] = [];
  // Per block: the breaks made inside it so far and where the last one is.
  const inside = new Map<number, { n: number; y: number }>();
  // Per cell of the table row being cut: where its text was cut last (the position of the cell's start is its identity).
  let cellY = new Map<number, number>();
  for (let k = 0; k < typst.length; k++) {
    const b = typst[k]!;
    const flow = blocks[b.block];
    const leaf = leaves[b.block]?.[b.leaf];
    if (!flow || !leaf) return undefined;
    let pos: number;
    let at: NonNullable<PageBreak["at"]>;
    if (b.cuts) {
      // A page that begins inside a table row: it begins in each cell that runs onto it, at that cell's own place.
      const sameRow = (o: (typeof typst)[number] | undefined): boolean =>
        !!o?.cuts && o.block === b.block && o.row === b.row;
      if (!sameRow(typst[k - 1])) cellY = new Map();
      const last = !sameRow(typst[k + 1]);
      const cut = rowBreak(v, c, doc, flow, leaves[b.block]!, b.cuts, cellY, last);
      if (!cut) return undefined;
      const prev = inside.get(b.block);
      if (prev && cut.at.y <= prev.y) return undefined;
      const n = (prev?.n ?? 0) + 1;
      inside.set(b.block, { n, y: cut.at.y });
      exactPos.set(`${b.block}:${n}`, cut.at.cuts![0]!.pos);
      out.push({ block: b.block, linesBefore: n, blankBefore: false, at: cut.at });
      continue;
    }
    if (b.word === null) {
      // A page that begins at a row begins before it, whichever of its cells has the first text.
      const rowFirst = b.rowStart ? rowAround(doc, leaf.pos)?.row.cells[0]?.from : undefined;
      const start = pageStartAt(doc, rowFirst ?? leaf.pos);
      if (!start) return undefined;
      if (start.top) {
        out.push({ block: b.block, linesBefore: 0, blankBefore: false });
        continue;
      }
      const f = flowY(v, flow, start.pos, c.zoom, top);
      if (!f) return undefined;
      pos = start.pos;
      at = { y: f.y, flow: true, marginBottom: f.marginBottom };
    } else {
      const offset = wordOffset(leaf.node, b.word);
      // A page cannot begin in the middle of a table row, nor inside a word the text no longer has that many characters of.
      if (offset === null || insideCell(doc, leaf.pos)) return undefined;
      if (b.char !== undefined && !(b.char < (leafWordTexts(leaf.node)[b.word]?.text.length ?? 0)))
        return undefined;
      pos = leaf.pos + 1 + offset + (b.char ?? 0);
      const y = splitY(v, flow, leaf.pos, pos, c.zoom, top);
      if (y === null) return undefined;
      at = { y, flow: false };
    }
    const prev = inside.get(b.block);
    if (prev && at.y <= prev.y) return undefined;
    const n = (prev?.n ?? 0) + 1;
    inside.set(b.block, { n, y: at.y });
    exactPos.set(`${b.block}:${n}`, pos);
    out.push({ block: b.block, linesBefore: n, blankBefore: false, at });
  }
  return out;
}

/**
 * Owns the pagination of one editor: when to measure, the block style cache, and the hand-off to `core.ts`. It only reads the DOM
 * (with the spacers hidden) and then dispatches one view-only transaction that carries the new decorations. It never changes the
 * document, so typing, undo, composition and saving are not affected.
 */
export function createController() {
  let view: EditorView | null = null;
  let cfg: PageConfig | null = null;
  let applied = "";
  let layout: PageLayoutResult | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  const cache = createBlockCache();

  const stopTimers = () => {
    clearTimeout(timer);
    clearTimeout(cursorTimer);
    cancelAnimationFrame(raf);
    timer = cursorTimer = undefined;
    raf = 0;
  };
  const live = (): boolean => !!view && !view.isDestroyed && !!cfg?.on;
  const send = (meta: Meta) =>
    view!.dispatch(view!.state.tr.setMeta(paginationKey, meta).setMeta("addToHistory", false));

  const reportCursor = () => {
    if (!live() || !layout) return;
    try {
      cfg!.onCursorPage(
        layout.exact ? exactCursorPage(view!, layout) : cursorPage(view!, cfg!.zoom, layout.pages),
      );
    } catch {
      /* the cursor has no position yet */
    }
  };

  /** On an exact layout the cursor's page follows from the spacers' positions (they move with the text), not from where the line is drawn. */
  const exactCursorPage = (v: EditorView, l: PageLayoutResult): number => {
    const set = paginationKey.getState(v.state);
    const head = v.state.selection.head;
    // The page breaks the caret is past. A page break inside a table row has a spacer per cell: in the text of a cell only that
    // cell's own spacers count (a cell that ended before the break is on the row's earlier page), after the row all of them do.
    const passed = new Set<number>();
    for (const d of set?.find(0, v.state.doc.content.size) ?? []) {
      const g = (d as unknown as { spec: { pvGap?: GapWidgetSpec } }).spec.pvGap;
      if (!g) continue;
      const reached =
        g.cell && g.row
          ? head >= g.row.to || (head >= g.cell.from && head <= g.cell.to && d.from <= head)
          : d.from <= head;
      if (reached) passed.add(g.index);
    }
    return Math.min(passed.size, l.pages.length - 1);
  };

  const run = () => {
    raf = 0;
    if (!live()) return;
    const v = view!;
    // Never re-render the text under an IME composition; try again once it is done.
    if (v.composing) return schedule(TYPING_DELAY_MS);
    const c = cfg!;
    const g = c.geometry;
    cache.sync(c.layoutKey);
    const root = v.dom;
    root.classList.add("pv-natural");
    // A hyphen belongs to the flow only once a page break is there, so it is left out of the natural measurement.
    const hyphens = root.querySelectorAll<HTMLElement>(".pv-hyphen");
    hyphens.forEach((h) => (h.style.display = "none"));
    let hyphenate: boolean;
    let result: PageLayoutResult;
    const splits = new Map<string, number | null>();
    const exactPos = new Map<string, number>();
    try {
      const blocks = measureFlow(v, c.zoom, g.margins.top, cache);
      const starts: number[] = [];
      v.state.doc.forEach((_n, offset) => starts.push(offset));
      // Typst's breaks, when its marks fit this text: pages are then the PDF's, to the word.
      const forced = c.exact ? forcedBreaks(v, c, blocks, exactPos) : undefined;
      result = layoutPages({
        blocks,
        page: { h: g.page.h },
        margins: g.margins,
        // Typst's page may hold a line more or less than the webview's wrapping makes of it: a line of leeway before a card grows.
        textHeight:
          g.text.h +
          c.slackPx +
          (forced ? (blocks.find((b) => b.kind === "paragraph")?.lineHeight ?? 0) : 0),
        ...(forced ? { forced } : {}),
        gap: PAGE_GAP,
        firstPage: c.firstPage,
        startsOn: c.startsOn,
        opensChapter: c.opensChapter,
        blankBefore: c.blankBefore,
      });
      hyphenate = getComputedStyle(root).hyphens === "auto";
      for (const gap of result.gaps)
        if (gap.linesBefore > 0)
          splits.set(
            `${gap.block}:${gap.linesBefore}`,
            exactPos.get(`${gap.block}:${gap.linesBefore}`) ??
              findSplitPos(
                v,
                starts[gap.block]!,
                v.state.doc.child(gap.block),
                gap.linesBefore,
                blocks[gap.block]!,
                c.zoom,
                g.margins.top,
              ),
          );
    } finally {
      root.classList.remove("pv-natural");
      hyphens.forEach((h) => (h.style.display = ""));
    }
    const set = buildDecorations(
      v.state.doc,
      result,
      c.firstPage,
      (block, n) => splits.get(`${block}:${n}`) ?? null,
      hyphenate,
    );
    send({ type: "set", set });
    // The text now flows with the spacers in it: read where the cards must be so they match it exactly.
    const tops = readPageTops(v, c.zoom, result.gaps.length, g.margins.top);
    layout = tops ? withTops(result, tops) : result;
    c.onLayout(layout);
    reportCursor();
  };

  function schedule(delay: number) {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    timer = setTimeout(() => {
      timer = undefined;
      raf = requestAnimationFrame(run);
    }, delay);
  }

  const onWindowChange = () => schedule(0);

  return {
    attach(v: EditorView) {
      view = v;
    },
    detach() {
      stopTimers();
      this.listen(false);
      view = null;
    },
    /** Font loads and images change heights without touching the document. */
    listen(on: boolean) {
      const root = view?.dom;
      if (!root) return;
      if (on) {
        root.addEventListener("load", onWindowChange, true);
        document.fonts?.addEventListener("loadingdone", onWindowChange);
      } else {
        root.removeEventListener("load", onWindowChange, true);
        document.fonts?.removeEventListener("loadingdone", onWindowChange);
      }
    },
    configure(next: PageConfig | null) {
      const was = cfg;
      cfg = next;
      if (!view || view.isDestroyed) return;
      if (!next?.on) {
        stopTimers();
        this.listen(false);
        if (was?.on) {
          applied = "";
          layout = null;
          send({ type: "clear" });
        }
        return;
      }
      if (!was?.on) this.listen(true);
      const key = configKey(next);
      if (key !== applied || !was?.on) {
        applied = key;
        schedule(0);
      }
    },
    docChanged() {
      if (live()) schedule(TYPING_DELAY_MS);
    },
    selectionChanged() {
      if (!live()) return;
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(reportCursor, CURSOR_DELAY_MS);
    },
    /** For tests: measure now. */
    runNow: run,
    stats: cache.stats,
  };
}
export type PaginationController = ReturnType<typeof createController>;

/**
 * Page view's pagination as a TipTap extension: a plugin whose state is the set of page-break decorations. With Page view off it
 * holds none and listens to nothing. The controller is reachable as `editor.storage.pagination.controller`.
 */
export const Pagination = Extension.create<
  Record<string, never>,
  { controller: PaginationController }
>({
  name: "pagination",
  addStorage() {
    return { controller: createController() };
  },
  addProseMirrorPlugins() {
    const ctl = this.storage.controller;
    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(paginationKey) as Meta | undefined;
            if (meta?.type === "set") return meta.set;
            if (meta?.type === "clear") return DecorationSet.empty;
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state),
        },
        view(v) {
          ctl.attach(v);
          return {
            update(next, prev) {
              if (!next.state.doc.eq(prev.doc)) ctl.docChanged();
              else if (!next.state.selection.eq(prev.selection)) ctl.selectionChanged();
            },
            destroy: () => ctl.detach(),
          };
        },
      }),
    ];
  },
});
