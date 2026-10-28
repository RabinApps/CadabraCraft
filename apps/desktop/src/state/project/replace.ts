import { plural, t } from "@lingui/core/macro";
import { treeOf } from "@cadabracraft/format";
import { mergeAdjacentText } from "../../lib/search/findHelpers";
import { replaceInDoc } from "../../lib/search/bookSearch";
import { errText } from "../../lib/projectError";
import { PartialWrite, HISTORY_LIMIT } from "./util";
import type { HistoryEntry, ReplaceActions } from "./types";
import type { Ctx } from "./context";

/** Replace all across the whole book, as one book undo step. */
export const createReplaceActions = (ctx: Ctx): ReplaceActions => {
  const { set, get, need, entryOf, writePages, reloadCurrent, flush, loadChapters } = ctx;
  /** A book-wide replace is running: a second one is ignored instead of racing it. */
  let replacing = false;
  return {
    async replaceInBook(opts, replacement) {
      if (replacing) return 0;
      replacing = true;
      try {
        await flush();
        const { manifest } = need();
        const docs: NonNullable<HistoryEntry["docs"]> = [];
        let count = 0;
        // Every page is read and parsed before the first write: an unreadable page stops the replace with nothing changed.
        const pages = await loadChapters();
        // Typing that arrived while the pages were being read would be overwritten by the reload below.
        if (get().draft)
          throw new Error(t`The page changed while searching, so nothing was replaced. Try again.`);
        for (const page of pages) {
          const r = replaceInDoc(page.doc, opts, replacement);
          if (!r.count) continue;
          const file = entryOf(manifest, page.id)?.file;
          if (!file) continue;
          count += r.count;
          docs.push({
            file,
            before: JSON.stringify(page.doc, null, 2),
            after: JSON.stringify(mergeAdjacentText(r.doc), null, 2),
          });
        }
        if (!docs.length) return 0;
        const tree = treeOf(manifest);
        const record = (list: typeof docs) =>
          set({
            history: {
              undo: [
                ...get().history.undo,
                { label: t`Replace all “${opts.query}”`, before: tree, after: tree, docs: list },
              ].slice(-HISTORY_LIMIT),
              redo: [],
            },
          });
        let conflicts: string[];
        try {
          conflicts = await writePages(
            docs.map((d) => ({ file: d.file, from: d.before, to: d.after })),
          );
        } catch (e) {
          const why = errText(e);
          const stuck = e instanceof PartialWrite ? e.stuck : [];
          if (!stuck.length) throw new Error(t`Replace all stopped: ${why}. Nothing was changed.`);
          // Some pages could not be put back: keep one undo step for exactly those, so Undo finishes the job.
          record(docs.filter((d) => stuck.some((p) => p.file === d.file)));
          await reloadCurrent().catch(() => {});
          throw new Error(
            `${t`Replace all stopped: ${why}.`} ${plural(stuck.length, { one: "# page could not be put back and keeps the replacement; Undo restores it.", other: "# pages could not be put back and keep the replacement; Undo restores them." })}`,
          );
        }
        record(docs);
        await reloadCurrent();
        set({ notice: [t`Replaced ${count} in the book`, ...conflicts].join(". ") });
        return count;
      } finally {
        replacing = false;
      }
    },
  };
};
