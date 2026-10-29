import { sourceFile, sourceTitle } from "@cadabracraft/format";
import { plural, t } from "@lingui/core/macro";
import { bridge } from "../../lib/bridge";
import type { SnapshotActions } from "./types";
import type { Ctx } from "./context";

/** Earlier versions of a page: putting one back, and the recovery offers made when a book opens. */
export const createSnapshotActions = (ctx: Ctx): SnapshotActions => {
  const { set, get, need, entryOf, reloadCurrent, flush, load } = ctx;
  return {
    async restoreSnapshot(id, snapshot) {
      await flush();
      const { root, manifest } = need();
      const entry = entryOf(manifest, id);
      if (!entry) return;
      const w = await bridge.restoreSnapshot(root, sourceFile(entry, manifest.editions), snapshot);
      set({
        hashes: { ...get().hashes, [sourceFile(entry, manifest.editions)]: w.hash },
        recovery: get().recovery.filter((r) => r.id !== id),
      });
      if (get().currentId === id) await reloadCurrent();
      else await load(id);
      set({
        notice: t`Restored an earlier version of ${sourceTitle(entry, manifest.editions)}. The text it replaced is kept in History.`,
      });
    },
    async restorePageFromBook(id, snapshot) {
      await flush();
      const { root, manifest } = need();
      const entry = entryOf(manifest, id);
      if (!entry) return;
      const file = sourceFile(entry, manifest.editions);
      const w = await bridge.restorePageFromBookSnapshot(root, snapshot, file);
      set({
        hashes: { ...get().hashes, [file]: w.hash },
        recovery: get().recovery.filter((r) => r.id !== id),
      });
      if (get().currentId === id) await reloadCurrent();
      else await load(id);
      set({
        notice: t`Restored ${sourceTitle(entry, manifest.editions)} from a book snapshot. The text it replaced is kept in History.`,
      });
    },
    async restoreBook(snapshot) {
      await flush();
      const { root } = need();
      const open = get().currentId;
      const r = await bridge.restoreBookSnapshot(root, snapshot);
      await get().actions.openProject(root); // everything on screen came from the old files
      const { manifest } = get();
      if (open && manifest && entryOf(manifest, open)) await load(open);
      const parts = [
        t`Restored the whole book. It is kept as an automatic snapshot as it was before.`,
      ];
      if (r.trashed.length)
        parts.push(
          plural(r.trashed.length, {
            one: "# page that was not in the snapshot is in the trash.",
            other: "# pages that were not in the snapshot are in the trash.",
          }),
        );
      if (r.missing_assets.length)
        parts.push(
          plural(r.missing_assets.length, {
            one: "# image it used is no longer in the book folder.",
            other: "# images it used are no longer in the book folder.",
          }),
        );
      set({ notice: parts.join(" ") });
    },
    dismissRecovery(id) {
      set({ recovery: get().recovery.filter((r) => r.id !== id) });
    },
  };
};
