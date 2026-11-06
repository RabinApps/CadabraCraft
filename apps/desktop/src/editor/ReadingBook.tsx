import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { countWords } from "@cadabracraft/shared";
import { PAGE_GAP } from "./pagination/core";
import { usePageLook } from "./PageFrame";
import { ReadingSection } from "./ReadingSection";
import { ReadFindBar } from "./reading/ReadFindBar";
import { useReadFindState, useReadFindShortcut } from "./reading/useReadFind";
import { READING_LINE, useReadingScroll } from "./reading/useReadingScroll";
import { useFind } from "./findStore";
import { useIsMd } from "../app/hooks/usePageView";
import { usePaneWidth } from "../app/hooks/usePaneWidth";
import { useMeasuredPages } from "../app/hooks/useMeasuredPages";
import { fitZoom } from "../lib/pageLayout";
import { chapterPageCount, chapterStart, bookWordsPerPage } from "../lib/pageNumbering";
import { reportStartNumber, usableReport } from "../lib/pageReport";
import { bookContents, withContentsList } from "../lib/tocExport";
import {
  chainFirstPages,
  pageAtLine,
  pagedHeight,
  plainHeight,
  readingGutter,
  readingZoom,
  visibleIndex,
} from "../lib/readingBook";
import { locate } from "../lib/search/readFind";
import { errText } from "../lib/projectError";
import { attempt } from "../state/attempt";
import { useSettings } from "../state/editorPrefs";
import { readingPaged } from "../state/pageView";
import { usePageMeasure } from "../state/pageMeasure";
import { useProject } from "../state/project/index";
import type { BookPage } from "../state/project/types";
import { sizes, useReading, widths } from "../state/reading";
import { useReadFind } from "../state/readFind";
import {
  flushReadingPosition,
  rememberReadingPosition,
  takeSavedPosition,
} from "../state/readingMemory";
import { setReadingPosition, useReadingPosition } from "../state/readingPosition";
import { cx } from "../ui/cx";

/** Chapters within this many px of the viewport (above and below) have a live editor; the rest are placeholders of the same height. */
const PRELOAD_PX = 900;

/**
 * Read mode: the whole book in one vertical scroller, front matter, chapters and back matter in reading order. At md and up each
 * chapter is drawn as trim-size pages (cards, running heads, page numbers chained from chapter to chapter); on a phone it is the
 * plain reading layout. Every chapter is its own read-only editor and only the ones near the viewport are mounted.
 */
