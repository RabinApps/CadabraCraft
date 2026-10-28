import { sourceFile, sourceTitle } from "./editions";
import { isTranslated } from "./translations";
import { readingOrder, type Edition, type EditionEntry, type Manifest } from "./manifest";

/** The entry with `id` in reading order, or undefined. */
const entryWithId = (m: Manifest, id: string): EditionEntry | undefined =>
  readingOrder(m).find((e) => e.id === id);

/** Source-language file of the entry with `id`, or undefined when no entry has that id. */
export const sourceFileById = (m: Manifest, id: string): string | undefined => {
  const e = entryWithId(m, id);
  return e ? sourceFile(e, m.editions) : undefined;
};

/** Source-language title of the entry with `id`, or undefined when no entry has that id. */
export const sourceTitleById = (m: Manifest, id: string): string | undefined => {
  const e = entryWithId(m, id);
  return e ? sourceTitle(e, m.editions) : undefined;
};

/** A list row in the source language: what a page list shows and what it opens. */
export interface EntryRow {
  id: string;
  title: string;
  file: string;
}

/** `{ id, title, file }` rows in the source language, for lists of one section of the book. */
export const entryRows = (entries: EditionEntry[], editions: Edition[]): EntryRow[] =>
  entries.map((e) => ({
    id: e.id,
    title: sourceTitle(e, editions),
    file: sourceFile(e, editions),
  }));

/** A list row in one language: its title (the source's when not translated yet) and whether the text is translated. */
export interface LanguageRow extends EntryRow {
  translated: boolean;
}

/** `{ id, title, file, translated }` rows for `language`. `file` is the source's when the language has no file yet. */
export const entryRowsIn = (
  entries: EditionEntry[],
  editions: Edition[],
  language: string,
): LanguageRow[] =>
  entries.map((e) => ({
    id: e.id,
    title: e.titles[language] ?? sourceTitle(e, editions),
    file: e.files[language] ?? sourceFile(e, editions),
    translated: isTranslated(e, language, editions),
  }));
