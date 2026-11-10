import {
  dropLeadingPageBreak,
  type ChapterDoc,
  type DocNode,
  type EntryKind,
  type Section,
} from "@cadabracraft/shared";
import { renderChapter, type MarkdownOptions } from "./markdown";
import { glossaryMarkdown, indexMarkdown } from "./generated";
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
  /** BCP 47 code; written as `lang` in the front matter (`MarkdownOptions.frontMatter`). */
  language?: string;
}

export interface MarkdownChapter {
  id?: string;
  title: string;
  doc: ChapterDoc;
  /** Front matter, chapter (default) or back matter. Used only to put the pages in reading order. */
  section?: Section;
  kind?: EntryKind;
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
  book: MarkdownBook,
  chapters: MarkdownChapter[],
  opts: MarkdownOptions = {},
  contents?: MarkdownContents,
): string[] {
  let offset = opts.footnoteOffset ?? 0;
  // A blank page has no text and Markdown has no pages, so it is left out.
  const docs = readingOrder(chapters)
    .filter((c) => c.kind !== "blank")
    .map((c) => {
      // A break as the page's first block asks for nothing (the page is already at the top of its own document).
      const { doc: body } = dropLeadingPageBreak(c.doc);
      const title = c.title.trim();
      const noTitleAdded = !title || startsWithTitle(body);
      const doc: ChapterDoc = noTitleAdded
        ? body
        : {
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
              ...body.content,
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
  const out = docs.map(({ c, doc }) => {
    const r = renderChapter(doc, { ...opts, footnoteOffset: offset });
    offset += r.footnotes;
    if (contents === undefined || c.kind !== "contents") return r.markdown;
    const list = contentsMarkdown(contents, pages);
    return list === "" ? r.markdown : `${r.markdown === "" ? "" : `${r.markdown}\n`}${list}\n`;
  });
  // The index and the glossary are generated from the marks, after the author's pages; one with nothing to list is left out.
  if (opts.index && opts.index.tree.groups.length > 0) {
    const titles = new Map<string, string>();
    for (const { c } of docs) if (c.id !== undefined) titles.set(c.id, c.title.trim());
    out.push(indexMarkdown(opts.index, titles, book.language));
  }
  if (opts.glossary && opts.glossary.items.length > 0) out.push(glossaryMarkdown(opts.glossary));
  return out;
}

/** A one-line YAML scalar: JSON strings are valid double-quoted YAML. */
const yamlString = (s: string): string => JSON.stringify(s);

/** The YAML front matter block (`MarkdownOptions.frontMatter`): the title, and the language when the book has one. */
function frontMatterOf(book: MarkdownBook): string {
  const lang = book.language?.trim();
  return `---\ntitle: ${yamlString(book.title.trim())}\n${lang ? `lang: ${yamlString(lang)}\n` : ""}---\n\n`;
}

/**
 * The whole book as one Markdown document: all pages in reading order, separated by a blank line. With
 * `opts.frontMatter` a YAML block with the title and language comes first.
 */
export function bookToMarkdown(
  book: MarkdownBook,
  chapters: MarkdownChapter[],
  opts: MarkdownOptions = {},
  contents?: Omit<MarkdownContents, "files">,
): string {
  const body = chaptersToMarkdown(book, chapters, opts, contents)
    .filter((s) => s !== "")
    .join("\n");
  return opts.frontMatter ? frontMatterOf(book) + body : body;
}
