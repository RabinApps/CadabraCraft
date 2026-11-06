import type { SceneRow } from "./scenes";

/** One chapter of the board: its scenes in order, and the words that sit outside every scene. */
export interface BoardChapter {
  id: string;
  title: string;
  rows: SceneRow[];
  unsortedWords: number;
  /** False until the chapter's file has been read. */
  loaded: boolean;
}

export interface BoardData {
  chapters: BoardChapter[];
  /** Ids that appear in more than one place (a failed move can leave a scene in two chapters): only the first card is shown. */
  duplicates: string[];
}

/** What is read from one chapter's file. */
export interface ChapterRead {
  rows: SceneRow[];
  unsorted: number;
}

/**
 * The board from the chapters (in book order), their titles and what has been read of each file so far. A chapter whose file has
 * not been read yet is shown as not loaded; a scene id that turns up again after its first card is left out and listed in
 * `duplicates`, so two cards never share a key or a drag.
 */
export function buildBoard(
  chapters: readonly { id: string }[],
  titles: ReadonlyMap<string, string>,
  read: Readonly<Record<string, ChapterRead | undefined>>,
): BoardData {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const out = chapters.map((e): BoardChapter => {
    const r = read[e.id];
    const rows = (r?.rows ?? []).filter((s) => {
      if (seen.has(s.id)) {
        duplicates.push(s.id);
        return false;
      }
      seen.add(s.id);
      return true;
    });
    return {
      id: e.id,
      title: titles.get(e.id) ?? "",
      rows,
      unsortedWords: r?.unsorted ?? 0,
      loaded: r !== undefined,
    };
  });
  return { chapters: out, duplicates };
}
