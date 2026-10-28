import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLingui } from "@lingui/react/macro";
import type { Editor as TipTapEditor } from "@tiptap/react";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { readingOrder, sectionOf, sourceEdition, sourceTitle } from "@cadabracraft/format";
import { usePageView } from "../app/hooks/usePageView";
import { useFontList } from "../app/hooks/useFontList";
import { editorFontStack, type EditorFont } from "../state/editorPrefs";
import { setPageCount, usePageCount } from "../state/pageCount";
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

interface Props {
  editor: TipTapEditor;
  /** The author's manuscript font: used when the template's print font is not available here. */
  manuscriptFont: EditorFont;
  children: ReactNode;
}

/**
 * Page view of the open page: a stack of page cards at the trim size with the editor's text column on top of them, scaled as a whole
 * by the zoom. The cards are placed from what the pagination plugin measures (see `pagination/`).
 */
export function PageFrame({ editor, manuscriptFont, children }: Props) {
  const { t } = useLingui();
  const { zoom: zoomPref } = usePageView();
  const manifest = useProject((s) => s.manifest)!;
  const currentId = useProject((s) => s.currentId);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const wordsBefore = useProject((s) => s.actions.chapterWordsBefore);
  const { fonts } = useFontList();

  const book = useMemo(
    () => ({ template: manifest.template, trimSize: manifest.trimSize }),
    [manifest.template, manifest.trimSize],
  );
  const g = useMemo(() => pageGeometry(book), [book]);
  const trim = resolveTrimSize(book);
  const print = getTemplate(hasTemplate(book.template) ? book.template : DEFAULT_TEMPLATE_ID).print;
  const section = currentId ? sectionOf(manifest, currentId) : null;
  const isChapter = section === "chapter";
  const entry = readingOrder(manifest).find((e) => e.id === currentId);
  const chapterTitle = entry
    ? (entry.titles[language] ?? sourceTitle(entry, manifest.editions))
    : "";
  const bookTitle =
    manifest.editions.find((e) => e.language === language)?.title ??
    sourceEdition(manifest.editions).title;

  // Which page number this chapter starts on, from the earlier chapters' word counts (see lib/pageNumbering.ts).
  const [firstPage, setFirstPage] = useState(1);
  useEffect(() => {
    if (!isChapter || !currentId) return setFirstPage(1);
    let live = true;
    wordsBefore(currentId)
      .then((w) => live && setFirstPage(firstPageNumber(book, w)))
      .catch(() => live && setFirstPage(1));
    return () => {
      live = false;
    };
  }, [isChapter, currentId, book, wordsBefore, manifest.chapters]);

  // Text font: the template's print body font when it can be drawn here, else the author's manuscript font.
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
  const fontStack = family ? pageFontStack(family) : editorFontStack(manuscriptFont);

  // Zoom: a fixed factor, or the one that fits the pane's width.
  const scroller = useRef<HTMLDivElement>(null);
  const [paneW, setPaneW] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => setPaneW(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const zoom = zoomPref === "fit" ? fitZoom(g, paneW || g.page.w + 48) : zoomPref;

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
  const onCursor = useCallback(
    (p: number) => setPageCount(usePageCount.getState().count, p + 1),
    [],
  );
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
      onLayout: (l) => {
        setLayout(l);
        setPageCount(l.pages.length);
      },
      onCursorPage: onCursor,
    });
  }, [controller, g, slackPx, firstPage, startsOn, isChapter, zoom, layoutKey, onCursor]);
  useEffect(
    () => () => {
      controller.configure(null);
      setPageCount(0);
    },
    [controller],
  );

  const vars = useMemo(
    () => ({
      ...cssVarsStyle(pageCssVars(book)),
      "--page-mt": `${g.margins.top}px`,
      "--page-mb": `${g.margins.bottom}px`,
      "--page-ml": `${g.margins.inside}px`,
      "--page-mr": `${g.margins.outside}px`,
      "--page-verso-shift": `${g.margins.outside - g.margins.inside}px`,
      "--page-head-size": `${print.runningText.sizePt * PX_PER_PT}px`,
      "--page-font": fontStack,
    }),
    [book, g, print.runningText.sizePt, fontStack],
  ) as CSSProperties;

  const size = trimLabel(trim);
  const fontNote = family
    ? t`Text is set in ${family}, the font the PDF uses for this template.`
    : t`The template's print font is not installed here, so your manuscript font is used.`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex shrink-0 justify-center px-4 pb-1 pt-3">
        <span
          className="page-chip rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink-muted"
          title={`${fontNote} ${t`Page breaks are approximate: the PDF is the reference.`}`}
        >
          {t`Page view · ${size} · approximate`}
        </span>
      </div>
      <div
        ref={scroller}
        data-testid="page-scroll"
        className="min-h-0 flex-1 overflow-auto px-6 pb-12 pt-3"
      >
        <div
          className="page-sizer mx-auto"
          style={{ width: g.page.w * zoom, height: stackH * zoom }}
        >
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
                  left={sideMargins(g, p.number).left}
                />
              ))}
            </div>
            <div className="prose-manuscript prose-page relative z-[1]">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
