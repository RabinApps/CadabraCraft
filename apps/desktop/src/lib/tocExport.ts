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
 * out of this export, e.g. untranslated). Only the pages in `pages` are listed, with their headings from their documents in
 * `language`, so the list always matches what is exported.
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
  const exported = new Set(pages.map((p) => p.id));
  // The manifest's reading order lists every chapter; one that is not in this export (untranslated, skipped) has nothing to link to.
  // Custom entries and the author's overrides stay: a custom entry that points at a left-out page loses the link, not its text.
  const all = resolveToc(manifest, entry, language, outlines).flatMap((item): TocItem[] => {
    if (item.kind !== "custom")
      return item.entryId !== undefined && exported.has(item.entryId) ? [item] : [];
    if (item.entryId === undefined || exported.has(item.entryId)) return [item];
    const { entryId: _gone, ...rest } = item;
    return [rest];
  });
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

/** An em space: unlike an ordinary space, HTML keeps leading ones, so the indent shows without a new node or style. */
const EM_SPACE = "\u2003";

/**
 * Read mode shows a contents page as the pages are laid out in the reader (read-only editors), so the generated list is appended to
 * the page's own document as one paragraph per visible entry: the title indented by two em spaces per level (text only: the editor
 * schema is the exporters' contract, so there is no indent node), top-level entries in bold. This is the Read-mode view only: no
 * exporter sees it. Page numbers are Typst's and live in the print preview and the PDF; the reader shows the entries only.
 */
export function withContentsList<P extends { id: string; doc: ChapterDoc }>(
  pages: readonly P[],
  contents: BookContents | undefined,
): readonly P[] {
  // Nothing to add: hand back the same array. The reader keeps its scroll state against what it was given, so a new array with the
  // same pages (a book without a contents page, rebuilt whenever the manifest object changes) must not reach it.
  if (!contents || contents.visible.length === 0) return pages;
  const list = contents.visible.map((item) => ({
    type: "paragraph" as const,
    content: [
      {
        type: "text" as const,
        text: `${EM_SPACE.repeat(item.level * 2)}${item.title}`,
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
