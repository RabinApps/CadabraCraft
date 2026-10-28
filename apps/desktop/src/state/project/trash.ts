import { t } from "@lingui/core/macro";
import { restoreEntry, sourceEdition, sourceTitle, translationFile } from "@cadabracraft/format";
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
      const { manifest } = need();
      const languages = manifest.editions.slice(1).map((l) => l.language);
      // A translation file is listed with its page (restoring the source brings it back), not on its own.
      const isTranslation = (original: string) =>
        languages.some((l) => original.split("/")[1] === l && original.split("/").length === 3);
      for (const e of entries) {
        if (isTranslation(e.original) || e.original.startsWith("references/")) continue; // reference files have their own list
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
      const listed = await bridge.listTrash(root);
      const original = listed.find((e) => e.path === path)?.original;
      const file = await bridge.restoreTrash(root, path);
      const readTitle = async (f: string) => {
        const r = await bridge.readFile(root, f);
        let doc: unknown = null;
        try {
          doc = r ? JSON.parse(r.contents) : null;
        } catch {
          /* keep the file; the title falls back to its name */
        }
        return { r, title: titleOfDoc(doc, f) };
      };
      const { r, title } = await readTitle(file);
      // The page's translations were trashed with it: bring back the newest copy of each.
      const translations: { language: string; file: string; title: string }[] = [];
      const source = sourceEdition(manifest.editions).language;
      for (const lang of manifest.editions.map((l) => l.language).filter((l) => l !== source)) {
        const from = original ? translationFile(original, lang) : null;
        const hit = from ? listed.find((e) => e.original === from) : undefined;
        if (!hit) continue;
        const back = await bridge.restoreTrash(root, hit.path);
        const got = await readTitle(back);
        if (got.r) set({ hashes: { ...get().hashes, [back]: got.r.hash } });
        translations.push({ language: lang, file: back, title: got.title });
      }
      const { manifest: next, entry } = restoreEntry(manifest, file, title, translations);
      if (r) set({ hashes: { ...get().hashes, [file]: r.hash } });
      await saveManifest(next);
      record(
        {
          label: t`Restore ${sourceTitle(entry, manifest.editions)}`,
          file: { path: file, added: true },
          ...(translations.length
            ? { others: translations.map((x) => ({ language: x.language, path: x.file })) }
            : {}),
        },
        manifest,
        next,
      );
      set({ trash: get().trash.filter((x) => x.path !== path) });
      await load(entry.id);
    },
  };
};
