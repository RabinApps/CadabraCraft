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
import { readingOrder, sectionOf, sourceTitle } from "@cadabracraft/format";
import type { EntryKind } from "@cadabracraft/shared";
import { usePageView } from "../app/hooks/usePageView";
import { usePaneWidth } from "../app/hooks/usePaneWidth";
import { useTypewriterSlack } from "./typewriter";
import { useSectionScroll } from "./useSectionScroll";
import { dirFor } from "../i18n/locales";
import { setEntryPages, setPageCount, usePageCount } from "../state/pageCount";
import { breaksReport, usePageMeasure } from "../state/pageMeasure";
import { useMeasuredChapter } from "../app/hooks/useMeasuredChapter";
import { useBookLayout } from "../app/hooks/useBookLayout";
import type { ExactSource } from "../lib/exactBreaks";
import { reportChapterMarks } from "../lib/pageReport";
import { folioText } from "@cadabracraft/shared";
import { useProject } from "../state/project/index";
import { chapterStart } from "../lib/pageNumbering";
import { trimLabel } from "../lib/trimLabels";
import { cx } from "../ui/cx";
import {
  centredPage,
  matterHeadsOn,
  pageIsBare,
  pageIsCentred,
  pageIsCopyright,
  pageIsNarrow,
  useCentredColumn,
} from "./centring";
import { PX_PER_INCH, fitZoom, pageCssVars, pageFillSlackPx, sideMargins } from "../lib/pageLayout";
import type { PageLayoutResult, PageSpec } from "./pagination/core";
import { cssVarsStyle, runningHead } from "./pagination/frame";
import type { PaginationController } from "./pagination/plugin";

/** pt to CSS px. */
const PX_PER_PT = PX_PER_INCH / 72;

interface CardProps {
  page: PageSpec;
  head: string | null;
  verso: boolean;
  left: number;
  /** The number the PDF prints on this page ("iv", "12"), or "" when it prints none. */
  folio: string;
}

const PageCard = memo(function PageCard({ page, head, verso, left, folio }: CardProps) {
  return (
    <div
      className="page page-card"
      data-page={folio}
      data-physical={page.number}
      data-index={page.index}
      data-blank={page.kind === "blank" ? "true" : undefined}
      data-kind={page.kind}
      style={
        { top: page.top, height: page.height, "--page-card-left": `${left}px` } as CSSProperties
      }
    >
      {head && <div className={`page-head ${verso ? "is-verso" : "is-recto"}`}>{head}</div>}
      {folio !== "" && <div className="page-number">{folio}</div>}
    </div>
  );
});

export { chapterNumberOf, usePageLook, type PageLook } from "./usePageLook";
import { chapterNumberOf, usePageLook, type PageLook } from "./usePageLook";

interface StackProps {
  editor: TipTapEditor;
  look: PageLook;
  zoom: number;
  /** A chapter gets the opening, running heads and the page-number chain; a matter page heads the pages it runs onto (see `matterHeadsOn`). */
  section: "front" | "chapter" | "back";
  chapterTitle: string;
  chapterNumber: number | undefined;
  /** The author's big-first-letter choice for this chapter (its own, else the book's); undefined follows the template. */
  dropCap?: boolean | undefined;
  /** The page's content sits in the vertical middle of its page (see `pageIsCentred`); only while it is a single page. */
  verticalCenter?: boolean | undefined;
  /** No chapter opening above the first heading (see `pageIsBare`). */
  bare?: boolean | undefined;
  /** The page's matter kind: the copyright page and a centred page have layouts of their own (see `pageIsCopyright`, `pageIsNarrow`). */
  kind?: EntryKind | undefined;
  /** Physical page of the first card (the book layout's `cardStart`), a blank verso included. */
  firstPage: number;
  /** The book layout says a blank verso comes first (`blankBefore`): the first card is that blank page. */
  blankBefore?: boolean | undefined;
  /** The number the book prints on a physical page: roman in the front matter, arabic from chapter 1 on, "" where it prints none. */
  folioFor: (physical: number) => string;
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
  dropCap,
  verticalCenter = false,
  bare = false,
  kind,
  firstPage,
  blankBefore = false,
  folioFor,
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
  const layoutKey = `${book.template}|${trim}|${fontStack}|${family ?? ""}|${String(dropCap)}`;
  const controller = (
    editor.storage as unknown as { pagination: { controller: PaginationController } }
  ).pagination.controller;

