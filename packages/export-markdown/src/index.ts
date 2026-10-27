import type { ChapterDoc, DocNode, MatterKind, Section } from "@cadabracraft/shared";
import { MarkdownExportError, renderChapter, type MarkdownOptions } from "./markdown";

export { MarkdownExportError, type MarkdownOptions } from "./markdown";

export interface MarkdownBook {
  title: string;
  author?: string;
}

export interface MarkdownChapter {
  id?: string;
  title: string;
  doc: ChapterDoc;
  /** Front matter, chapter (default) or back matter. Used only to put the pages in reading order. */
  section?: Section;
  kind?: MatterKind;
}

/** One chapter document as Markdown (inverse of `importMarkdown` in `@cadabracraft/import-docx`). Throws `MarkdownExportError` on anything it cannot write. */
export function chapterToMarkdown(doc: ChapterDoc, opts: MarkdownOptions = {}): string {
  return renderChapter(doc, opts).markdown;
}

const startsWithTitle = (doc: ChapterDoc): boolean => {
  const first: DocNode | undefined = doc.content[0];
  return first?.type === "heading" && first.attrs?.level === 1;
};

const SECTION_RANK: Record<Section, number> = { front: 0, chapter: 1, back: 2 };

/** Pages in reading order: front matter, chapters, back matter (stable within each). */
function readingOrder(chapters: MarkdownChapter[]): MarkdownChapter[] {
  return chapters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SECTION_RANK[a.c.section ?? "chapter"] - SECTION_RANK[b.c.section ?? "chapter"] || a.i - b.i)
    .map((x) => x.c);
}

/**
 * One Markdown string per page, in reading order. A page whose document does not start with a level-1 heading gets
 * `# Title` from its title, so every string can be imported as a chapter on its own. Footnote labels continue across
 * pages, so the strings can be concatenated without clashes.
 */
export function chaptersToMarkdown(_book: MarkdownBook, chapters: MarkdownChapter[], opts: MarkdownOptions = {}): string[] {
  let offset = opts.footnoteOffset ?? 0;
  return readingOrder(chapters).map((c) => {
    const title = c.title.trim();
    const doc: ChapterDoc = !title || startsWithTitle(c.doc) ? c.doc : { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, ...c.doc.content] };
    const r = renderChapter(doc, { ...opts, footnoteOffset: offset });
    offset += r.footnotes;
    return r.markdown;
  });
}

/** The whole book as one Markdown document: all pages in reading order, separated by a blank line. */
export function bookToMarkdown(book: MarkdownBook, chapters: MarkdownChapter[], opts: MarkdownOptions = {}): string {
  return chaptersToMarkdown(book, chapters, opts).filter((s) => s !== "").join("\n");
}
