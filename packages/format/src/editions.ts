import type { Edition, EditionEntry } from "./manifest";
import { FormatError, isSafeRelativePath } from "./errors";

/** The file for one language, or undefined when that language has no translation of the entry yet. */
export const entryFile = (entry: EditionEntry, language: string): string | undefined =>
  entry.files[language];

/** The source edition: the first one. Structure and file paths of the source are the book's own. */
export const sourceEdition = (editions: Edition[]): Edition => editions[0]!;

/** An entry's title in the source language. Validation guarantees it exists. */
export const sourceTitle = (entry: EditionEntry, editions: Edition[]): string =>
  entry.titles[sourceEdition(editions).language]!;

/** An entry's file in the source language. Validation guarantees it exists. */
export const sourceFile = (entry: EditionEntry, editions: Edition[]): string =>
  entry.files[sourceEdition(editions).language]!;

/**
 * Migration step: formatVersion 3 -> 4 (raw object in, raw object out).
 * The source edition takes the v3 top-level metadata. Every entry keeps its v3 file path under the source
 * language, so no chapter file moves. Pure: callers write the result back and keep the backup.
 */
export function migrateV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  const language = String(raw.language);
  const edition: Edition = {
    language,
    title: String(raw.title),
    author: String(raw.author),
    identifier: String(raw.identifier),
    isbn: raw.isbn == null ? null : String(raw.isbn),
    cover: raw.cover == null ? null : String(raw.cover),
  };
  const toEntry = (e: Record<string, unknown>): EditionEntry => {
    const entry: EditionEntry = {
      id: String(e.id),
      titles: { [language]: String(e.title) },
      files: { [language]: String(e.file) },
    };
    if (e.kind !== undefined) entry.kind = e.kind as EditionEntry["kind"];
    return entry;
  };
  const entries = (v: unknown) =>
    Array.isArray(v) ? v.map((e) => toEntry(e as Record<string, unknown>)) : v;
  return {
    formatVersion: 4,
    template: raw.template,
    editions: [edition],
    frontMatter: entries(raw.frontMatter),
    chapters: entries(raw.chapters),
    backMatter: entries(raw.backMatter),
  };
}

/**
 * Checks the editions and entries: unique languages, a source edition, every entry with a source title and file,
 * no title or file for an unknown language, and every path safe. Throws FormatError.
 */
export function validateEditions(editions: Edition[], entries: EditionEntry[]): void {
  if (editions.length === 0) throw new FormatError("manifest: at least one edition is required");
  const langs = new Set<string>();
  for (const e of editions) {
    if (langs.has(e.language)) throw new FormatError(`manifest: duplicate edition "${e.language}"`);
    langs.add(e.language);
  }
  const source = sourceEdition(editions).language;
  for (const entry of entries) {
    if (entry.titles[source] === undefined || entry.files[source] === undefined)
      throw new FormatError(`manifest: entry "${entry.id}" has no ${source} title or file`);
    for (const lang of [...Object.keys(entry.titles), ...Object.keys(entry.files)])
      if (!langs.has(lang))
        throw new FormatError(
          `manifest: entry "${entry.id}" has a title or file for unknown edition "${lang}"`,
        );
    for (const lang of entry.untranslated ?? []) {
      if (!langs.has(lang) || lang === source)
        throw new FormatError(
          `manifest: entry "${entry.id}" marks "${lang}" as untranslated, which is not a translation`,
        );
    }
    for (const file of Object.values(entry.files))
      if (!isSafeRelativePath(file))
        throw new FormatError(`manifest: unsafe path "${file}" in entry "${entry.id}"`);
  }
}

export const LANGUAGE_CODE = /^[A-Za-z0-9-]+$/;

/**
 * Relative path for a new translation of an entry: the source file moved into the language's own folder, e.g.
 * `manuscript/001-a.json` -> `manuscript/fr/001-a.json`. Pure: the caller stores the path and writes the file.
 * Throws FormatError for a language code that is not a plain folder name, or a source path outside the page folders.
 */
export function translationFile(sourceFile: string, language: string): string {
  if (!LANGUAGE_CODE.test(language))
    throw new FormatError(`manifest: bad language code "${language}"`);
  const [folder, name, ...rest] = sourceFile.split("/");
  if (!["manuscript", "front-matter", "back-matter"].includes(folder!) || !name || rest.length > 0)
    throw new FormatError(`manifest: cannot translate "${sourceFile}"`);
  return `${folder}/${language}/${name}`;
}
