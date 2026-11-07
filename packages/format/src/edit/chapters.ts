import { partFileName } from "../names";
import { unlinkEntry } from "../references";
import type { Manifest, EditionEntry } from "../manifest";
import { allEntries, freeFile, sourceOf, uniqueId, usedFiles } from "./shared";
import { sectionOf } from "./matter";

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

/**
 * Inserts one new chapter per title at `index` of the chapters list (clamped to 0..length), in order. Part dividers are
 * positional, so the chapters join whichever part `index` falls in (right after a divider: that part). File names come
 * from `freeFile`, so they never collide with an existing file, a translation or each other.
 */
export function insertChaptersAt(
  m: Manifest,
  titles: readonly string[],
  index: number,
): { manifest: Manifest; entries: EditionEntry[] } {
  const lang = sourceOf(m);
  const at = Math.min(Math.max(Math.trunc(index), 0), m.chapters.length);
  let manifest = m;
  const entries: EditionEntry[] = [];
  for (const title of titles) {
    const entry: EditionEntry = {
      id: uniqueId(manifest),
      titles: { [lang]: title },
      files: { [lang]: freeFile(manifest, title) },
    };
    const list = [...manifest.chapters];
    list.splice(at + entries.length, 0, entry);
    manifest = { ...manifest, chapters: list };
    entries.push(entry);
  }
  return { manifest, entries };
}

function partEntry(m: Manifest, title: string): EditionEntry {
  const lang = sourceOf(m);
  const used = allEntries(m);
  const files = usedFiles(m);
  let n = 1;
  while (used.some((e) => e.id === `pt-${n}`)) n++;
  let pos = m.chapters.filter((e) => e.kind === "part").length + 1;
  while (files.has(`manuscript/${partFileName(pos, title)}`)) pos++;
  const entry: EditionEntry = {
    id: `pt-${n}`,
    kind: "part",
    titles: { [lang]: title },
    files: { [lang]: `manuscript/${partFileName(pos, title)}` },
  };
  return entry;
}

/**
 * Adds a part divider page to the chapters list (formatVersion 11). It goes after `afterId` when that page is in the chapters list
 * (or after its whole group when `afterId` is itself a part), otherwise at the end. The entries after it join the new part until the
 * next part divider: membership is positional, so no chapter carries a part id.
 */
export function addPart(
  m: Manifest,
  title: string,
  afterId?: string,
): { manifest: Manifest; entry: EditionEntry } {
  const entry = partEntry(m, title);
  const list = [...m.chapters];
  const at = afterId === undefined ? -1 : list.findIndex((e) => e.id === afterId);
  let insert = at < 0 ? list.length : at + 1;
  // A part opened from the list adds the next part after its own group, not between it and its first chapter.
  if (at >= 0 && list[at]?.kind === "part")
    while (insert < list.length && list[insert]?.kind !== "part") insert++;
  list.splice(insert, 0, entry);
  return { manifest: { ...m, chapters: list }, entry };
}

/** Adds a part divider before `beforeId`, so that page and the entries after it join the new part. Missing: at the end. */
export function addPartBefore(
  m: Manifest,
  title: string,
  beforeId?: string,
): { manifest: Manifest; entry: EditionEntry } {
  const entry = partEntry(m, title);
  const list = [...m.chapters];
  const at = beforeId === undefined ? -1 : list.findIndex((e) => e.id === beforeId);
  list.splice(at < 0 ? list.length : at, 0, entry);
  return { manifest: { ...m, chapters: list }, entry };
}

/** A part and the entries that belong to it: everything up to the next part divider. `part` is absent for chapters before the first part. */
export interface PartGroup {
  part?: EditionEntry;
  entries: EditionEntry[];
}

/** The chapters list as the sidebar shows it: ungrouped entries first, then one group per part. Empty ungrouped groups are left out. */
export function partGroups(chapters: readonly EditionEntry[]): PartGroup[] {
  const groups: PartGroup[] = [{ entries: [] }];
  for (const entry of chapters) {
    if (entry.kind === "part") groups.push({ part: entry, entries: [] });
    else groups[groups.length - 1]!.entries.push(entry);
  }
  return groups.filter((g) => g.part !== undefined || g.entries.length > 0);
}

/** The start and end (exclusive) of a part's block in the chapters list, or null when `id` is not a part. */
function partBlock(m: Manifest, id: string): { start: number; end: number } | null {
  const start = m.chapters.findIndex((e) => e.id === id);
  if (start < 0 || m.chapters[start]!.kind !== "part") return null;
  let end = start + 1;
  while (end < m.chapters.length && m.chapters[end]!.kind !== "part") end++;
  return { start, end };
}

/**
 * Moves a part and its chapters past the previous (`delta < 0`) or next part, clamped to the first and last part. Moving a part past
 * the chapters before the first part would put them inside it, so that move is a no-op.
 */
export function movePart(m: Manifest, id: string, delta: number): Manifest {
  const block = partBlock(m, id);
  if (!block || delta === 0) return m;
  const list = [...m.chapters];
  if (delta < 0) {
    const prev = list
      .slice(0, block.start)
      .map((e) => e.kind === "part")
      .lastIndexOf(true);
    if (prev < 0) return m;
    const before = list.slice(0, prev);
    const current = list.slice(block.start, block.end);
    const previous = list.slice(prev, block.start);
    return { ...m, chapters: [...before, ...current, ...previous, ...list.slice(block.end)] };
  }
  if (block.end >= list.length) return m;
  let nextEnd = block.end + 1;
  while (nextEnd < list.length && list[nextEnd]!.kind !== "part") nextEnd++;
  return {
    ...m,
    chapters: [
      ...list.slice(0, block.start),
      ...list.slice(block.end, nextEnd),
      ...list.slice(block.start, block.end),
      ...list.slice(nextEnd),
    ],
  };
}

/** Removes only the part divider; its chapters stay in the book, joining the previous part or becoming ungrouped. */
export function removePart(m: Manifest, id: string): { manifest: Manifest; removed: EditionEntry } {
  const removed = m.chapters.find((c) => c.id === id && c.kind === "part");
  if (!removed) throw new Error(`no part ${id}`);
  return {
    manifest: unlinkEntry({ ...m, chapters: m.chapters.filter((c) => c.id !== id) }, id),
    removed,
  };
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
  const entry = m.chapters.find((c) => c.id === id);
  if (!entry || entry.kind === "part") throw new Error(`no chapter ${id}`);
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

/**
 * Sets or clears (`null` follows the book's rules) a front or back matter page's start: on the next page, even when that is a left-hand
 * page (`true`), or where the page numbering puts it, a blank left-hand page before it included (`null`).
 */
export function setMatterStartOnNext(
  m: Manifest,
  id: string,
  startOnNext: boolean | null,
): Manifest {
  const entry = [...m.frontMatter, ...m.backMatter].find((e) => e.id === id);
  if (!entry) throw new Error(`no front or back matter page ${id}`);
  const set = (list: EditionEntry[]) =>
    list.map((e) => {
      if (e.id !== id) return e;
      const { startOnNext: _old, ...rest } = e;
      return startOnNext === null ? rest : { ...rest, startOnNext };
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
