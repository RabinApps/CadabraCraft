import {
  BACK_MATTER_KINDS,
  FRONT_MATTER_KINDS,
  SINGLE_USE_KINDS,
  isBackMatterKind,
  isFrontMatterKind,
  type MatterKind,
} from "@cadabracraft/shared";
import { chapterFileName, matterFileName } from "../names";
import { unlinkEntry } from "../references";
import { defaultGlossarySettings } from "../book/glossarySettings";
import { defaultIndexSettings } from "../book/indexSettings";
import type { Manifest, EditionEntry } from "../manifest";
import { allEntries, sourceOf, usedFiles } from "./shared";

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

/**
 * Adds a page to a section. Front matter follows the conventional kind order; a blank page instead goes straight after `afterId`
 * (the page that was open), because its whole point is a place between two particular pages.
 */
function addMatter(
  m: Manifest,
  section: MatterSection,
  kind: MatterKind,
  title: string,
  afterId?: string,
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
  const after =
    kind === "blank" && afterId !== undefined ? list.findIndex((e) => e.id === afterId) : -1;
  const at =
    after >= 0
      ? after + 1
      : front
        ? list.findIndex(
            (e) =>
              order.indexOf(e.kind === "part" ? "custom" : (e.kind ?? "custom")) >
              order.indexOf(kind),
          )
        : -1;
  list.splice(at < 0 ? list.length : at, 0, entry);
  // The index and glossary pages hold the generated list, so adding one switches that list on.
  const on: Partial<Manifest> =
    kind === "index"
      ? { index: { ...(m.index ?? defaultIndexSettings()), enabled: true } }
      : kind === "glossary"
        ? { glossary: { ...(m.glossary ?? defaultGlossarySettings()), enabled: true } }
        : {};
  return { manifest: { ...m, ...on, [section]: list }, entry };
}

/**
 * Adds a blank page after `afterId`, in whichever part of the book that page is in (front matter, chapters or back matter): a blank
 * page belongs wherever the author put it, and with no open page it goes at the end of the chapters.
 */
export function addBlank(
  m: Manifest,
  afterId: string | undefined,
  title: string,
): { manifest: Manifest; entry: EditionEntry } {
  const section = afterId ? sectionOf(m, afterId) : "chapter";
  if (section === "chapter") {
    const lang = sourceOf(m);
    const used = allEntries(m);
    const files = usedFiles(m);
    let n = m.chapters.length + 1;
    while (used.some((e) => e.id === `ch-${n}`)) n++;
    let pos = m.chapters.length + 1;
    while (files.has(`manuscript/${chapterFileName(pos, title)}`)) pos++;
    const entry: EditionEntry = {
      id: `ch-${n}`,
      kind: "blank",
      titles: { [lang]: title },
      files: { [lang]: `manuscript/${chapterFileName(pos, title)}` },
    };
    const list = [...m.chapters];
    const after = afterId === undefined ? -1 : list.findIndex((e) => e.id === afterId);
    list.splice(after < 0 ? list.length : after + 1, 0, entry);
    return { manifest: { ...m, chapters: list }, entry };
  }
  return addMatter(m, section === "front" ? "frontMatter" : "backMatter", "blank", title, afterId);
}

export const addFrontMatter = (m: Manifest, kind: MatterKind, title: string, afterId?: string) =>
  addMatter(m, "frontMatter", kind, title, afterId);
export const addBackMatter = (m: Manifest, kind: MatterKind, title: string, afterId?: string) =>
  addMatter(m, "backMatter", kind, title, afterId);

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

/** A part page file, in the source folder or a language folder: chapter file names always start with a number. */
const isPartFile = (file: string): boolean =>
  /^manuscript\/(?:[^/]+\/)?part-[^/]+\.json$/.test(file);

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
    ...(section === "chapters"
      ? isPartFile(file)
        ? { kind: "part" as const }
        : {}
      : { kind: "custom" as MatterKind }),
  };
  const marked = translations.filter((x) => x.untranslated).map((x) => x.language);
  if (marked.length) entry.untranslated = marked;
  return { manifest: { ...m, [section]: [...m[section], entry] }, entry };
}
