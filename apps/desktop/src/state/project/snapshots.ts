import { t } from "@lingui/core/macro";
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
      const w = await bridge.restoreSnapshot(root, entry.file, snapshot);
      set({ hashes: { ...get().hashes, [entry.file]: w.hash }, recovery: get().recovery.filter((r) => r.id !== id) });
      if (get().currentId === id) await reloadCurrent();
      else await load(id);
      set({ notice: t`Restored an earlier version of ${entry.title}. The text it replaced is kept in History.` });
    },
    dismissRecovery(id) {
      set({ recovery: get().recovery.filter((r) => r.id !== id) });
    },
  };
};
