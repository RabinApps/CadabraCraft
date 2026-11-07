import { isChapterDoc } from "@cadabracraft/editor-schema";
import { countWords, type ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../../lib/bridge";
import { changeSummary, diffChapters, paragraphsOf, type DiffLine } from "../../../lib/wordDiff";

/** A chapter file's text as a document, or null when it is missing, not JSON or not a valid chapter. */
export function parseDoc(contents: string | undefined): ChapterDoc | null {
  if (contents === undefined) return null;
  try {
    const raw: unknown = JSON.parse(contents);
    return isChapterDoc(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** One earlier text of a chapter compared with the current paragraphs. */
export interface Compared {
  /** Null when the earlier text could not be read or is not a valid chapter. */
  words: number | null;
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Compares an earlier text (file contents) with the current paragraphs: words only, formatting is not compared. */
export function compareWithCurrent(current: string[], contents: string | undefined): Compared {
  const doc = parseDoc(contents);
  const lines = doc ? diffChapters(current, paragraphsOf(doc)) : [];
  const { added, removed } = changeSummary(lines);
  return { words: doc ? countWords(doc) : null, lines, added, removed };
}

/** The saved current text of `file` as paragraphs; `null` when the file is not in the book now. */
export async function readCurrentParagraphs(root: string, file: string): Promise<string[] | null> {
  const now = await bridge.readFile(root, file);
  return now ? paragraphsOf(parseDoc(now.contents)) : null;
}
