import { t } from "@lingui/core/macro";
import { entryFile, readingOrder } from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import { newSceneId, sceneRows } from "../../lib/scenes";
import {
  insertScene,
  patchScene,
  removeScene,
  reorderScenes,
  sceneIdsOf,
  wrapUnsorted,
} from "../../lib/sceneMoves";
import { parseChapter, PartialWrite } from "./util";
import type { SceneActions } from "./types";
import type { Ctx } from "./context";

/** A chapter of the open edition as the file holds it. */
interface Loaded {
  id: string;
  file: string;
  text: string;
  doc: ChapterDoc;
}

const toText = (doc: ChapterDoc) => JSON.stringify(doc, null, 2);

/**
 * Scene edits that do not need the chapter open: change a scene's notes in any chapter, move a scene within or across
 * chapters, wrap loose text into a scene. They work on the chapter files (read, change the JSON, write through the normal save
 * path), not on the editor, which only holds the one open chapter. Each edit is one book undo step, like Replace all.
 */
export const createSceneActions = (ctx: Ctx): SceneActions => {
  const { set, get, need, langOf, flush, recordDocs, writePages, reloadCurrent } = ctx;
  /** One scene edit runs at a time, so two drops never read the same file and write over each other. */
  let busy: Promise<unknown> = Promise.resolve();

  /** Reads the chapters of the open edition (only `only` when given). The hash of each file is kept, so an outside change is a conflict copy, not an overwrite. */
  const readChapters = async (only?: string): Promise<Loaded[]> => {
    const { root, manifest } = need();
    const lang = langOf(manifest);
    const out: Loaded[] = [];
    const hashes: Record<string, string> = {};
    for (const entry of readingOrder(manifest)) {
      if (only !== undefined && entry.id !== only) continue;
      const file = entryFile(entry, lang);
      if (!file) continue; // not translated yet: no text to hold a scene
      const r = await bridge.readFile(root, file);
      if (!r) continue;
      hashes[file] = r.hash;
      out.push({ id: entry.id, file, text: r.contents, doc: parseChapter(r.contents, file) });
    }
    set({ hashes: { ...get().hashes, ...hashes } });
    return out;
  };

  /** Writes the changed chapters in the order given (a failure puts the written ones back), records one undo step and refreshes the open page. */
  const commit = async (label: string, changes: { before: Loaded; doc: ChapterDoc }[]) => {
    const docs = changes.map((c) => ({
      file: c.before.file,
      before: c.before.text,
      after: toText(c.doc),
    }));
    // A page that could not be put back is reported by `writePages`; its earlier state is also what Undo would restore.
    let conflicts: string[];
    try {
      conflicts = await writePages(
        docs.map((d) => ({ file: d.file, from: d.before, to: d.after })),
      );
    } catch (e) {
      const why = errText(e);
      const stuck = e instanceof PartialWrite ? e.stuck : [];
      if (stuck.length)
        recordDocs(
          label,
          docs.filter((d) => stuck.some((p) => p.file === d.file)),
        );
      await reloadCurrent().catch(() => {});
      throw new Error(
        stuck.length
          ? t`${label} stopped: ${why}. A scene may now be in two chapters; nothing was lost, and Undo finishes the job.`
          : t`${label} stopped: ${why}. Nothing was changed.`,
        { cause: e },
      );
    }
    recordDocs(label, docs);
    const open = get().currentId;
    if (changes.some((c) => c.before.id === open)) await reloadCurrent();
    if (conflicts.length) set({ notice: conflicts.join(". ") });
  };

  /** Runs `task` after the edit before it, and after typing in the open chapter has been written. */
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = busy.then(
      async () => {
        await flush();
        return task();
      },
      async () => {
        await flush();
        return task();
      },
    );
    busy = run.catch(() => {});
    return run;
  };

  return {
    patchSceneIn: (chapterId, sceneId, patch) =>
      exclusive(async () => {
        const [chapter] = await readChapters(chapterId);
        if (!chapter) return false;
        const doc = patchScene(chapter.doc, sceneId, patch);
        if (!doc) return false;
        const title = sceneRows(chapter.doc).find((s) => s.id === sceneId)?.title || t`scene`;
        await commit(t`Edit ${title}`, [{ before: chapter, doc }]);
        return true;
      }),

    moveScene: (sceneId, toChapterId, index) =>
      exclusive(async () => {
        const chapters = await readChapters();
        const from = chapters.find((c) => sceneIdsOf(c.doc).includes(sceneId));
        const to = chapters.find((c) => c.id === toChapterId);
        if (!from || !to) return false;
        const row = sceneRows(from.doc).find((s) => s.id === sceneId)!;
        const label = t`Move ${row.title || t`scene`}`;
        if (from === to) {
          const doc = reorderScenes(from.doc, sceneId, index);
          if (!doc || JSON.stringify(doc) === JSON.stringify(from.doc)) return false;
          await commit(label, [{ before: from, doc }]);
          return true;
        }
        // A scene id already in the destination (a copy left by an earlier failure) would make the drop ambiguous: the copy stays
        // and the move is refused, so the author sorts out which one to keep.
        if (sceneIdsOf(to.doc).includes(sceneId))
          throw new Error(t`The chapter you dropped it in already holds a scene with the same id.`);
        const taken = removeScene(from.doc, sceneId)!;
        // The destination is written first, then the source: a failure in between leaves the scene in both chapters, never in neither.
        await commit(label, [
          { before: to, doc: insertScene(to.doc, taken.scene, index) },
          { before: from, doc: taken.doc },
        ]);
        return true;
      }),

    wrapUnsortedIn: (chapterId) =>
      exclusive(async () => {
        const [chapter] = await readChapters(chapterId);
        if (!chapter) return [];
        const wrapped = wrapUnsorted(chapter.doc, newSceneId);
        if (!wrapped.ids.length) return [];
        await commit(t`Wrap text into a scene`, [{ before: chapter, doc: wrapped.doc }]);
        return wrapped.ids;
      }),
  };
};
