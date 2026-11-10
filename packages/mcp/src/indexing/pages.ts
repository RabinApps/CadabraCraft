// Reads the pages of one edition for the index and glossary tools and writes changed ones back with the chapter tools' safety
// (validated first, previous text kept under .cadabra/backups/).
import { entryFile, readingOrder, sourceTitle, type Manifest } from "@cadabracraft/format";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import type { ChapterDoc } from "@cadabracraft/shared";
import { schemaProblem } from "../doc";
import { ToolError } from "../errors";
import { readChapterFile } from "../project";
import { replaceChapter } from "../tools/chapters";

export interface Page {
  id: string;
  title: string;
  file: string;
  doc: ChapterDoc;
  /** Hash of the file as read: the base for the write, so an outside change is kept as a conflict copy. */
  hash: string;
}

/** Every page of the edition in reading order that has text in it (a translation not started yet has none). */
export function readPages(root: string, manifest: Manifest, language: string): Page[] {
  const pages: Page[] = [];
  for (const e of readingOrder(manifest)) {
    const file = entryFile(e, language);
    if (!file) continue;
    const { doc, hash } = readChapterFile(root, file);
    if (!isChapterDoc(doc))
      throw new ToolError(
        "invalid_chapter_doc",
        `${file} is not valid in the editor schema: ${schemaProblem(doc)}`,
      );
    pages.push({
      id: e.id,
      title: e.titles[language] ?? sourceTitle(e, manifest.editions),
      file,
      doc,
      hash,
    });
  }
  return pages;
}

export interface Edit {
  page: Page;
  doc: ChapterDoc;
}

export interface Saved {
  chapterId: string;
  file: string;
  hash: string;
  backup: string | null;
  conflictCopy: string | null;
}

/** Writes the edited pages. Every document is checked against the editor schema before the first file is written. */
export function savePages(root: string, edits: Edit[]): Saved[] {
  for (const { page, doc } of edits) {
    const problem = schemaProblem(doc);
    if (problem)
      throw new ToolError(
        "invalid_chapter_doc",
        `the edited ${page.id} is not valid in the editor schema: ${problem}`,
      );
  }
  return edits.map(({ page, doc }) => {
    const w = replaceChapter(root, page.file, doc, page.hash);
    return {
      chapterId: page.id,
      file: page.file,
      hash: w.hash,
      backup: w.backup,
      conflictCopy: w.conflictCopy,
    };
  });
}
