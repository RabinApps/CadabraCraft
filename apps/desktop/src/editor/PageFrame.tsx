import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLingui } from "@lingui/react/macro";
import type { Editor as TipTapEditor } from "@tiptap/react";
import type { TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import {
  readingOrder,
  sectionOf,
  sourceEdition,
  sourceTitle,
  type Manifest,
} from "@cadabracraft/format";
import { usePageView } from "../app/hooks/usePageView";
import { usePaneWidth } from "../app/hooks/usePaneWidth";
import { useFontList } from "../app/hooks/useFontList";
import { dirFor } from "../i18n/locales";
import { editorFontStack } from "../state/editorPrefs";
import { setPageCount, usePageCount } from "../state/pageCount";
import { breaksReport, usePageMeasure } from "../state/pageMeasure";
import { useMeasuredChapter } from "../app/hooks/useMeasuredChapter";
import type { ExactSource } from "../lib/exactBreaks";
import { reportChapterMarks, reportStartNumber, usableReport } from "../lib/pageReport";
import { useProject } from "../state/project/index";
import { ensureFontLoaded } from "../lib/loadFont";
import { chapterStart, firstPageNumber } from "../lib/pageNumbering";
import { trimLabel } from "../lib/trimLabels";
import {
  PX_PER_INCH,
  fitZoom,
  pageCssVars,
  pageFillSlackPx,
  pageGeometry,
  sideMargins,
  type PageGeometry,
} from "../lib/pageLayout";
import type { PageLayoutResult, PageSpec } from "./pagination/core";
import { cssVarsStyle, pageFontStack, pickPageFont, runningHead } from "./pagination/frame";
import type { PaginationController } from "./pagination/plugin";

/** pt to CSS px. */
const PX_PER_PT = PX_PER_INCH / 72;

interface CardProps {
  page: PageSpec;
  head: string | null;
  verso: boolean;
  left: number;
}

const PageCard = memo(function PageCard({ page, head, verso, left }: CardProps) {
  return (
    <div
      className="page page-card"
      data-page={page.number}
      data-index={page.index}
      data-blank={page.kind === "blank" ? "true" : undefined}
      data-kind={page.kind}
      style={
        { top: page.top, height: page.height, "--page-card-left": `${left}px` } as CSSProperties
      }
    >
      {head && <div className={`page-head ${verso ? "is-verso" : "is-recto"}`}>{head}</div>}
      <div className="page-number">{page.number}</div>
    </div>
  );
});

/** What every page of the book shares: the geometry, the print font and the titles. Computed once per view, not per chapter. */
export interface PageLook {
  book: { template: string; trimSize: TrimSize | undefined };
  g: PageGeometry;
  trim: TrimSize;
  print: ReturnType<typeof getTemplate>["print"];
  /** The print font when it can be drawn here, else null (the manuscript font is used). */
  family: string | null;
  fontStack: string;
  bookTitle: string;
  language: string;
}

/**
 * The look of the book's pages: geometry from the trim size and template, and the text font (the template's print font when it can
 * be drawn here, else the bundled serif).
 */
export function usePageLook(): PageLook {
  const manifest = useProject((s) => s.manifest)!;
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const { fonts } = useFontList();
  const book = useMemo(
    () => ({ template: manifest.template, trimSize: manifest.trimSize }),
    [manifest.template, manifest.trimSize],
  );
  const g = useMemo(() => pageGeometry(book), [book]);
  const trim = resolveTrimSize(book);
  const print = getTemplate(hasTemplate(book.template) ? book.template : DEFAULT_TEMPLATE_ID).print;
  const printFont = pickPageFont(
    print.bodyFonts,
    fonts.map((f) => f.family),
  );
  const [loadedFont, setLoadedFont] = useState<string | null>(null);
  useEffect(() => {
    if (!printFont) return setLoadedFont(null);
    let live = true;
    void ensureFontLoaded(printFont).then((ok) => live && setLoadedFont(ok ? printFont : null));
    return () => {
      live = false;
    };
  }, [printFont]);
  const family =
    loadedFont ?? (printFont && /^(inter|newsreader)$/i.test(printFont) ? printFont : null);
  const fontStack = family ? pageFontStack(family) : editorFontStack("newsreader");
  const bookTitle =
    manifest.editions.find((e) => e.language === language)?.title ??
    sourceEdition(manifest.editions).title;
  return useMemo(
    () => ({ book, g, trim, print, family, fontStack, bookTitle, language }),
    [book, g, trim, print, family, fontStack, bookTitle, language],
  );
}

/** The 1-based position of `id` among the chapters, for the "CHAPTER n" label; undefined for front and back matter. */
export function chapterNumberOf(manifest: Manifest, id: string | null): number | undefined {
  if (!id || sectionOf(manifest, id) !== "chapter") return undefined;
  const n = readingOrder(manifest)
    .filter((e) => sectionOf(manifest, e.id) === "chapter")
    .findIndex((e) => e.id === id);
  return n >= 0 ? n + 1 : undefined;
}

interface StackProps {
  editor: TipTapEditor;
  look: PageLook;
  zoom: number;
  /** A chapter gets the opening, running heads and the page-number chain; matter is plain pages. */
  section: "front" | "chapter" | "back";
  chapterTitle: string;
  chapterNumber: number | undefined;
  firstPage: number;
  /** Typst's page breaks for this chapter (Page view in Write mode); `exactKey` changes with it. Without them the breaks are estimated. */
  exact?: ExactSource | null;
  exactKey?: string;
  /** Called with the cards after every pagination. Held by reference: it need not be stable. */
  onLayout?: (layout: PageLayoutResult) => void;
  onCursorPage?: (page: number) => void;
  children: ReactNode;
}

/**
 * One page's stack of cards at the trim size with the editor's text column on top of them, scaled as a whole by the zoom. The cards
 * are placed from what the pagination plugin measures (see `pagination/`). Used by Page view (one stack) and by the reader (one per
 * chapter). The editor must have the Pagination extension.
 */
export function PageStack({
  editor,
  look,
  zoom,
  section,
  chapterTitle,
  chapterNumber,
  firstPage,
  exact = null,
  exactKey = "",
  onLayout,
  onCursorPage,
  children,
}: StackProps) {
  const { book, g, trim, print, fontStack, family, bookTitle, language } = look;
  const rtl = dirFor(language) === "rtl";
  const isChapter = section === "chapter";
  const callbacks = useRef({ onLayout, onCursorPage });
  callbacks.current = { onLayout, onCursorPage };

  // Pages as the plugin lays them out; until the first measurement, one card.
  const [layout, setLayout] = useState<PageLayoutResult | null>(null);
  const pages: PageSpec[] = useMemo(
    () =>
      layout?.pages ?? [
        {
          index: 0,
          number: firstPage,
          top: 0,
          height: g.page.h,
          kind: isChapter ? "open" : "body",
        },
      ],
    [layout, firstPage, g.page.h, isChapter],
  );
  const stackH = Math.max(g.page.h, layout?.height ?? 0);
  const startsOn = chapterStart(book);
  const slackPx = pageFillSlackPx(book);
  const layoutKey = `${book.template}|${trim}|${fontStack}|${family ?? ""}`;
  const controller = (
    editor.storage as unknown as { pagination: { controller: PaginationController } }
  ).pagination.controller;

  useEffect(() => {
    controller.configure({
      on: true,
      geometry: g,
      slackPx,
      firstPage,
      startsOn,
      opensChapter: isChapter,
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
  }, [controller, g, slackPx, firstPage, startsOn, isChapter, zoom, layoutKey, exact, exactKey]);
  useEffect(() => () => controller.configure(null), [controller]);

  const vars = useMemo(
    () => ({
      ...cssVarsStyle(pageCssVars(book, chapterNumber)),
      "--page-mt": `${g.margins.top}px`,
      "--page-mb": `${g.margins.bottom}px`,
      // A right-to-left book is bound on the right: its inside margin is the right one, and the verso shifts the other way.
      "--page-ml": `${rtl ? g.margins.outside : g.margins.inside}px`,
      "--page-mr": `${rtl ? g.margins.inside : g.margins.outside}px`,
      "--page-verso-shift": `${(g.margins.outside - g.margins.inside) * (rtl ? -1 : 1)}px`,
      "--page-head-size": `${print.runningText.sizePt * PX_PER_PT}px`,
      "--page-font": fontStack,
    }),
    [book, chapterNumber, g, print.runningText.sizePt, fontStack, rtl],
  ) as CSSProperties;

  return (
    <div className="page-sizer mx-auto" style={{ width: g.page.w * zoom, height: stackH * zoom }}>
      <div
        className="page-stack relative"
        data-zoom={zoom}
        style={{
          ...vars,
          width: g.page.w,
          height: stackH,
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
        }}
      >
        <div className="page-cards pointer-events-none absolute inset-0" aria-hidden="true">
          {pages.map((p) => (
            <PageCard
              key={p.index}
              page={p}
              head={runningHead(p.kind, p.number, bookTitle, chapterTitle, isChapter)}
              verso={p.number % 2 === 0}
              left={sideMargins(g, p.number, rtl).left}
            />
          ))}
        </div>
        <div className="prose-manuscript prose-page relative z-[1]">{children}</div>
      </div>
    </div>
  );
}

interface Props {
  editor: TipTapEditor;
  children: ReactNode;
}

/** Page view of the open page in Write mode: the page stack in a scroller, with the caption chip. */
export function PageFrame({ editor, children }: Props) {
  const { t } = useLingui();
  const { zoom: zoomPref } = usePageView();
  const manifest = useProject((s) => s.manifest)!;
  const currentId = useProject((s) => s.currentId);
  const wordsBefore = useProject((s) => s.actions.chapterWordsBefore);
  const look = usePageLook();
  const { book, g, trim, family, language } = look;

  const section = (currentId ? sectionOf(manifest, currentId) : null) ?? "front";
  const isChapter = section === "chapter";
  const entry = readingOrder(manifest).find((e) => e.id === currentId);
  const chapterNumber = chapterNumberOf(manifest, currentId);
  const chapterTitle = entry
    ? (entry.titles[language] ?? sourceTitle(entry, manifest.editions))
    : "";

  // Which page number this chapter starts on, from the earlier chapters' word counts (see lib/pageNumbering.ts).
  const [estimatedFirst, setEstimatedFirst] = useState(1);
  useEffect(() => {
    if (!isChapter || !currentId) return setEstimatedFirst(1);
    let live = true;
    wordsBefore(currentId)
      .then((w) => live && setEstimatedFirst(firstPageNumber(book, w)))
      .catch(() => live && setEstimatedFirst(1));
    return () => {
      live = false;
    };
  }, [isChapter, currentId, book, wordsBefore, manifest.chapters]);
  // Typst's printed number for this chapter's first page replaces the estimate. The last report is used even while an edit makes
  // it stale: a few words rarely move a chapter's start, and swapping numbers on every keystroke would reflow the page cards.
  const typstFirst = usePageMeasure((s) => {
    const report = usableReport(s.report);
    return report && currentId ? reportStartNumber(report, currentId) : null;
  });
  const firstPage = isChapter && typstFirst !== null ? typstFirst : estimatedFirst;
  // Typst's breaks inside this page entry, from the newest report that has it (the chapter's own measure comes much sooner than the
  // book's). The plugin checks they still fit the text, so a stale report is only used while the edits left the blocks as they were.
  useMeasuredChapter(true, currentId);
  const breaksFrom = usePageMeasure(
    (s) => (currentId ? breaksReport(s, currentId)?.report : null) ?? null,
  );
  const breaksAt = usePageMeasure((s) => (currentId ? breaksReport(s, currentId)?.at : 0) ?? 0);
  const exact = useMemo(
    () => (currentId && breaksFrom ? reportChapterMarks(breaksFrom, currentId) : null),
    [currentId, breaksFrom],
  );
  const exactKey = `${currentId ?? ""}:${breaksAt}`;

  // Zoom: a fixed factor, or the one that fits the pane's width.
  const scroller = useRef<HTMLDivElement>(null);
  const paneW = usePaneWidth(scroller);
  const zoom = zoomPref === "fit" ? fitZoom(g, paneW || g.page.w + 48) : zoomPref;

  const onLayout = useCallback(
    (l: PageLayoutResult) => setPageCount(l.pages.length, undefined, l.exact),
    [],
  );
  const onCursor = useCallback(
    (p: number) => setPageCount(usePageCount.getState().count, p + 1),
    [],
  );
  useEffect(() => () => setPageCount(0), []);

  const size = trimLabel(trim);
  const exactBreaks = usePageCount((s) => s.exact);
  const fontNote = family
    ? t`Text is set in ${family}, the font the PDF uses for this template.`
    : t`The template's print font is not installed here, so the bundled serif is used.`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex shrink-0 justify-center px-4 pb-1 pt-3">
        <span
          className="page-chip rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink-muted"
          title={`${fontNote} ${
            exactBreaks
              ? t`Page breaks are the PDF's: each page holds the text it holds there. Line wrapping inside a page can differ a little.`
              : t`Page breaks are approximate: the PDF is the reference.`
          }`}
        >
          {exactBreaks ? t`${size} · breaks as in the PDF` : t`${size} · approximate`}
        </span>
      </div>
      <div
        ref={scroller}
        data-testid="page-scroll"
        className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-6 pb-12 pt-3"
      >
        <PageStack
          editor={editor}
          look={look}
          zoom={zoom}
          section={section}
          chapterTitle={chapterTitle}
          chapterNumber={chapterNumber}
          firstPage={firstPage}
          exact={exact}
          exactKey={exactKey}
          onLayout={onLayout}
          onCursorPage={onCursor}
        >
          {children}
        </PageStack>
      </div>
    </div>
  );
}

/**
 * The writing surface where a page does not fit (a phone): the same template type, indents, headings and scene breaks as the pages,
 * at the full width of the screen, with no page edges, running heads or breaks.
 */
export function ReflowFrame({ children }: { children: ReactNode }) {
  const look = usePageLook();
  const manifest = useProject((s) => s.manifest)!;
  const currentId = useProject((s) => s.currentId);
  const chapterNumber = chapterNumberOf(manifest, currentId);
  const { book, fontStack } = look;
  const vars = useMemo(
    () =>
      ({
        ...cssVarsStyle(pageCssVars(book, chapterNumber)),
        "--page-font": fontStack,
      }) as CSSProperties,
    [book, chapterNumber, fontStack],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto max-md:order-first" data-testid="reflow-scroll">
      <div
        className="prose-manuscript prose-page prose-reflow mx-auto max-w-xl px-4 pb-8 pt-6"
        style={vars}
      >
        {children}
      </div>
    </div>
  );
}
