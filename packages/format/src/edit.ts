import { BACK_MATTER_KINDS, FRONT_MATTER_KINDS, SINGLE_USE_KINDS, isBackMatterKind, isFrontMatterKind, type MatterKind } from "@cadabracraft/shared";
import { chapterFileName, matterFileName } from "./names";
import type { Manifest, ManuscriptEntry } from "./manifest";

/** Pure manifest edits for the chapter tree. They return a new manifest and never touch disk. */

function uniqueId(m: Manifest): string {
  const used = new Set([...m.frontMatter, ...m.chapters, ...m.backMatter].map((e) => e.id));
  for (let i = m.chapters.length + 1; ; i++) if (!used.has(`ch-${i}`)) return `ch-${i}`;
}

function freeFile(m: Manifest, title: string): string {
  const used = new Set([...m.frontMatter, ...m.chapters, ...m.backMatter].map((e) => e.file));
  for (let pos = m.chapters.length + 1; ; pos++) {
    const f = `manuscript/${chapterFileName(pos, title)}`;
    if (!used.has(f)) return f;
  }
}

export function addChapter(m: Manifest, title: string): { manifest: Manifest; entry: ManuscriptEntry } {
  const entry = { id: uniqueId(m), file: freeFile(m, title), title };
  return { manifest: { ...m, chapters: [...m.chapters, entry] }, entry };
}

/** Renaming changes the title only; the file keeps its name so sync never sees a rename. */
export function renameChapter(m: Manifest, id: string, title: string): Manifest {
  if (!m.chapters.some((c) => c.id === id)) throw new Error(`no chapter ${id}`);
  return { ...m, chapters: m.chapters.map((c) => (c.id === id ? { ...c, title } : c)) };
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

export function removeChapter(m: Manifest, id: string): { manifest: Manifest; removed: ManuscriptEntry } {
  const removed = m.chapters.find((c) => c.id === id);
  if (!removed) throw new Error(`no chapter ${id}`);
  return { manifest: { ...m, chapters: m.chapters.filter((c) => c.id !== id) }, removed };
}

// ---- front and back matter -------------------------------------------------------------------------

type MatterSection = "frontMatter" | "backMatter";

const allEntries = (m: Manifest): ManuscriptEntry[] => [...m.frontMatter, ...m.chapters, ...m.backMatter];

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

function addMatter(m: Manifest, section: MatterSection, kind: MatterKind, title: string): { manifest: Manifest; entry: ManuscriptEntry } {
  const front = section === "frontMatter";
  if (!(front ? isFrontMatterKind(kind) : isBackMatterKind(kind))) throw new Error(`"${kind}" is not a ${front ? "front" : "back"} matter kind`);
  if (!canAddMatter(m, kind)) throw new Error(`The book already has a ${kind} page`);
  const used = allEntries(m);
  const prefix = front ? "fm" : "bm";
  const folder = front ? "front-matter" : "back-matter";
  let n = m[section].length + 1;
  while (used.some((e) => e.id === `${prefix}-${n}`)) n++;
  let pos = m[section].length + 1;
  while (used.some((e) => e.file === `${folder}/${matterFileName(pos, title)}`)) pos++;
  const entry: ManuscriptEntry = { id: `${prefix}-${n}`, file: `${folder}/${matterFileName(pos, title)}`, title, kind };
  const list = [...m[section]];
  // Front matter follows the conventional order (title page, copyright, dedication...); custom pages go last. Back matter is appended.
  const order: readonly MatterKind[] = front ? FRONT_MATTER_KINDS : BACK_MATTER_KINDS;
  const at = front ? list.findIndex((e) => order.indexOf(e.kind ?? "custom") > order.indexOf(kind)) : -1;
  list.splice(at < 0 ? list.length : at, 0, entry);
  return { manifest: { ...m, [section]: list }, entry };
}

export const addFrontMatter = (m: Manifest, kind: MatterKind, title: string) => addMatter(m, "frontMatter", kind, title);
export const addBackMatter = (m: Manifest, kind: MatterKind, title: string) => addMatter(m, "backMatter", kind, title);

function matterSection(m: Manifest, id: string): MatterSection {
  if (m.frontMatter.some((e) => e.id === id)) return "frontMatter";
  if (m.backMatter.some((e) => e.id === id)) return "backMatter";
  throw new Error(`no front or back matter page ${id}`);
}

/** Renaming changes the title only; the file and kind stay. */
export function renameMatter(m: Manifest, id: string, title: string): Manifest {
  const section = matterSection(m, id);
  return { ...m, [section]: m[section].map((e) => (e.id === id ? { ...e, title } : e)) };
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

export function removeMatter(m: Manifest, id: string): { manifest: Manifest; removed: ManuscriptEntry } {
  const section = matterSection(m, id);
  const removed = m[section].find((e) => e.id === id)!;
  return { manifest: { ...m, [section]: m[section].filter((e) => e.id !== id) }, removed };
}

/** Where a restored file goes, from its folder. Null for files outside manuscript, front-matter and back-matter. */
function sectionOfFile(file: string): MatterSection | "chapters" | null {
  const dir = file.split("/")[0];
  return dir === "manuscript" ? "chapters" : dir === "front-matter" ? "frontMatter" : dir === "back-matter" ? "backMatter" : null;
}

/**
 * Puts a restored file back in the manifest: at the end of the section its folder says (chapters, front matter or back
 * matter), under a fresh id. Matter pages come back as "custom" because the kind is not stored in the file.
 */
export function restoreEntry(m: Manifest, file: string, title: string): { manifest: Manifest; entry: ManuscriptEntry } {
  const section = sectionOfFile(file);
  if (!section) throw new Error(`cannot restore ${file}`);
  const used = allEntries(m);
  if (used.some((e) => e.file === file)) throw new Error(`${file} is already in the book`);
  const prefix = section === "chapters" ? "ch" : section === "frontMatter" ? "fm" : "bm";
  let n = m[section].length + 1;
  while (used.some((e) => e.id === `${prefix}-${n}`)) n++;
  const entry: ManuscriptEntry = { id: `${prefix}-${n}`, file, title, ...(section === "chapters" ? {} : { kind: "custom" as MatterKind }) };
  return { manifest: { ...m, [section]: [...m[section], entry] }, entry };
}