function ReadingScroll({ pages }: { pages: readonly BookPage[] }) {
  const currentId = useProject((s) => s.currentId);
  const root = useProject((s) => s.root);
  const selectChapter = useProject((s) => s.actions.selectChapter);
  const { size, width } = useReading();
  const manuscriptFont = useSettings((s) => s.manuscriptFont);
  const wide = useIsMd();
  const paged = readingPaged("read", wide);
  const look = usePageLook(manuscriptFont);
  const { g, book } = look;
  // The reader draws the pages as Typst broke them, in every chapter: the book is measured with the marks that say where.
  useMeasuredPages(paged, true);
  const report = usePageMeasure((s) => usableReport(s.report));
  const reportAt = usePageMeasure((s) => s.reportAt);

  const scroller = useRef<HTMLDivElement>(null);
  const measureRef = useRef<() => void>(() => {});
  useReadFindShortcut();
  const find = useReadFindState(pages);
  const findOpen = useFind((s) => s.open);
  const matchNumber = useReadFind((s) => s.index);
  const currentMatch = useMemo(() => locate(find.hits, matchNumber), [find.hits, matchNumber]);
  const paneW = usePaneWidth(scroller);
  const gutter = readingGutter(width);
  const zoom = paged ? readingZoom(fitZoom(g, paneW || g.page.w + gutter, gutter), size) : 1;

  const { pending, restore, goTo, realign } = useReadingScroll(scroller, () =>
    measureRef.current(),
  );
  // Pages each chapter has: from its words until its editor has laid it out.
  const perPage = bookWordsPerPage(book);
  const words = useMemo(() => pages.map((p) => countWords(p.doc)), [pages]);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const onPages = useCallback(
    (id: string, n: number) => {
      setMeasured((m) => (m[id] === n ? m : { ...m, [id]: n }));
      realign(id);
    },
    [realign],
  );
  const firstPages = useMemo(
    () =>
      chainFirstPages(
        pages.map((p, i) => ({
          id: p.id,
          section: p.section,
          measured: measured[p.id] ?? null,
          estimate: chapterPageCount(words[i]!, perPage),
        })),
        chapterStart(book),
        (id) => (report ? reportStartNumber(report, id) : null),
      ),
    [pages, words, measured, perPage, book, report],
  );

  // Which chapters are near the viewport (and so have an editor), and the last measured height of each.
  // The first time a book is read in a session it resumes where it was left (see state/readingMemory.ts).
  const resume = useRef(
    takeSavedPosition(
      root,
      currentId,
      pages.map((p) => p.id),
    ),
  );
  const initialId = useRef(resume.current?.id ?? currentId ?? pages[0]?.id ?? "").current;
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
      sc.scrollTop + sc.clientHeight * READING_LINE,
      atEnd,
    );
    const el = els[at];
    if (!el) return;
    const lineY = sc.getBoundingClientRect().top + sc.clientHeight * READING_LINE;
    const cards = paged
      ? Array.from(el.querySelectorAll<HTMLElement>(".page-card")).map((c) => ({
          top: c.getBoundingClientRect().top,
          number: Number(c.dataset.page),
        }))
      : [];
    visible.current = el.dataset.readingId!;
    setReadingPosition(visible.current, pageAtLine(cards, lineY));
    // While a jump is under way the scroll is not the reader's yet: the place to remember is where they are going.
    if (root && !pending.current) {
      const box = el.getBoundingClientRect();
      rememberReadingPosition(root, visible.current, (lineY - box.top) / Math.max(1, box.height));
    }
  }, [paged, ready, root, pending]);
  measureRef.current = measure;
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
  }, [measure, measured, firstPages]);
  useEffect(
    () => () => {
      setReadingPosition(null, null);
      flushReadingPosition();
    },
    [],
  );

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
  // ... and a chapter chosen elsewhere (the sidebar, Previous and Next) is scrolled to, as is the place the reader left off at last
  // time (the first time this book is read) and the match Find is on.
  useLayoutEffect(() => {
    if (!currentId || !ready) return;
    if (echo.current === currentId) {
      echo.current = null;
      return;
    }
    if (visible.current === currentId || pending.current?.id === currentId) return;
    goTo({ id: currentId });
    measure();
  }, [currentId, ready, measure, goTo, pending]);
  useLayoutEffect(() => {
    if (!resume.current || !ready) return;
    const r = resume.current;
    resume.current = null;
    goTo({ id: r.id, fraction: r.fraction });
    attempt(selectChapter(r.id));
  }, [ready, goTo, selectChapter]);
  const findTick = useReadFind((s) => s.tick);
  useLayoutEffect(() => {
    if (!findTick || !ready) return;
    const at = locate(find.hits, useReadFind.getState().index);
    if (!at) return;
    goTo({ id: at.id, match: true });
    if (at.id !== currentId) attempt(selectChapter(at.id));
    // Only a new jump scrolls: the matches or the open chapter changing must not.
  }, [findTick, ready]);

  const column = Math.min(widths[width], paneW || widths[width]) - 48;
  const gap = paged ? Math.round(PAGE_GAP * zoom) : 0;
  // 1-based position among the chapters, for the "CHAPTER n" label of the opening.
  const chapterNumbers = useMemo(() => {
    let n = 0;
    return new Map(pages.map((p) => [p.id, p.section === "chapter" ? ++n : undefined]));
  }, [pages]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        data-testid="reading-scroll"
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
            settled={!paged || measured[page.id] !== undefined}
            placeholder={
              heights.current.get(page.id) ??
              (paged
                ? pagedHeight(
                    measured[page.id] ?? chapterPageCount(words[i]!, perPage),
                    g.page.h,
                    PAGE_GAP,
                    zoom,
                  )
                : plainHeight(words[i]!, sizes[size]!, column))
            }
            observer={observer}
            onResize={restore}
            heights={heights}
            paged={paged}
            first={i === 0}
            look={look}
            zoom={zoom}
            firstPage={firstPages.get(page.id) ?? 1}
            chapterNumber={chapterNumbers.get(page.id)}
            size={size}
            width={width}
            gap={gap}
            onPages={onPages}
            report={report}
            reportAt={reportAt}
            search={find.applied}
            matchIndex={currentMatch?.id === page.id ? currentMatch.local : -1}
            onMatch={realign}
          />
        ))}
      </div>
      {findOpen && <ReadFindBar find={find} />}
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
  const manifest = useProject((s) => s.manifest);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  // The generated contents list is part of the contents page as the reader shows it.
  const shown = useMemo(
    () => pages && manifest && withContentsList(pages, bookContents(manifest, language, pages)),
    [pages, manifest, language],
  );
  const { t } = useLingui();
  if (!shown)
    return <div className="flex-1 bg-paper" role="status" aria-label={t`Loading the book`} />;
  return <ReadingScroll pages={shown} />;
}
