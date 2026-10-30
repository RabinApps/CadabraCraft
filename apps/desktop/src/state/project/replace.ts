import { plural, t } from "@lingui/core/macro";
import { treeOf, entryFile } from "@cadabracraft/format";
import { mergeAdjacentText } from "../../lib/search/findHelpers";
import { replaceInDoc } from "../../lib/search/bookSearch";
import { errText } from "../../lib/projectError";
import { PartialWrite, HISTORY_LIMIT } from "./util";
import type { HistoryEntry, ReplaceActions } from "./types";
import type { Ctx } from "./context";

/** Replace all across the whole book, as one book undo step. */
export const createReplaceActions = (ctx: Ctx): ReplaceActions => {
  const { set, get, need, writePages, reloadCurrent, flush, loadChaptersIn, entryOf, langOf } = ctx;
  /** A book-wide replace is running: a second one is ignored instead of racing it. */
  let replacing = false;
  return {
    async replaceInBook(opts, replacement, scope) {
      if (replacing) return 0;
      replacing = true;
      try {
        await flush();
        const { manifest } = need();
        const docs: NonNullable<HistoryEntry["docs"]> = [];
        let count = 0;
        // Every page is read and parsed before the first write: an unreadable page stops the replace with nothing changed.
        // By default only the edition the editor shows is searched and changed (a translation has its own files);
        // "All languages" visits every edition, each page file once.
        const langs = scope?.allLanguages
          ? manifest.editions.map((e) => e.language)
          : [langOf(manifest)];
        const loaded = [];
        for (const lang of langs) loaded.push({ lang, pages: await loadChaptersIn(lang) });
        // Typing that arrived while the pages were being read would be overwritten by the reload below.
        if (get().draft)
          throw new Error(t`The page changed while searching, so nothing was replaced. Try again.`);
        const touched = new Set<string>();
        for (const { lang, pages } of loaded)
          for (const page of pages) {
            const file = entryFile(entryOf(manifest, page.id)!, lang); // the pages were read from this same manifest
            if (!file) continue; // not translated yet: a blank page has no file to change
            const r = replaceInDoc(page.doc, opts, replacement);
            if (!r.count) continue;
            count += r.count;
            touched.add(lang);
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
          const { stuck } = e as PartialWrite; // writePages only ever throws a PartialWrite
          if (!stuck.length)
            throw new Error(t`Replace all stopped: ${why}. Nothing was changed.`, { cause: e });
          // Some pages could not be put back: keep one undo step for exactly those, so Undo finishes the job.
          record(docs.filter((d) => stuck.some((p) => p.file === d.file)));
          await reloadCurrent().catch(() => {});
          throw new Error(
            `${t`Replace all stopped: ${why}.`} ${plural(stuck.length, { one: "# page could not be put back and keeps the replacement; Undo restores it.", other: "# pages could not be put back and keep the replacement; Undo restores them." })}`,
            { cause: e },
          );
        }
        record(docs);
        await reloadCurrent();
        const languages = touched.size;
        const done =
          languages > 1
            ? t`Replaced ${count} in the book, in ${languages} languages`
            : t`Replaced ${count} in the book`;
        set({ notice: [done, ...conflicts].join(". ") });
        return count;
      } finally {
        replacing = false;
      }
    },
  };
};