  // A short page is centred between its margins; one that needs more than a page is not (it fills them anyway). The blank verso the
  // book puts before a dedication is a card here but not a page of the entry, so it does not count (see `centredPage`), and the
  // offset goes below its spacer rather than above it (see index.css). Not until the pages are laid out: the pagination reads the
  // spacers' places to place the cards, and before the first layout there is no blank page to put the offset below.
  const centred =
    layout !== null &&
    centredPage(
      verticalCenter,
      pages.map((p) => p.kind),
    );
  const afterBlank = pages[0]?.kind === "blank";
  const column = useCentredColumn(centred, g.text.h, zoom, `${layoutKey}`);
  // The two matter layouts Page view draws as the print page does (see index.css). The block of a centred page follows the page's
  // choice rather than the page count, so the width the pagination measures is the width the page draws.
  const narrow = pageIsNarrow(verticalCenter, section, kind);
  const copyright = pageIsCopyright(section, kind);
  // Running heads: a chapter heads every page but its opening, a matter page heads the pages it runs onto (never the page the entry
  // opens on, and never a page laid out without a head; see `matterHeadsOn`). A blank verso before the entry is not a page of it.
  const headsOn = isChapter || matterHeadsOn(verticalCenter, section, kind);
  const firstTextCard = pages.findIndex((p) => p.kind !== "blank");

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
  ]);
  useEffect(() => () => controller.configure(null), [controller]);

  const vars = useMemo(
    () => ({
      ...cssVarsStyle(pageCssVars(book, chapterNumber, dropCap)),
      "--page-mt": `${g.margins.top}px`,
      "--page-mb": `${g.margins.bottom}px`,
      // A right-to-left book is bound on the right: its inside margin is the right one, and the verso shifts the other way.
      "--page-ml": `${rtl ? g.margins.outside : g.margins.inside}px`,
      "--page-mr": `${rtl ? g.margins.inside : g.margins.outside}px`,
      "--page-verso-shift": `${(g.margins.outside - g.margins.inside) * (rtl ? -1 : 1)}px`,
      "--page-head-size": `${print.runningText.sizePt * PX_PER_PT}px`,
      "--page-font": fontStack,
    }),
    [book, chapterNumber, dropCap, g, print.runningText.sizePt, fontStack, rtl],
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
          {pages.map((p, i) => (
            <PageCard
              key={p.index}
              page={p}
              head={runningHead(
                p.kind,
                p.number,
                bookTitle,
                chapterTitle,
                headsOn && i !== firstTextCard,
              )}
              verso={p.number % 2 === 0}
              left={sideMargins(g, p.number, rtl).left}
              folio={folioFor(p.number)}
            />
          ))}
        </div>
        <div
          ref={column}
          className={cx(
            "prose-manuscript prose-page relative z-[1]",
            centred && "page-centred",
            centred && afterBlank && "page-centred-after-blank",
            bare && "page-bare",
            narrow && "page-narrow",
            copyright && "page-copyright",
            kind === "part" && "page-part",
          )}
        >
          {children}
        </div>
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
  const look = usePageLook();
  const { book, g, trim, family, fontStack, language } = look;

  const section = (currentId ? sectionOf(manifest, currentId) : null) ?? "front";
  const entry = readingOrder(manifest).find((e) => e.id === currentId);
  const chapterNumber = chapterNumberOf(manifest, currentId);
  const chapterTitle = entry
    ? (entry.titles[language] ?? sourceTitle(entry, manifest.editions))
    : "";

  // Where this page starts in the book and what number it prints there, from the book's layout: Typst's report, the editors'
  // measures and the word estimate (see lib/pageNumbering.ts). A blank verso before the page is part of the stack.
  const bookPages = useBookLayout();
  const placed = currentId ? bookPages?.byId.get(currentId) : undefined;
  const firstPage = placed?.cardStart ?? 1;
  const folioFor = useCallback(
    (physical: number) => (bookPages ? folioText(bookPages, physical) : ""),
    [bookPages],
  );
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
  const slack = useTypewriterSlack(scroller);
  // Scrolling on past the last page opens the next section; above the first page, the previous one.
  const { onWheel } = useSectionScroll(scroller);

  // The pages this entry really takes (a blank verso before it not counted): later entries' starts follow it, so the numbers of
  // the whole book stay right while the author works through a chapter.
  const measureKey = `${book.template}|${trim}|${fontStack}|${family ?? ""}`;
  const onLayout = useCallback(
    (l: PageLayoutResult) => {
      setPageCount(l.pages.length, undefined, l.exact);
      if (currentId)
        setEntryPages(
          currentId,
          entry?.kind === "blank" ? 1 : l.pages.filter((p) => p.kind !== "blank").length,
          measureKey,
        );
    },
    [currentId, measureKey],
  );
  const onCursor = useCallback(
    (p: number) => setPageCount(usePageCount.getState().count, p + 1),
    [],
  );
  useEffect(() => () => setPageCount(0), []);

  // A blank page between two chapters is not a chapter opening: it is laid out, and prints, like a page of the matter.
  // A blank page or a part divider is drawn as its own page, not as a chapter opening: no sink, ornament, running head or drop cap.
  const pageSection = entry?.kind === "blank" || entry?.kind === "part" ? "front" : section;
  const centredNow = pageIsCentred(look, pageSection, entry?.kind, entry ?? {});
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
          aria-describedby="page-chip-note"
        >
          {exactBreaks ? t`${size} · breaks as in the PDF` : t`${size} · approximate`}
        </span>
        <span id="page-chip-note" data-testid="page-chip-note" className="sr-only">
          {`${fontNote} ${
            exactBreaks
              ? t`Page breaks are the PDF's: each page holds the text it holds there. Line wrapping inside a page can differ a little.`
              : t`Page breaks are approximate: the PDF is the reference.`
          }`}
        </span>
      </div>
      <div
        ref={scroller}
        data-testid="page-scroll"
        className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-6 pb-12 pt-3"
        style={slack ? { paddingBottom: slack } : undefined}
        onWheel={onWheel}
      >
        <PageStack
          editor={editor}
          look={look}
          zoom={zoom}
          section={pageSection}
          chapterTitle={chapterTitle}
          chapterNumber={chapterNumber}
          dropCap={entry?.kind === "part" ? false : (entry?.dropCap ?? manifest.dropCap)}
          verticalCenter={centredNow}
          bare={pageIsBare(centredNow, pageSection, entry?.kind)}
          kind={entry?.kind}
          firstPage={firstPage}
          blankBefore={placed?.blankBefore ?? false}
          folioFor={folioFor}
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
  const dropCap =
    readingOrder(manifest).find((e) => e.id === currentId)?.dropCap ?? manifest.dropCap;
  const { book, fontStack } = look;
  const scroller = useRef<HTMLDivElement>(null);
  const slack = useTypewriterSlack(scroller);
  const { onWheel } = useSectionScroll(scroller);
  const vars = useMemo(
    () =>
      ({
        ...cssVarsStyle(pageCssVars(book, chapterNumber, dropCap)),
        "--page-font": fontStack,
      }) as CSSProperties,
    [book, chapterNumber, dropCap, fontStack],
  );
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto max-md:order-first"
      data-testid="reflow-scroll"
      style={slack ? { paddingBottom: slack } : undefined}
      onWheel={onWheel}
    >
      <div
        className="prose-manuscript prose-page prose-reflow mx-auto max-w-xl px-4 pb-8 pt-6"
        style={vars}
      >
        {children}
      </div>
    </div>
  );
}
