import type { ChapterDoc, DocNode, MatterKind, Section } from "@cadabracraft/shared";
import { renderChapter, type MarkdownOptions } from "./markdown";
import {
  contentsMarkdown,
  headingTexts,
  slugger,
  type ContentsPage,
  type MarkdownContents,
} from "./contents";

export { MarkdownExportError, type MarkdownOptions } from "./markdown";
export type { MarkdownContents, MarkdownContentsItem } from "./contents";

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
    .sort(
      (a, b) =>
        SECTION_RANK[a.c.section ?? "chapter"] - SECTION_RANK[b.c.section ?? "chapter"] ||
        a.i - b.i,
    )
    .map((x) => x.c);
}

/**
 * One Markdown string per page, in reading order. A page whose document does not start with a level-1 heading gets
 * `# Title` from its title, so every string can be imported as a chapter on its own. Footnote labels continue across
 * pages, so the strings can be concatenated without clashes.
 *
 * With `contents` the page of kind "contents" also gets the list: nested bullets (two spaces per level, no page numbers) linking
 * to the pages' headings by their GitHub-style anchors (see `MarkdownContents`).
 */
export function chaptersToMarkdown(
  _book: MarkdownBook,
  chapters: MarkdownChapter[],
  opts: MarkdownOptions = {},
  contents?: MarkdownContents,
): string[] {
  let offset = opts.footnoteOffset ?? 0;
  const docs = readingOrder(chapters).map((c) => {
    const title = c.title.trim();
    const noTitleAdded = !title || startsWithTitle(c.doc);
    const doc: ChapterDoc = noTitleAdded
      ? c.doc
      : {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
            ...c.doc.content,
          ],
        };
    return { c, doc, added: noTitleAdded ? 0 : 1 };
  });
  const pages = new Map<string, ContentsPage>();
  if (contents !== undefined) {
    // One document: anchors are unique across all pages. One file per page: unique within the file.
    const whole = slugger();
    const perFile = new Map<string, (t: string) => string>();
    for (const { c, doc, added } of docs) {
      const file = c.id === undefined ? undefined : contents.files?.[c.id];
      let slug = whole;
      if (contents.files !== undefined) {
        const key = file ?? "";
        if (!perFile.has(key)) perFile.set(key, slugger());
        slug = perFile.get(key)!;
      }
      const anchors = headingTexts(doc).map(slug);
      if (c.id !== undefined)
        pages.set(c.id, { id: c.id, ...(file === undefined ? {} : { file }), anchors, added });
    }
  }
  return docs.map(({ c, doc }) => {
    const r = renderChapter(doc, { ...opts, footnoteOffset: offset });
    offset += r.footnotes;
    if (contents === undefined || c.kind !== "contents") return r.markdown;
    const list = contentsMarkdown(contents, pages);
    return list === "" ? r.markdown : `${r.markdown === "" ? "" : `${r.markdown}\n`}${list}\n`;
  });
}

/** The whole book as one Markdown document: all pages in reading order, separated by a blank line. */
export function bookToMarkdown(
  book: MarkdownBook,
  chapters: MarkdownChapter[],
  opts: MarkdownOptions = {},
  contents?: Omit<MarkdownContents, "files">,
): string {
  return chaptersToMarkdown(book, chapters, opts, contents)
    .filter((s) => s !== "")
    .join("\n");
}
