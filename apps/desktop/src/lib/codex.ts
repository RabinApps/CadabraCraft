import type { CodexEntry } from "@cadabracraft/format";
import type { SceneRow } from "./scenes";

/** One chapter and its scenes, as the codex looks through the book. */
export interface ChapterScenes {
  id: string;
  title: string;
  scenes: SceneRow[];
}

/** A place where an entry is named: a scene of a chapter. */
export interface Appearance {
  chapterId: string;
  chapter: string;
  sceneId: string;
  scene: string;
}

/** A new entry's id, the same shape as a page id and as a scene's cast entry. */
export const newCodexId = (): string => `cd-${crypto.randomUUID().slice(0, 8)}`;

/**
 * The scenes that name an entry, in book order. A cast names an entry by its id; the POV is free text, so it counts when it
 * is the entry's id, its name or one of its aliases (a book written before it had a codex keeps its POV text).
 */
export function appearsIn(entry: CodexEntry | null, chapters: ChapterScenes[]): Appearance[] {
  if (!entry) return [];
  const names = new Set(
    [entry.id, entry.name, ...entry.aliases].map((n) => n.trim().toLowerCase()),
  );
  const out: Appearance[] = [];
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      const pov = scene.pov.trim().toLowerCase();
      if (scene.cast.includes(entry.id) || (pov !== "" && names.has(pov)))
        out.push({
          chapterId: chapter.id,
          chapter: chapter.title,
          sceneId: scene.id,
          scene: scene.title,
        });
    }
  }
  return out;
}
