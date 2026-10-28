import { t } from "@lingui/core/macro";
import { restoreEntry, sourceTitle } from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { titleOfDoc } from "./util";
import type { TrashItem, TrashActions } from "./types";
import type { Ctx } from "./context";

/** The project trash: what can be put back. */
export const createTrashActions = (ctx: Ctx): TrashActions => {
  const { set, get, need, saveManifest, record, flush, load } = ctx;
  return {
    async refreshTrash() {
      const { root } = need();
      const entries = await bridge.listTrash(root);
      const trash: TrashItem[] = [];
      for (const e of entries) {
        const r = await bridge.readFile(root, e.path).catch(() => null);
        let doc: unknown = null;
        try {
          doc = r ? JSON.parse(r.contents) : null;
        } catch {
          /* unreadable page: the title falls back to the file name */
        }
        trash.push({
          path: e.path,
          original: e.original,
          title: titleOfDoc(doc, e.original),
          trashedAt: e.trashed_at,
        });
      }
      if (get().root === root) set({ trash });
    },
    async restoreTrash(path) {
      await flush();
      const { root, manifest } = need();
      const file = await bridge.restoreTrash(root, path);
      const r = await bridge.readFile(root, file);
      let doc: unknown = null;
      try {
        doc = r ? JSON.parse(r.contents) : null;
      } catch {
        /* keep the file; the title falls back to its name */
      }
      const { manifest: next, entry } = restoreEntry(manifest, file, titleOfDoc(doc, file));
      if (r) set({ hashes: { ...get().hashes, [file]: r.hash } });
      await saveManifest(next);
      record(
        {
          label: t`Restore ${sourceTitle(entry, manifest.editions)}`,
          file: { path: file, added: true },
        },
        manifest,
        next,
      );
      set({ trash: get().trash.filter((x) => x.path !== path) });
      await load(entry.id);
    },
  };
};
