import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { PageGeometry } from "../../lib/page/pageLayout";
import { createBlockCache } from "./cache";
import { withTops, type PageLayoutResult } from "./core";
import { buildDecorations, type GapWidgetSpec } from "./decorations";
import type { ExactSource } from "../../lib/page/exactBreaks";
import { cursorPage, readPageTops } from "./dom";
import { measureAndLayout, type LayoutRun } from "./runLayout";

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

/** On an exact layout the cursor's page follows from the spacers' positions (they move with the text), not from where the line is drawn. */
function exactCursorPage(v: EditorView, l: PageLayoutResult): number {
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
}

/** Font loads and images change heights without touching the document. */
function listenForReflow(root: HTMLElement, on: boolean, handler: () => void) {
  const toggle = on ? "addEventListener" : "removeEventListener";
  root[toggle]("load", handler, true);
  document.fonts?.[toggle]("loadingdone", handler);
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
    let run: LayoutRun;
    try {
      run = measureAndLayout(v, c, cache);
    } finally {
      root.classList.remove("pv-natural");
      hyphens.forEach((h) => (h.style.display = ""));
    }
    const { result, splits, hyphenate } = run;
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
      if (view) listenForReflow(view.dom, on, onWindowChange);
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
