import {
  BACK_MATTER_KINDS,
  FRONT_MATTER_KINDS,
  SINGLE_USE_KINDS,
  isBackMatterKind,
  isFrontMatterKind,
  type MatterKind,
} from "@cadabracraft/shared";
import { chapterFileName, matterFileName } from "./names";
import { sourceEdition } from "./editions";
import { unlinkEntry } from "./references";
import type { Manifest, EditionEntry } from "./manifest";

/**
 * Pure manifest edits for the chapter tree. They return a new manifest and never touch disk.
 * Structure (ids, order, kinds, file names) is shared by every edition; titles and files are set for the source
 * language here, and translations are added elsewhere.
 */

/** The source language: where new titles and file names are written. */
const sourceOf = (m: Manifest): string => sourceEdition(m.editions).language;

const allEntries = (m: Manifest): EditionEntry[] => [
  ...m.frontMatter,
  ...m.chapters,
  ...m.backMatter,
];

/** Every file of every entry in every edition, so a new file never collides with a translation. */
const usedFiles = (m: Manifest): Set<string> =>
  new Set(allEntries(m).flatMap((e) => Object.values(e.files)));

function uniqueId(m: Manifest): string {
  const used = new Set(allEntries(m).map((e) => e.id));
  for (let i = m.chapters.length + 1; ; i++) if (!used.has(`ch-${i}`)) return `ch-${i}`;
}

function freeFile(m: Manifest, title: string): string {
  const used = usedFiles(m);
  for (let pos = m.chapters.length + 1; ; pos++) {
    const f = `manuscript/${chapterFileName(pos, title)}`;
    if (!used.has(f)) return f;
  }
}

export function addChapter(
  m: Manifest,
  title: string,
): { manifest: Manifest; entry: EditionEntry } {
  const lang = sourceOf(m);
  const entry: EditionEntry = {
    id: uniqueId(m),
    titles: { [lang]: title },
    files: { [lang]: freeFile(m, title) },
  };
  return { manifest: { ...m, chapters: [...m.chapters, entry] }, entry };
}

/** Renaming changes the source title only; the file keeps its name so sync never sees a rename. */
export function renameChapter(m: Manifest, id: string, title: string): Manifest {
  if (!m.chapters.some((c) => c.id === id)) throw new Error(`no chapter ${id}`);
  const lang = sourceOf(m);
  return {
    ...m,
    chapters: m.chapters.map((c) =>
      c.id === id ? { ...c, titles: { ...c.titles, [lang]: title } } : c,
    ),
  };
}

/** Sets or clears (`null`) the sidebar icon of a chapter, front matter page or back matter page. */
export function setEntryIcon(m: Manifest, id: string, icon: string | null): Manifest {
  if (!sectionOf(m, id)) throw new Error(`no page ${id}`);
  const set = (list: EditionEntry[]) =>
    list.map((e) => {
      if (e.id !== id) return e;
      const { icon: _old, ...rest } = e;
      return icon === null ? rest : { ...rest, icon };
    });
  return {
    ...m,
    frontMatter: set(m.frontMatter),
    chapters: set(m.chapters),
    backMatter: set(m.backMatter),
  };
}

/** Sets or clears (`null` follows the book) a chapter's own big-first-letter choice. */
export function setChapterDropCap(m: Manifest, id: string, dropCap: boolean | null): Manifest {
  if (!m.chapters.some((c) => c.id === id)) throw new Error(`no chapter ${id}`);
  return {
    ...m,
    chapters: m.chapters.map((c) => {
      if (c.id !== id) return c;
      const { dropCap: _old, ...rest } = c;
      return dropCap === null ? rest : { ...rest, dropCap };
    }),
  };
}

/** Sets or clears (`null` follows the template) a front or back matter page's own vertical position choice: centred (`true`) or at the top (`false`). */
export function setMatterVerticalCenter(
  m: Manifest,
  id: string,
  verticalCenter: boolean | null,
): Manifest {
  const entry = [...m.frontMatter, ...m.backMatter].find((e) => e.id === id);
  if (!entry) throw new Error(`no front or back matter page ${id}`);
  if (entry.kind === "contents" || entry.kind === "copyright")
    throw new Error(`page ${id} has a layout of its own and is never centred`);
  const set = (list: EditionEntry[]) =>
    list.map((e) => {
      if (e.id !== id) return e;
      const { verticalCenter: _old, ...rest } = e;
      return verticalCenter === null ? rest : { ...rest, verticalCenter };
    });
  return { ...m, frontMatter: set(m.frontMatter), backMatter: set(m.backMatter) };
}

