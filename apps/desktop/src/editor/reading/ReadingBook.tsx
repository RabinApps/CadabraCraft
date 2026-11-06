import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { countWords, folioText } from "@cadabracraft/shared";
import { PAGE_GAP } from "../pagination/core";
import { usePageLook } from "../pageview/PageFrame";
import { ReadingSection } from "./ReadingSection";
import { useBookLayout } from "../../app/hooks/useBookLayout";
import { useIsMd } from "../../app/hooks/usePageView";
import { usePaneWidth } from "../../app/hooks/usePaneWidth";
import { useMeasuredPages } from "../../app/hooks/useMeasuredPages";
import { fitZoom } from "../../lib/page/pageLayout";
import { chapterPageCount, bookWordsPerPage } from "../../lib/page/pageNumbering";
import { usableReport } from "../../lib/page/pageReport";
import {
  pageAtLine,
  pagedHeight,
  plainHeight,
  readingGutter,
  readingZoom,
  visibleIndex,
} from "../../lib/reading/readingBook";
import { errText } from "../../lib/projectError";
import { attempt } from "../../state/attempt";
import { useSettings } from "../../state/view/editorPrefs";
import { readingPaged } from "../../state/view/pageView";
import { setEntryPages } from "../../state/pages/pageCount";
import { usePageMeasure } from "../../state/pages/pageMeasure";
import { useProject } from "../../state/project/index";
import type { BookPage } from "../../state/project/types";
import { sizes, useReading, widths } from "../../state/view/reading";
import { setReadingPosition, useReadingPosition } from "../../state/view/readingPosition";
import { cx } from "../../ui/cx";

/** Chapters within this many px of the viewport (above and below) have a live editor; the rest are placeholders of the same height. */
const PRELOAD_PX = 900;
/** The reading line, as a fraction of the viewport height from its top: the chapter and page there is "where the reader is". */
const LINE = 0.3;
/** The headings of a chapter, in document order (what a Contents entry's heading position counts). */
const HEADINGS = "h1, h2, h3, h4, h5, h6";

/**
 * Read mode: the whole book in one vertical scroller, front matter, chapters and back matter in reading order. At md and up each
 * chapter is drawn as trim-size pages (cards, running heads, page numbers chained from chapter to chapter); on a phone it is the
 * plain reading layout. Every chapter is its own read-only editor and only the ones near the viewport are mounted.
 */
