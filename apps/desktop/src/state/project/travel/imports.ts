import { t } from "@lingui/core/macro";
import { retargetFile, sourceEdition, withTree } from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { retargetEntry } from "../util";
import type { HistoryEntry } from "../types";
import type { Ctx } from "../context";
import { createShowAfterTravel, doneNotice, flipHistory, type Direction } from "./shared";

type Imported = NonNullable<HistoryEntry["imported"]>;

/**
 * Undo and redo of an import into the open book (one step for all its chapters). Undo saves the manifest without the new
 * chapters FIRST and then moves their files to the trash; redo brings the files back first and then saves the manifest
 * with them, so the manifest never names a missing file. A file that comes back under another name (its own was taken
 * since) is retargeted in the tree and in every history entry. Pictures stay in assets/ either way.
 */
export const importTravel = (ctx: Ctx) => {
  const { set, get, need, saveManifest } = ctx;
  const showAfterTravel = createShowAfterTravel(ctx);

  /** Sends files that came back to the trash again and gives the redo step their new trash paths, so a later try still finds them. */
  const putBack = async (root: string, back: Imported, list: Imported) => {
    const again: Imported = [...list];
    for (const [n, b] of back.entries())
      again[n] = { path: list[n]!.path, trashPath: await bridge.trashFile(root, b.path) };
    const { history } = get();
    set({
      history: {
        ...history,
        redo: history.redo.map((h, n, all) =>
          n === all.length - 1 ? { ...h, imported: again } : h,
        ),
      },
    });
  };

  /**
   * Brings every file back from the trash. When one fails, the ones already back go to the trash again.
   */
  const restoreAll = async (root: string, list: Imported): Promise<Imported> => {
    const back: Imported = [];
    try {
      for (const i of list) {
        if (!i.trashPath) throw new Error(t`the page is no longer in the trash`);
        back.push({ path: await bridge.restoreTrash(root, i.trashPath) });
      }
    } catch (e) {
      await putBack(root, back, list);
      throw e;
    }
    return back;
  };

  return async (entry: HistoryEntry & { imported: Imported }, from: Direction): Promise<void> => {
    const undoing = from === "undo";
    const { root, manifest } = need();
    let imported: Imported;
    let fix = (e: HistoryEntry): HistoryEntry => e;
    if (undoing) {
      await saveManifest(withTree(manifest, entry.before));
      imported = [];
      try {
        for (const i of entry.imported)
          imported.push({ path: i.path, trashPath: await bridge.trashFile(root, i.path) });
      } catch (e) {
        await saveManifest(manifest); // the chapters stay listed, so the book is unchanged
        throw e;
      }
    } else {
      imported = await restoreAll(root, entry.imported);
      const lang = sourceEdition(manifest.editions).language;
      let after = entry.after;
      const renames = imported.flatMap((b, n) => {
        const was = entry.imported[n]!.path;
        if (b.path === was) return [];
        after = retargetFile(after, lang, was, b.path);
        return [{ from: was, to: b.path }];
      });
      fix = (e) => renames.reduce((acc, r) => retargetEntry(acc, lang, r.from, r.to), e);
      try {
        await saveManifest(withTree(manifest, after));
      } catch (e) {
        await putBack(root, imported, entry.imported);
        throw e;
      }
    }
    const flipped: HistoryEntry = { ...fix(entry), imported };
    set({
      history: flipHistory(get().history, from, flipped, fix),
    });
    await showAfterTravel(undefined, false);
    set({ notice: doneNotice(from, entry.label) });
    if (get().trash.length)
      void get()
        .actions.refreshTrash()
        .catch(() => {});
  };
};
