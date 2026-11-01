/*
 * The one place where the contents page meets the exporters. Each exporter takes the list in its own option type (all structurally a
 * `TocItem`): PDF `toc`, EPUB `contents`, Word and Rich Text `contents`, Markdown `contents: { items }`. This module resolves the list
 * once for the language being exported, from the pages that are really in the export.
 */
import {
  extractOutline,
  resolveToc,
  tocSettingsOf,
  visibleTocItems,
  type Manifest,
  type OutlineItem,
  type TocItem,
} from "@cadabracraft/format";
import type { PdfToc } from "@cadabracraft/export-pdf";
import type { ChapterDoc } from "@cadabracraft/shared";

export interface BookContents {
  /** The contents page's entry id. */
  entryId: string;
  /** Every item in order, hidden ones flagged (a custom entry may still point at a hidden item). */
  all: TocItem[];
  /** What a reader sees: the hidden ones dropped. */
  visible: TocItem[];
  /** The contents page's page-number switch (print only). */
  pageNumbers: boolean;
}

/**
 * The book's contents list for `language`, or undefined when the book has no contents page among `pages` (no page, or it is left
 * out of this export, e.g. untranslated). Headings come from `pages` (their documents in `language`), so the list always matches
 * what is exported.
 */
export function bookContents(
  manifest: Manifest,
  language: string,
  pages: readonly { id: string; doc: ChapterDoc }[],
): BookContents | undefined {
  const entry = manifest.frontMatter.find(
    (e) => e.kind === "contents" && pages.some((p) => p.id === e.id),
  );
  if (!entry) return undefined;
  const settings = tocSettingsOf(entry);
  const outlines: Record<string, OutlineItem[]> = {};
  if (settings.depth > 0)
    for (const p of pages) if (p.id !== entry.id) outlines[p.id] = extractOutline(p.doc);
  const all = resolveToc(manifest, entry, language, outlines);
  return {
    entryId: entry.id,
    all,
    visible: visibleTocItems(all),
    pageNumbers: settings.pageNumbers,
  };
}

/** The PDF's `toc` option: every item (hidden flagged) and the page-number switch. */
export const pdfToc = (c: BookContents | undefined): PdfToc | undefined =>
  c && { items: c.all, pageNumbers: c.pageNumbers };

/**
 * Read mode shows a contents page as the pages are laid out in the reader (read-only editors), so the generated list is appended to
 * the page's own document as one paragraph per visible entry: the title, indented one em space pair per level, pages in bold.
 * Page numbers are Typst's and live in the print preview and the PDF; the reader shows the entries only.
 */
export function withContentsList<P extends { id: string; doc: ChapterDoc }>(
  pages: readonly P[],
  contents: BookContents | undefined,
): P[] {
  if (!contents || contents.visible.length === 0) return [...pages];
  const list = contents.visible.map((item) => ({
    type: "paragraph" as const,
    content: [
      {
        type: "text" as const,
        text: `${" ".repeat(item.level * 2)}${item.title}`,
        ...(item.level === 0 ? { marks: [{ type: "bold" as const }] } : {}),
      },
    ],
  }));
  return pages.map((p) =>
    p.id === contents.entryId
      ? { ...p, doc: { ...p.doc, content: [...p.doc.content, ...list] } }
      : p,
  );
}
