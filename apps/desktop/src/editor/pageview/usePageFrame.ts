import { useCallback, useEffect, useMemo, type CSSProperties, type MutableRefObject } from "react";
import { setEntryPages, setPageCount, usePageCount } from "../../state/pages/pageCount";
import { breaksReport, usePageMeasure } from "../../state/pages/pageMeasure";
import { useMeasuredChapter } from "../../app/hooks/useMeasuredChapter";
import { reportChapterMarks } from "../../lib/page/pageReport";
import { pageCssVars, PX_PER_INCH, type PageGeometry } from "../../lib/page/pageLayout";
import type { ExactSource } from "../../lib/page/exactBreaks";
import type { PageLayoutResult } from "../pagination/core";
import { cssVarsStyle } from "../pagination/frame";
import type { PaginationController } from "../pagination/plugin";

/** pt to CSS px. */
const PX_PER_PT = PX_PER_INCH / 72;

interface StackVarsInput {
  book: Parameters<typeof pageCssVars>[0];
  chapterNumber: number | undefined;
  dropCap: boolean | undefined;
  g: PageGeometry;
  runningSizePt: number;
  fontStack: string;
  rtl: boolean;
}

/** The CSS variables the stack's cards and text column read: margins (mirrored for a right-to-left book), head size and font. */
export function useStackVars(input: StackVarsInput): CSSProperties {
  const { book, chapterNumber, dropCap, g, runningSizePt, fontStack, rtl } = input;
  return useMemo(
    () => ({
      ...cssVarsStyle(pageCssVars(book, chapterNumber, dropCap)),
      "--page-mt": `${g.margins.top}px`,
      "--page-mb": `${g.margins.bottom}px`,
      // A right-to-left book is bound on the right: its inside margin is the right one, and the verso shifts the other way.
      "--page-ml": `${rtl ? g.margins.outside : g.margins.inside}px`,
      "--page-mr": `${rtl ? g.margins.inside : g.margins.outside}px`,
      "--page-verso-shift": `${(g.margins.outside - g.margins.inside) * (rtl ? -1 : 1)}px`,
      "--page-head-size": `${runningSizePt * PX_PER_PT}px`,
      "--page-font": fontStack,
    }),
    [book, chapterNumber, dropCap, g, runningSizePt, fontStack, rtl],
  ) as CSSProperties;
}

interface ConfigureInput {
  controller: PaginationController;
  g: PageGeometry;
  slackPx: number;
  firstPage: number;
  startsOn: "recto" | "any";
  isChapter: boolean;
  blankBefore: boolean;
  zoom: number;
  layoutKey: string;
  exact: ExactSource | null;
  exactKey: string;
  setLayout: (l: PageLayoutResult) => void;
  callbacks: MutableRefObject<{
    onLayout?: ((layout: PageLayoutResult) => void) | undefined;
    onCursorPage?: ((page: number) => void) | undefined;
  }>;
}

/** Hands the pagination plugin what it lays out from, and takes it back off when the stack goes. */
export function useConfigureController(input: ConfigureInput) {
  const { controller, g, slackPx, firstPage, startsOn, isChapter, blankBefore, zoom } = input;
  const { layoutKey, exact, exactKey, setLayout, callbacks } = input;
  useEffect(() => {
    controller.configure({
      on: true,
      geometry: g,
      slackPx,
      firstPage,
      startsOn,
      opensChapter: isChapter,
      blankBefore,
      zoom,
      layoutKey,
      exact,
      exactKey,
      onLayout: (l) => {
        setLayout(l);
        callbacks.current.onLayout?.(l);
      },
      onCursorPage: (p) => callbacks.current.onCursorPage?.(p),
    });
  }, [
    controller,
    g,
    slackPx,
    firstPage,
    blankBefore,
    startsOn,
    isChapter,
    zoom,
    layoutKey,
    exact,
    exactKey,
    setLayout,
    callbacks,
  ]);
  useEffect(() => () => controller.configure(null), [controller]);
}

/**
 * Typst's breaks inside this page entry, from the newest report that has it (the chapter's own measure comes much sooner than the
 * book's). The plugin checks they still fit the text, so a stale report is only used while the edits left the blocks as they were.
 */
export function useExactSource(currentId: string | null) {
  useMeasuredChapter(true, currentId);
  const breaksFrom = usePageMeasure(
    (s) => (currentId ? breaksReport(s, currentId)?.report : null) ?? null,
  );
  const breaksAt = usePageMeasure((s) => (currentId ? breaksReport(s, currentId)?.at : 0) ?? 0);
  const exact = useMemo(
    () => (currentId && breaksFrom ? reportChapterMarks(breaksFrom, currentId) : null),
    [currentId, breaksFrom],
  );
  return { exact, exactKey: `${currentId ?? ""}:${breaksAt}` };
}

/**
 * The pages this entry really takes (a blank verso before it not counted): later entries' starts follow it, so the numbers of
 * the whole book stay right while the author works through a chapter.
 */
export function usePageReporting(currentId: string | null, isBlank: boolean, measureKey: string) {
  const onLayout = useCallback(
    (l: PageLayoutResult) => {
      setPageCount(l.pages.length, undefined, l.exact);
      if (currentId)
        setEntryPages(
          currentId,
          isBlank ? 1 : l.pages.filter((p) => p.kind !== "blank").length,
          measureKey,
        );
    },
    [currentId, isBlank, measureKey],
  );
  const onCursor = useCallback(
    (p: number) => setPageCount(usePageCount.getState().count, p + 1),
    [],
  );
  useEffect(() => () => setPageCount(0), []);
  return { onLayout, onCursor };
}