function ReadingScroll({ pages }: { pages: readonly BookPage[] }) {
  const { t } = useLingui();
  const currentId = useProject((s) => s.currentId);
  const selectChapter = useProject((s) => s.actions.selectChapter);
  const { size, width } = useReading();
  const pageZoom = useSettings((s) => s.pageZoom);
  const wide = useIsMd();
  const paged = readingPaged("read", wide);
  const look = usePageLook();
  const { g, book, trim, fontStack, family } = look;
  // The reader draws the pages as Typst broke them, in every chapter: the book is measured with the marks that say where.
  useMeasuredPages(paged, true);
  const report = usePageMeasure((s) => usableReport(s.report));
  const reportAt = usePageMeasure((s) => s.reportAt);

  const scroller = useRef<HTMLDivElement>(null);
  const paneW = usePaneWidth(scroller);
  const gutter = readingGutter(width);
  const zoom = paged
    ? readingZoom(fitZoom(g, paneW || g.page.w + gutter, gutter), size, pageZoom)
    : 1;

  // A chapter chosen elsewhere (the sidebar, Previous and Next) is scrolled to: to its opening page, not the blank page before it.
  // Its pages are not laid out when it was far away or has just been mounted, so the scroll is repeated each time that chapter
  // lays out, until the reader scrolls on their own (or a couple of seconds pass). The chapters above it are kept in place by the
  // height compensation.
  const pending = useRef<{ id: string; heading?: number } | null>(null);
  const [alignTick, setAlignTick] = useState(0);
  // What the reader is looking at, as the section at the top edge and how far below the edge it starts. WebKit has no scroll
  // anchoring, so when a section changes height this puts that section back at the same offset (and does nothing if it did not move).
  const anchor = useRef<{ el: HTMLElement; offset: number; top: number } | null>(null);
  const capture = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    let el: HTMLElement | undefined;
    for (const e of sc.querySelectorAll<HTMLElement>("[data-reading-id]")) {
      if (el && e.offsetTop > sc.scrollTop) break;
      el = e;
    }
    anchor.current = el
      ? {
          el,
          offset: el.getBoundingClientRect().top - sc.getBoundingClientRect().top,
          top: sc.scrollTop,
        }
      : null;
  }, []);
  const restore = useCallback(() => {
    const sc = scroller.current;
    const a = anchor.current;
    if (!sc || !a) return;
    // The reader (or an alignment) moved the scroll since: that is the new position, not something to undo.
    if (Math.abs(sc.scrollTop - a.top) > 1) return capture();
    const drift = a.el.getBoundingClientRect().top - sc.getBoundingClientRect().top - a.offset;
    if (Math.abs(drift) < 1) return;
    sc.scrollTop += drift;
    a.top = sc.scrollTop;
  }, [capture]);
  const align = useCallback(
    (id: string, heading?: number) => {
      const sc = scroller.current;
      const el = sc?.querySelector<HTMLElement>(`[data-reading-id="${CSS.escape(id)}"]`);
      if (!sc || !el) return;
      // A heading of the chapter (a Contents entry for one), once the chapter has an editor; else the chapter's opening page.
      const target =
        heading === undefined
          ? undefined
          : (el.querySelectorAll<HTMLElement>(HEADINGS)[heading] ?? undefined);
      const card = target ?? el.querySelector<HTMLElement>(".page-card:not([data-blank])");
      const top = card
        ? card.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
        : el.offsetTop;
      sc.scrollTop = Math.max(0, top - parseFloat(getComputedStyle(sc).paddingTop));
      capture();
    },
    [capture],
  );
  // Where every section starts in the book and what number it prints there: the same layout Write mode uses (Typst's report,
  // the editors' measures and the words), never a chain of its own. `laid` is which sections have laid out their pages here, for
  // the placeholder heights.
  const layout = useBookLayout();
  const perPage = bookWordsPerPage(book);
  const words = useMemo(() => pages.map((p) => countWords(p.doc)), [pages]);
  const [laid, setLaid] = useState<ReadonlySet<string>>(() => new Set());
  // A section's pages are the book's: they go to the shared layout (later sections start after them), and the section counts as laid
  // out for the placeholder heights. `n` is its content pages, a blank verso before it not counted.
  const measureKey = `${book.template}|${trim}|${fontStack}|${family ?? ""}`;
  const onPages = useCallback(
    (id: string, n: number) => {
      setEntryPages(id, n, measureKey);
      setLaid((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      if (pending.current?.id === id) setAlignTick((t) => t + 1);
    },
    [measureKey],
  );
  const folioFor = useCallback(
    (physical: number) => (layout ? folioText(layout, physical) : ""),
    [layout],
  );
  /** Content pages of a section (a blank verso before it not counted): its measured layout, else the estimate. */
  const pagesOf = useCallback(
    (id: string, i: number) => layout?.byId.get(id)?.pages ?? chapterPageCount(words[i]!, perPage),
    [layout, words, perPage],
  );

  // Which chapters are near the viewport (and so have an editor), and the last measured height of each.
  const initialId = useRef(currentId ?? pages[0]?.id ?? "").current;
  const [near, setNear] = useState<Set<string>>(() => new Set([initialId]));
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const heights = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const obs = new IntersectionObserver(
      (entries) =>
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.readingId!;
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
        }),
      { root: scroller.current, rootMargin: `${PRELOAD_PX}px 0px` },
    );
    setObserver(obs);
    return () => obs.disconnect();
  }, []);
  const layoutSig = `${paged}|${zoom}|${size}|${width}`;
  useLayoutEffect(() => {
    heights.current.clear();
  }, [layoutSig]);

  // Where the reader is: the chapter (and page) at the reading line, from the scroll position.
  const visible = useRef<string | null>(null);
  const echo = useRef<string | null>(null);
  // Nothing is placed before the pane has a width: the zoom, and so every height, depends on it.
  const ready = paneW > 0;
  const measure = useCallback(() => {
    const sc = scroller.current;
    if (!sc || !ready) return;
    const els = Array.from(sc.querySelectorAll<HTMLElement>("[data-reading-id]"));
    const atEnd = sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    const at = visibleIndex(
      els.map((e) => e.offsetTop),
      sc.scrollTop + sc.clientHeight * LINE,
      atEnd,
    );
    const el = els[at];
    if (!el) return;
    const lineY = sc.getBoundingClientRect().top + sc.clientHeight * LINE;
    const cards = paged
      ? Array.from(el.querySelectorAll<HTMLElement>(".page-card")).map((c) => ({
          top: c.getBoundingClientRect().top,
          number: Number(c.dataset.physical),
        }))
      : [];
    visible.current = el.dataset.readingId!;
    // The footer names the page as the PDF prints it (roman in the front matter, arabic later), not its position in the book.
    const line = pageAtLine(cards, lineY);
    setReadingPosition(visible.current, line === null ? null : folioFor(line));
  }, [paged, ready, folioFor]);
  useEffect(() => {
    const sc = scroller.current!;
    capture();
    sc.addEventListener("scroll", capture, { passive: true });
    return () => sc.removeEventListener("scroll", capture);
  }, [capture]);
  useEffect(() => {
    const sc = scroller.current!;
    let raf = 0;
    const on = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          measure();
        });
    };
    sc.addEventListener("scroll", on, { passive: true });
    on();
    return () => {
      sc.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, [measure]);
  // Page numbers and counts settle after the editors lay out: read the position again.
  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, laid, layout]);
  useEffect(() => () => setReadingPosition(null, null), []);

  // The open chapter follows the reader (after a pause, so scrolling does not reload it at every chapter boundary) ...
  const position = useReadingPosition((s) => s.id);
  useEffect(() => {
    if (!position || position === currentId) return;
    const timer = setTimeout(() => {
      echo.current = position;
      attempt(selectChapter(position));
    }, 250);
    return () => clearTimeout(timer);
  }, [position, currentId, selectChapter]);
  // ... and a chapter chosen elsewhere (the sidebar, Previous and Next) is scrolled to: to its opening page, not the blank page
  // before it. Its pages are not laid out yet when it was far away, so the scroll is repeated as it and the chapters above it settle,
  // until the reader scrolls on their own (or a couple of seconds pass). Only the chapter itself settling matters: the ones above it are kept in place by the height compensation.
  useEffect(() => {
    const sc = scroller.current!;
    const stop = () => {
      pending.current = null;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    events.forEach((e) => sc.addEventListener(e, stop, { passive: true }));
    return () => events.forEach((e) => sc.removeEventListener(e, stop));
  }, []);
  // `align` and `measure` are new functions whenever the book layout is (a section measured), so the effects below read the
  // latest through refs: re-running a jump because a page count arrived would scroll the reader back while they read.
  const alignNow = useRef(align);
  alignNow.current = align;
  const measureNow = useRef(measure);
  measureNow.current = measure;
  useLayoutEffect(() => {
    if (!currentId || !ready) return;
    if (echo.current === currentId) {
      echo.current = null;
      return;
    }
    if (visible.current === currentId) return;
    // A Contents entry for a heading of this chapter asked for it: keep the heading to scroll to.
    const asked = jump.current?.id === currentId ? jump.current.heading : undefined;
    const mine = { id: currentId, heading: asked };
    pending.current = mine;
    // The layout changing (a section measured) makes `align` and `measure` new functions; they are read through refs so this
    // effect runs only when the open chapter changes, never while the reader is scrolling.
    alignNow.current(currentId, asked);
    measureNow.current();
    const timer = setTimeout(() => {
      if (pending.current === mine) pending.current = null;
    }, 2500);
    return () => clearTimeout(timer);
  }, [currentId, ready]);
  // Only a section of the pending chapter finishing its layout asks for the jump again: `align` is a new function whenever the
  // book layout is, and aligning again then would scroll the reader back to the chapter they came from.
  useLayoutEffect(() => {
    if (alignTick && pending.current) alignNow.current(pending.current.id, pending.current.heading);
  }, [alignTick]);
  // An entry of the Contents page was chosen: open that chapter and scroll to it (or to its heading), also when it is already the
  // open one or is on screen, which the effect above would leave where it is.
  const jump = useRef<{ id: string; heading?: number } | null>(null);
  const [jumpTick, setJumpTick] = useState(0);
  const open = useCallback(
    (id: string, heading?: number) => {
      jump.current = { id, heading };
      setJumpTick((n) => n + 1);
      attempt(selectChapter(id));
    },
    [selectChapter],
  );
  useLayoutEffect(() => {
    const j = jump.current;
    if (!jumpTick || !j || !ready) return;
    const mine = { ...j };
    pending.current = mine;
    // Read through refs, so a chapter that lays out (a new layout, and so new `align` and `measure`) does not re-run the jump:
    // that would send the reader back to the last Contents link they followed, over a chapter they chose since.
    alignNow.current(j.id, j.heading);
    measureNow.current();
    const timer = setTimeout(() => {
      if (pending.current === mine) pending.current = null;
    }, 2500);
    return () => clearTimeout(timer);
  }, [jumpTick, ready]);

  const column = Math.min(widths[width], paneW || widths[width]) - 48;
  const gap = paged ? Math.round(PAGE_GAP * zoom) : 0;
  // 1-based position among the chapters, for the "CHAPTER n" label of the opening.
  const chapterNumbers = useMemo(() => {
    let n = 0;
    return new Map(pages.map((p) => [p.id, p.section === "chapter" ? ++n : undefined]));
  }, [pages]);
  return (
    <div
      ref={scroller}
      data-testid="reading-scroll"
      // A scrolling area with nothing focusable in it is reached by keyboard through the area itself (WCAG 2.1.1).
      role="region"
      aria-label={t`Pages`}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-paged={paged}
      className={cx(
        "relative min-h-0 flex-1 overflow-y-auto",
        paged ? "overflow-x-auto bg-bg pb-12 pt-6" : "bg-paper",
      )}
      style={{
        // Heights are kept right by hand when a section above the viewport changes (WebKit has no scroll anchoring).
        overflowAnchor: "none",
        ...(paged ? { paddingInline: gutter / 2 } : {}),
      }}
    >
      {pages.map((page, i) => (
        <ReadingSection
          key={page.id}
          page={page}
          near={near.has(page.id)}
          settled={!paged || laid.has(page.id)}
          placeholder={
            heights.current.get(page.id) ??
            (paged
              ? pagedHeight(pagesOf(page.id, i), g.page.h, PAGE_GAP, zoom)
              : plainHeight(words[i]!, sizes[size]!, column))
          }
          observer={observer}
          onResize={restore}
          heights={heights}
          paged={paged}
          first={i === 0}
          look={look}
          zoom={zoom}
          firstPage={layout?.byId.get(page.id)?.cardStart ?? 1}
          blankBefore={layout?.byId.get(page.id)?.blankBefore ?? false}
          folioFor={folioFor}
          chapterNumber={chapterNumbers.get(page.id)}
          size={size}
          width={width}
          gap={gap}
          onPages={onPages}
          report={report}
          reportAt={reportAt}
          onOpen={open}
        />
      ))}
    </div>
  );
}

/**
 * Read mode's book. Reads every page once when it opens (the Write-mode text was saved on the way in) and keeps them for the
 * session of the reader; the app keys it on the book, edition and external reloads, not on the open chapter.
 */
export function ReadingBook() {
  const readPages = useProject((s) => s.actions.readPages);
  const [pages, setPages] = useState<BookPage[] | null>(null);
  useEffect(() => {
    let live = true;
    readPages().then(
      (p) => live && setPages(p),
      (e) => live && useProject.setState({ notice: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [readPages]);
  const { t } = useLingui();
  if (!pages)
    return <div className="flex-1 bg-paper" role="status" aria-label={t`Loading the book`} />;
  return <ReadingScroll pages={pages} />;
}
