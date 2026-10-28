import { FormatError } from "./errors";
import { LANGUAGE_CODE, sourceEdition, sourceFile, translationFile } from "./editions";
import { readingOrder, type Edition, type EditionEntry, type Manifest } from "./manifest";

/** True when the entry's text in `language` is written by a translator (or is the source). Missing files and copies are not translated. */
export const isTranslated = (entry: EditionEntry, language: string, editions: Edition[]): boolean =>
  language === sourceEdition(editions).language ||
  (entry.files[language] !== undefined && !(entry.untranslated ?? []).includes(language));

/** Chapters (not matter) translated in `language` out of all chapters. */
export const translationProgress = (
  m: Manifest,
  language: string,
): { translated: number; total: number } => {
  const chapters = m.chapters;
  return {
    translated: chapters.filter((c) => isTranslated(c, language, m.editions)).length,
    total: chapters.length,
  };
};

/** Marks one entry's text in `language` as translated (the author has written it). Returns the manifest unchanged when it already is. */
export function markTranslated(m: Manifest, id: string, language: string): Manifest {
  const touch = (e: EditionEntry): EditionEntry => {
    const pending = e.untranslated;
    if (e.id !== id || !pending?.includes(language)) return e;
    const rest = pending.filter((l) => l !== language);
    const { untranslated: _drop, ...plain } = e;
    return rest.length ? { ...plain, untranslated: rest } : plain;
  };
  return {
    ...m,
    frontMatter: m.frontMatter.map(touch),
    chapters: m.chapters.map(touch),
    backMatter: m.backMatter.map(touch),
  };
}

/** A file the new edition needs: `from` is the source file to copy, or null for a blank page. */
export interface NewTranslationFile {
  path: string;
  from: string | null;
  /** The page's title in the new edition (the source title until it is translated). */
  title: string;
}

/**
 * Adds an edition to the book. Every entry gets a translation file and is marked untranslated, so the new edition
 * starts as copies of the source (`copy`) or blank pages (`empty`) until the author writes them. Structure is shared.
 * Pure: the caller writes the returned files and saves the manifest.
 */
export function addEdition(
  m: Manifest,
  edition: Edition,
  mode: "copy" | "empty",
): { manifest: Manifest; files: NewTranslationFile[] } {
  const lang = edition.language;
  if (m.editions.some((e) => e.language === lang))
    throw new FormatError(`manifest: edition "${lang}" already exists`);
  const source = sourceEdition(m.editions).language;
  const files: NewTranslationFile[] = [];
  const extend = (e: EditionEntry): EditionEntry => {
    const from = sourceFile(e, m.editions);
    const path = translationFile(from, lang);
    files.push({ path, from: mode === "copy" ? from : null, title: e.titles[source]! });
    return {
      ...e,
      titles: { ...e.titles, [lang]: e.titles[source]! },
      files: { ...e.files, [lang]: path },
      untranslated: [...(e.untranslated ?? []), lang],
    };
  };
  const manifest: Manifest = {
    ...m,
    editions: [...m.editions, edition],
    frontMatter: m.frontMatter.map(extend),
    chapters: m.chapters.map(extend),
    backMatter: m.backMatter.map(extend),
  };
  return { manifest, files };
}

/** Entries that have no file in `language` yet (chapters added after the edition was made). */
export const missingTranslations = (m: Manifest, language: string): EditionEntry[] =>
  readingOrder(m).filter((e) => e.files[language] === undefined);

/** Renames an entry's title in `language` (a translation's title; the source's is changed by `renameChapter` and `renameMatter`). */
export function renameIn(m: Manifest, id: string, language: string, title: string): Manifest {
  const set = (e: EditionEntry): EditionEntry =>
    e.id === id ? { ...e, titles: { ...e.titles, [language]: title } } : e;
  return {
    ...m,
    frontMatter: m.frontMatter.map(set),
    chapters: m.chapters.map(set),
    backMatter: m.backMatter.map(set),
  };
}

/** Points an entry's file for `language` at `path` (used the first time a chapter added after the edition is written). */
export function setTranslationFile(
  m: Manifest,
  id: string,
  language: string,
  path: string,
): Manifest {
  const set = (e: EditionEntry): EditionEntry =>
    e.id === id ? { ...e, files: { ...e.files, [language]: path } } : e;
  return {
    ...m,
    frontMatter: m.frontMatter.map(set),
    chapters: m.chapters.map(set),
    backMatter: m.backMatter.map(set),
  };
}

/** Folder an edition's exports go to: `exports/<lang>`. Throws FormatError for a code that is not a plain folder name. */
export function exportDir(language: string): string {
  if (!LANGUAGE_CODE.test(language))
    throw new FormatError(`manifest: bad language code "${language}"`);
  return `exports/${language}`;
}

/**
 * What an export of `language` contains, in reading order. Entries that are not translated (copies, blank pages, or no
 * file yet) block the export unless `skip` is set, then they are left out and returned in `skipped`. The source
 * edition is always complete. Throws FormatError naming the untranslated entries.
 */
export function exportPlan(
  m: Manifest,
  language: string,
  skip: boolean,
): { included: EditionEntry[]; skipped: EditionEntry[] } {
  if (!m.editions.some((e) => e.language === language))
    throw new FormatError(`manifest: no edition "${language}"`);
  const all = readingOrder(m);
  const included = all.filter((e) => isTranslated(e, language, m.editions));
  const skipped = all.filter((e) => !included.includes(e));
  if (skipped.length && !skip) {
    const names = skipped.map((e) => e.titles[language] ?? sourceTitleOf(e, m)).join(", ");
    throw new FormatError(`not translated into ${language}: ${names}`);
  }
  return { included, skipped };
}

const sourceTitleOf = (e: EditionEntry, m: Manifest): string =>
  e.titles[sourceEdition(m.editions).language] ?? e.id;

/** Changes one edition's details (title, author, identifier, isbn, cover). The language itself is not changed here. */
export function updateEdition(
  m: Manifest,
  language: string,
  patch: Partial<Omit<Edition, "language">>,
): Manifest {
  if (!m.editions.some((e) => e.language === language))
    throw new FormatError(`manifest: no edition "${language}"`);
  return {
    ...m,
    editions: m.editions.map((e) => (e.language === language ? { ...e, ...patch } : e)),
  };
}