/** Moves a chapter by `delta` positions, clamped to the list. Order lives in the manifest, not in file names. */
export function moveChapter(m: Manifest, id: string, delta: number): Manifest {
  const from = m.chapters.findIndex((c) => c.id === id);
  if (from < 0) throw new Error(`no chapter ${id}`);
  const to = Math.min(m.chapters.length - 1, Math.max(0, from + delta));
  const list = [...m.chapters];
  const [c] = list.splice(from, 1);
  list.splice(to, 0, c!);
  return { ...m, chapters: list };
}

export function removeChapter(
  m: Manifest,
  id: string,
): { manifest: Manifest; removed: EditionEntry } {
  const removed = m.chapters.find((c) => c.id === id);
  if (!removed) throw new Error(`no chapter ${id}`);
  return {
    manifest: unlinkEntry({ ...m, chapters: m.chapters.filter((c) => c.id !== id) }, id),
    removed,
  };
}

// ---- front and back matter -------------------------------------------------------------------------

type MatterSection = "frontMatter" | "backMatter";

/** Which list holds `id`: "front", "chapter", "back", or null when it does not exist. */
export function sectionOf(m: Manifest, id: string): "front" | "chapter" | "back" | null {
  if (m.frontMatter.some((e) => e.id === id)) return "front";
  if (m.chapters.some((e) => e.id === id)) return "chapter";
  if (m.backMatter.some((e) => e.id === id)) return "back";
  return null;
}

/** False when `kind` is limited to one page and the book already has it (title page, copyright), or is not a matter kind. */
export function canAddMatter(m: Manifest, kind: MatterKind): boolean {
  if (!SINGLE_USE_KINDS.includes(kind)) return true;
  return ![...m.frontMatter, ...m.backMatter].some((e) => e.kind === kind);
}

function addMatter(
  m: Manifest,
  section: MatterSection,
  kind: MatterKind,
  title: string,
): { manifest: Manifest; entry: EditionEntry } {
  const front = section === "frontMatter";
  if (!(front ? isFrontMatterKind(kind) : isBackMatterKind(kind)))
    throw new Error(`"${kind}" is not a ${front ? "front" : "back"} matter kind`);
  if (!canAddMatter(m, kind)) throw new Error(`The book already has a ${kind} page`);
  const used = allEntries(m);
  const files = usedFiles(m);
  const lang = sourceOf(m);
  const prefix = front ? "fm" : "bm";
  const folder = front ? "front-matter" : "back-matter";
  let n = m[section].length + 1;
  while (used.some((e) => e.id === `${prefix}-${n}`)) n++;
  let pos = m[section].length + 1;
  while (files.has(`${folder}/${matterFileName(pos, title)}`)) pos++;
  const entry: EditionEntry = {
    id: `${prefix}-${n}`,
    kind,
    titles: { [lang]: title },
    files: { [lang]: `${folder}/${matterFileName(pos, title)}` },
  };
  const list = [...m[section]];
  // Front matter follows the conventional order (title page, copyright, dedication...); custom pages go last. Back matter is appended.
  const order: readonly MatterKind[] = front ? FRONT_MATTER_KINDS : BACK_MATTER_KINDS;
  const at = front
    ? list.findIndex((e) => order.indexOf(e.kind ?? "custom") > order.indexOf(kind))
    : -1;
  list.splice(at < 0 ? list.length : at, 0, entry);
  return { manifest: { ...m, [section]: list }, entry };
}

export const addFrontMatter = (m: Manifest, kind: MatterKind, title: string) =>
  addMatter(m, "frontMatter", kind, title);
export const addBackMatter = (m: Manifest, kind: MatterKind, title: string) =>
  addMatter(m, "backMatter", kind, title);

function matterSection(m: Manifest, id: string): MatterSection {
  if (m.frontMatter.some((e) => e.id === id)) return "frontMatter";
  if (m.backMatter.some((e) => e.id === id)) return "backMatter";
  throw new Error(`no front or back matter page ${id}`);
}

