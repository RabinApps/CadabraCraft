import { useMemo } from "react";
import { chaptersOf, entryFile, entryRowsIn } from "@cadabracraft/format";
import {
  buildBoard,
  type BoardChapter,
  type BoardData,
  type ChapterRead,
} from "../../lib/scenes/boardData";
import { sceneRows } from "../../lib/scenes/scenes";
import { unsortedWords } from "../../lib/scenes/sceneMoves";
import { useProject } from "../../state/project/index";
import { useChapterReads } from "../scenes/useChapterScenes";

export type { BoardChapter, BoardData };

const derive = (doc: unknown): ChapterRead => ({
  rows: sceneRows(doc),
  unsorted: unsortedWords(doc),
});

/**
 * The board's data: every chapter of the open edition with its scenes, read from the chapter files (the open chapter too: the
 * board is shown with the editor closed, after typing was saved) and read again whenever a chapter file changes. Built on the
 * same reader as the sidebar's scenes. Pass `enabled: false` until pending typing has been written.
 */
export function useBoardData(enabled = true): BoardData {
  const manifest = useProject((s) => s.manifest);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const hashes = useProject((s) => s.hashes);
  const entries = useMemo(() => (manifest ? chaptersOf(manifest) : []), [manifest]);
  const titles = useMemo(
    () =>
      manifest
        ? new Map(entryRowsIn(entries, manifest.editions, language).map((r) => [r.id, r.title]))
        : new Map<string, string>(),
    [manifest, entries, language],
  );
  const ids = useMemo(() => (enabled ? entries.map((e) => e.id) : []), [enabled, entries]);
  // A new hash on any chapter file means the chapter changed (an edit, a move, an undo): read it again.
  const version = entries.map((e) => hashes[entryFile(e, language) ?? ""] ?? "").join("|");
  const read = useChapterReads(ids, derive, version);
  return useMemo(() => buildBoard(entries, titles, read), [entries, read, titles]);
}
