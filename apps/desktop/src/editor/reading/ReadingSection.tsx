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
import { FootnoteA11y } from "../footnoteA11y";
import { ReadingContents } from "./ReadingContents";
import { useProject } from "../../state/project/index";
import { Pagination } from "../pagination/plugin";
import { Search, goToMatch, searchCommands, type SearchSettings } from "../search/plugin";
import type { PageLayoutResult } from "../pagination/core";
import { PageStack, type PageLook } from "../pageview/PageFrame";
import { pageIsBare, pageIsCentred } from "../centring";
import { dirFor } from "../../i18n/locales";
import type { BookPage } from "../../state/project/types";
import { sizes, widths, type Width } from "../../state/view/reading";
import { reportChapterMarks } from "../../lib/page/pageReport";
import type { BookSearchOptions } from "../../lib/search/bookSearch";
import { cx } from "../../ui/cx";

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
  /** Physical page of the section's first card (the book layout's `cardStart`). */
  firstPage: number;
  /** The book layout says a blank verso comes first. */
  blankBefore: boolean;
  /** The number the book prints on a physical page (see `PageStack`). */
  folioFor: (physical: number) => string;
  chapterNumber: number | undefined;
  size: number;
  width: Width;
  gap: number;
  onPages: (id: string, pages: number) => void;
  /** Typst's layout of the book (a run with page marks), whose page breaks the chapters draw; null until there is one. */
  report: PageReport | null;
  /** Changes with `report`. */
  reportAt: number;
  /** An entry of the Contents page was chosen: scroll to that page, and to one of its headings when given. */
  onOpen: (id: string, heading?: number) => void;
  /** The find bar's search, highlighted in this chapter's editor; null while Find is closed. */
  search: BookSearchOptions | null;
  /** Which of this chapter's matches is the current one of the find bar, or -1 when it is in another chapter. */
  matchIndex: number;
  /** Called once this chapter's editor has marked its current match, and when that chapter changes height, so the reader can scroll to it. */
  onMatch: (id: string) => void;
}

/** One chapter of the book: a section that is a placeholder until it is near the viewport, then a read-only editor. */
export const ReadingSection = memo(function ReadingSection(p: SectionProps) {
  const { page, near, observer, onResize, onMatch, heights } = p;
  // A Contents page is drawn from the generated list, not from its text: the same page as in the editor's preview.
  const contents = useProject((s) =>
    page.kind === "contents" ? s.manifest?.frontMatter.find((e) => e.id === page.id) : undefined,
  );
  const ref = useRef<HTMLElement>(null);
  const nearRef = useRef(near);
  nearRef.current = near;
  const matchRef = useRef(p.matchIndex);
  matchRef.current = p.matchIndex;
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
      // The chapter that holds the current find match changed height (its pages were laid out): the match has moved.
      if (matchRef.current >= 0) onMatch(page.id);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.id, onResize, onMatch, heights]);
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
      {near &&
        (contents ? (
          <ReadingContents
            key={p.paged ? "paged" : "plain"}
            entry={contents}
            paged={p.paged}
            zoom={p.zoom}
            language={p.look.language}
            size={p.size}
            width={p.width}
            onPages={p.onPages}
            onOpen={p.onOpen}
          />
        ) : (
          <ReadingChapter key={p.paged ? "paged" : "plain"} {...p} />
        ))}
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
  blankBefore,
  folioFor,
  chapterNumber,
  size,
  width,
  onPages,
  report,
  reportAt,
  search,
  matchIndex,
  onMatch,
}: SectionProps) {
  const { t } = useLingui();
  const noteLabels = FootnoteA11y((n) => t`Footnote ${n}`);
  const editor = useEditor({
    extensions: paged
      ? [...extensions, Search, Pagination, noteLabels]
      : [...extensions, Search, noteLabels],
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
  // Find in Read mode: highlight the matches of the find bar, and mark the current one when it is in this chapter.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const s: SearchSettings = search
      ? { ...search, replacement: "" }
      : { query: "", replacement: "", matchCase: false, wholeWord: false };
    searchCommands(editor).setSearch(s);
  }, [editor, search]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !search || matchIndex < 0) return;
    if (goToMatch(editor, matchIndex)) onMatch(page.id);
  }, [editor, search, matchIndex, onMatch, page.id]);
  // The pages of this section (a blank verso before it not counted): later sections start after them.
  const onLayout = useCallback(
    (l: PageLayoutResult) => onPages(page.id, l.pages.filter((p) => p.kind !== "blank").length),
    [onPages, page.id],
  );
  const exact = useMemo(
    () => (report ? reportChapterMarks(report, page.id) : null),
    [report, page.id],
  );
  if (!editor) return null;
  const centred = pageIsCentred(look, page.section, page.kind, page);
  if (paged)
    return (
      <PageStack
        editor={editor}
        look={look}
        zoom={zoom}
        section={page.kind === "blank" || page.kind === "part" ? "front" : page.section}
        chapterTitle={page.title}
        chapterNumber={chapterNumber}
        dropCap={page.kind === "part" ? false : page.dropCap}
        verticalCenter={centred}
        bare={pageIsBare(centred, page.section, page.kind)}
        kind={page.kind}
        firstPage={firstPage}
        blankBefore={blankBefore}
        folioFor={folioFor}
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
