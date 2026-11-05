import { chapterFileName } from "../names";
import { sourceEdition } from "../editions";
import { chaptersOf, type Manifest, type EditionEntry } from "../manifest";

/**
 * Pure manifest edits for the chapter tree. They return a new manifest and never touch disk.
 * Structure (ids, order, kinds, file names) is shared by every edition; titles and files are set for the source
 * language here, and translations are added elsewhere.
 */

/** The source language: where new titles and file names are written. */
export const sourceOf = (m: Manifest): string => sourceEdition(m.editions).language;

export const allEntries = (m: Manifest): EditionEntry[] => [
  ...m.frontMatter,
  ...m.chapters,
  ...m.backMatter,
];

/** Every file of every entry in every edition, so a new file never collides with a translation. */
export const usedFiles = (m: Manifest): Set<string> =>
  new Set(allEntries(m).flatMap((e) => Object.values(e.files)));

export function uniqueId(m: Manifest): string {
  const used = new Set(allEntries(m).map((e) => e.id));
  for (let i = chaptersOf(m).length + 1; ; i++) if (!used.has(`ch-${i}`)) return `ch-${i}`;
}

export function freeFile(m: Manifest, title: string): string {
  const used = usedFiles(m);
  for (let pos = chaptersOf(m).length + 1; ; pos++) {
    const f = `manuscript/${chapterFileName(pos, title)}`;
    if (!used.has(f)) return f;
  }
}
