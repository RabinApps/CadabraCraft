import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { useLingui } from "@lingui/react/macro";
import { EditorContent, useEditor } from "@tiptap/react";
import type { PageReport } from "@cadabracraft/export-pdf";
import { extensions } from "@cadabracraft/editor-schema";
import { FootnoteA11y } from "./footnoteA11y";
import { Pagination } from "./pagination/plugin";
import { PageStack, type PageLook } from "./PageFrame";
import { dirFor } from "../i18n/locales";
import type { BookPage } from "../state/project/types";
import { sizes, widths, type Width } from "../state/reading";
import { reportChapterMarks } from "../lib/pageReport";
import { cx } from "../ui/cx";

export interface SectionProps {
  page: BookPage;
  near: boolean;
  /** The laid-out chapter is on screen (always, in the plain layout): only then is its height worth remembering. */
  settled: boolean;
  /** Height of the placeholder while no editor is mounted: the last measured height, else an estimate. */
  placeholder: number;
  observer: IntersectionObserver | null;
  /** Called when this section changes size: the reader puts what it was looking at back where it was. */
  onResize: () => void;
  heights: MutableRefObject<Map<string, number>>;
  paged: boolean;
  first: boolean;
  look: PageLook;
  zoom: number;
  firstPage: number;
  chapterNumber: number | undefined;
  size: number;
  width: Width;
  gap: number;
  onPages: (id: string, pages: number) => void;
  /** Typst's layout of the book (a run with page marks), whose page breaks the chapters draw; null until there is one. */
  report: PageReport | null;
  /** Changes with `report`. */
  reportAt: number;
}

/** One chapter of the book: a section that is a placeholder until it is near the viewport, then a read-only editor. */
export const ReadingSection = memo(function ReadingSection(p: SectionProps) {
  const { page, near, observer, onResize, heights } = p;
  const ref = useRef<HTMLElement>(null);
  const nearRef = useRef(near);
  nearRef.current = near;
  const settledRef = useRef(p.settled);
  settledRef.current = p.settled;
  useEffect(() => {
    const el = ref.current;
    if (!observer || !el) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer]);
  // Remember how tall the laid-out chapter is, and keep the text in view where it was when a section above it changes height (a
  // placeholder replaced by the laid-out chapter).
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => {
      if (nearRef.current && settledRef.current)
        heights.current.set(page.id, el.getBoundingClientRect().height);
      onResize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.id, onResize, heights]);
  // A chapter that is already as tall as it will be has no size change to report when it settles.
  useEffect(() => {
    if (near && p.settled)
      heights.current.set(page.id, ref.current!.getBoundingClientRect().height);
  }, [near, p.settled, page.id, heights]);
  return (
    <section
      ref={ref}
      data-reading-id={page.id}
      data-testid="reading-section"
      aria-label={page.title}
      className={cx(!p.paged && !p.first && "border-t border-border")}
      // The placeholder keeps its height until the laid-out chapter is there, so mounting an editor moves nothing.
      style={{ height: near && p.settled ? undefined : p.placeholder, marginBottom: p.gap }}
    >
      {near && <ReadingChapter key={p.paged ? "paged" : "plain"} {...p} />}
    </section>
  );
});

/** The editor of one chapter, drawn as trim-size pages (md and up) or as plain reading text (phones). */
function ReadingChapter({
  page,
  paged,
  look,
  zoom,
  firstPage,
  chapterNumber,
  size,
  width,
  onPages,
  report,
  reportAt,
}: SectionProps) {
  const { t } = useLingui();
  const noteLabels = FootnoteA11y((n) => t`Footnote ${n}`);
  const editor = useEditor({
    extensions: paged ? [...extensions, Pagination, noteLabels] : [...extensions, noteLabels],
    editable: false,
    content: page.doc,
    editorProps: {
      // Read-only text is a document, not a textbox: TipTap's default role made VoiceOver say "edit text" for each chapter.
      attributes: {
        role: "document",
        lang: look.language,
        dir: dirFor(look.language),
        "aria-label": page.title,
      },
    },
  });
  const onLayout = useCallback(
    (l: { pages: unknown[] }) => onPages(page.id, l.pages.length),
    [onPages, page.id],
  );
  const exact = useMemo(
    () => (report ? reportChapterMarks(report, page.id) : null),
    [report, page.id],
  );
  if (!editor) return null;
  if (paged)
    return (
      <PageStack
        editor={editor}
        look={look}
        zoom={zoom}
        section={page.section}
        chapterTitle={page.title}
        chapterNumber={chapterNumber}
        firstPage={firstPage}
        exact={exact}
        exactKey={`${page.id}:${reportAt}`}
        onLayout={onLayout}
      >
        <EditorContent editor={editor} />
      </PageStack>
    );
  const style = { "--reading-size": `${sizes[size]}rem`, maxWidth: widths[width] } as CSSProperties;
  return (
    <div className="prose-manuscript prose-reading mx-auto px-6 pb-6 pt-10" style={style}>
      <EditorContent editor={editor} />
    </div>
  );
}
