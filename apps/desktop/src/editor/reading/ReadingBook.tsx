import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  pagedHeight,
  plainHeight,
  readingGutter,
  readingZoom,
} from "../../lib/reading/readingBook";
import { errText } from "../../lib/projectError";
import { useSettings } from "../../state/view/editorPrefs";
import { readingPaged } from "../../state/view/pageView";
import { setEntryPages } from "../../state/pages/pageCount";
import { usePageMeasure } from "../../state/pages/pageMeasure";
import { useProject } from "../../state/project/index";
import type { BookPage } from "../../state/project/types";
import { sizes, useReading, widths } from "../../state/view/reading";
import {
  useChapterJumps,
  useNearChapters,
  useReadingMeasure,
  useScrollAnchor,
} from "./useReadingScroll";
import { cx } from "../../ui/cx";

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

  const { restore, align } = useScrollAnchor(scroller);
  // Where every section starts in the book and what number it prints there: the same layout Write mode uses (Typst's report,
  // the editors' measures and the words), never a chain of its own. `laid` is which sections have laid out their pages here, for
  // the placeholder heights.
  const layout = useBookLayout();
  const perPage = bookWordsPerPage(book);
  const words = useMemo(() => pages.map((p) => countWords(p.doc)), [pages]);
  const [laid, setLaid] = useState<ReadonlySet<string>>(() => new Set());
  const folioFor = useCallback(
    (physical: number) => (layout ? folioText(layout, physical) : ""),
    [layout],
  );
  /** Content pages of a section (a blank verso before it not counted): its measured layout, else the estimate. */
  const pagesOf = useCallback(
    (id: string, i: number) => layout?.byId.get(id)?.pages ?? chapterPageCount(words[i]!, perPage),
    [layout, words, perPage],
  );

  const initialId = useRef(currentId ?? pages[0]?.id ?? "").current;
  const layoutSig = `${paged}|${zoom}|${size}|${width}`;
  const { near, observer, heights } = useNearChapters(scroller, initialId, layoutSig);
  const visible = useRef<string | null>(null);
  // Nothing is placed before the pane has a width: the zoom, and so every height, depends on it.
  const ready = paneW > 0;
  const measure = useReadingMeasure({ scroller, paged, ready, folioFor, visible, laid, layout });
  const { open, sectionLaidOut } = useChapterJumps({
    scroller,
    currentId,
    ready,
    selectChapter,
    align,
    measure,
    visible,
  });

  // A section's pages are the book's: they go to the shared layout (later sections start after them), and the section counts as laid
  // out for the placeholder heights. `n` is its content pages, a blank verso before it not counted.
  const measureKey = `${book.template}|${trim}|${fontStack}|${family ?? ""}`;
  const onPages = useCallback(
    (id: string, n: number) => {
      setEntryPages(id, n, measureKey);
      setLaid((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      sectionLaidOut(id);
    },
    [measureKey, sectionLaidOut],
  );
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
