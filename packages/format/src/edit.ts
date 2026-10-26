import { chapterFileName } from "./names";
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
