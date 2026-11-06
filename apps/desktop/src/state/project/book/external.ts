import { t } from "@lingui/core/macro";
import { parseManifest, readingOrder } from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../../lib/bridge";
import { whyText } from "../../../lib/projectError";
import { alertOf, parseChapter, NO_HISTORY } from "../util";
import type { ProjectActions } from "../types";
import type { Ctx } from "../context";

/** Changes made to the book from outside the app (a sync folder, another editor). */
export const createExternalActions = (
  ctx: Ctx,
): Pick<ProjectActions, "watchFailed" | "externalChange"> => {
  const { set, get, forgetWords } = ctx;
  return {
    watchFailed() {
      if (get().root)
        set({ notice: t`Changes made outside the app may not be noticed. Saving still works.` });
    },
    async externalChange(path) {
      const { root, manifest, hashes } = get();
      if (!root || !manifest) return;
      const r = await bridge.readFile(root, path).catch(() => null);
      if (!r || r.hash === hashes[path]) return; // gone, unreadable, or our own write
      forgetWords(path);
      if (path === "cadabra.json") {
        try {
          set({
            manifest: parseManifest(r.contents).manifest,
            hashes: { ...get().hashes, [path]: r.hash },
            history: NO_HISTORY,
            notice: t`Chapter list updated from outside the app`,
          });
        } catch {
          set(
            alertOf(
              t`cadabra.json was changed outside the app and could not be read; saving will keep a copy of that version. Restore the book's list from History if chapters are missing.`,
            ),
          );
        }
        return;
      }
      // Any edition's file can change outside the app; only the open page in the open edition needs a reload.
      const language = ctx.langOf(manifest);
      const entry = readingOrder(manifest).find((c) => c.files[language] === path);
      if (!entry || entry.id !== get().currentId) return; // other chapters and editions load fresh when opened
      if (get().draft) {
        set({
          notice: t`${ctx.titleIn(entry, manifest, language)} changed outside the app; saving will keep both versions`,
        });
        return;
      }
      let doc: ChapterDoc;
      try {
        doc = parseChapter(r.contents, path);
      } catch (e) {
        // Keep what is open and its old hash, so a later save keeps the unreadable version as a conflict copy instead of replacing it silently.
        const why = whyText(e);
        set(
          alertOf(
            t`A change made outside the app could not be read: ${why}. The version you have open is kept; saving keeps a copy of the changed file. You can also restore an earlier version from History.`,
          ),
        );
        return;
      }
      set({
        currentDoc: doc,
        hashes: { ...get().hashes, [path]: r.hash },
        reloadCount: get().reloadCount + 1,
        notice: t`${ctx.titleIn(entry, manifest, language)} was updated from outside the app`,
      });
    },
  };
};