/** Renaming changes the source title only; the file and kind stay. */
export function renameMatter(m: Manifest, id: string, title: string): Manifest {
  const section = matterSection(m, id);
  const lang = sourceOf(m);
  return {
    ...m,
    [section]: m[section].map((e) =>
      e.id === id ? { ...e, titles: { ...e.titles, [lang]: title } } : e,
    ),
  };
}

/** Moves a page by `delta` positions inside its own section, clamped to the list. */
export function moveMatter(m: Manifest, id: string, delta: number): Manifest {
  const section = matterSection(m, id);
  const list = [...m[section]];
  const from = list.findIndex((e) => e.id === id);
  const to = Math.min(list.length - 1, Math.max(0, from + delta));
  const [e] = list.splice(from, 1);
  list.splice(to, 0, e!);
  return { ...m, [section]: list };
}

export function removeMatter(
  m: Manifest,
  id: string,
): { manifest: Manifest; removed: EditionEntry } {
  const section = matterSection(m, id);
  const removed = m[section].find((e) => e.id === id)!;
  return {
    manifest: unlinkEntry({ ...m, [section]: m[section].filter((e) => e.id !== id) }, id),
    removed,
  };
}

/** Where a restored file goes, from its folder. Null for files outside manuscript, front-matter and back-matter. */
function sectionOfFile(file: string): MatterSection | "chapters" | null {
  const dir = file.split("/")[0];
  return dir === "manuscript"
    ? "chapters"
    : dir === "front-matter"
      ? "frontMatter"
      : dir === "back-matter"
        ? "backMatter"
        : null;
}

/**
 * Puts a restored source file back in the manifest: at the end of the section its folder says (chapters, front matter or
 * back matter), under a fresh id. Matter pages come back as "custom" because the kind is not stored in the file.
 * `translations` are the entry's files in other languages that came back with it.
 */
export function restoreEntry(
  m: Manifest,
  file: string,
  title: string,
  translations: { language: string; file: string; title: string; untranslated?: boolean }[] = [],
): { manifest: Manifest; entry: EditionEntry } {
  const section = sectionOfFile(file);
  if (!section) throw new Error(`cannot restore ${file}`);
  const taken = usedFiles(m);
  if ([file, ...translations.map((x) => x.file)].some((f) => taken.has(f)))
    throw new Error(`${file} is already in the book`);
  const used = allEntries(m);
  const lang = sourceOf(m);
  const prefix = section === "chapters" ? "ch" : section === "frontMatter" ? "fm" : "bm";
  let n = m[section].length + 1;
  while (used.some((e) => e.id === `${prefix}-${n}`)) n++;
  const entry: EditionEntry = {
    id: `${prefix}-${n}`,
    titles: {
      [lang]: title,
      ...Object.fromEntries(translations.map((x) => [x.language, x.title])),
    },
    files: { [lang]: file, ...Object.fromEntries(translations.map((x) => [x.language, x.file])) },
    ...(section === "chapters" ? {} : { kind: "custom" as MatterKind }),
  };
  const marked = translations.filter((x) => x.untranslated).map((x) => x.language);
  if (marked.length) entry.untranslated = marked;
  return { manifest: { ...m, [section]: [...m[section], entry] }, entry };
}

// ---- history snapshots -----------------------------------------------------------------------------

/** The part of the manifest that chapter-tree edits change. Undo restores this and nothing else (editions, template... stay). */
export interface Tree {
  frontMatter: EditionEntry[];
  chapters: EditionEntry[];
  backMatter: EditionEntry[];
}

export const treeOf = (m: Manifest): Tree => ({
  frontMatter: m.frontMatter,
  chapters: m.chapters,
  backMatter: m.backMatter,
});

export const withTree = (m: Manifest, tree: Tree): Manifest => ({ ...m, ...tree });

export const sameTree = (a: Tree, b: Tree): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Points the entry whose `language` file is `from` at `to` (a restored file that had to take another name).
 * Restored files are source files, so callers pass the source language.
 */
export function retargetFile(tree: Tree, language: string, from: string, to: string): Tree {
  const fix = (list: EditionEntry[]) =>
    list.map((e) =>
      e.files[language] === from ? { ...e, files: { ...e.files, [language]: to } } : e,
    );
  return {
    frontMatter: fix(tree.frontMatter),
    chapters: fix(tree.chapters),
    backMatter: fix(tree.backMatter),
  };
}
