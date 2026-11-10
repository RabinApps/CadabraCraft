import { t } from "@lingui/core/macro";
import { entryFile } from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { errText } from "../../../lib/projectError";
import { PartialWrite } from "../util";
import type { HistoryEntry } from "../types";
import type { Ctx } from "../context";

/** A change to one page's document: the new document and how many marks it touched (0 leaves the page alone). */
export type DocChange = (doc: ChapterDoc, pageId: string) => { doc: ChapterDoc; count: number };

/**
 * Applies a change to every page of the shown edition and writes the pages that changed through the normal save path (backup, temp
 * file and rename), as a group: when one write fails the others are put back. With `undoLabel` the change is one book undo step
 * (Undo and Redo, Mod+Alt+Z). The open page is saved first and shown again afterwards. Returns the number of marks touched.
 */
export function createBookEdit(ctx: Ctx) {
  const {
    get,
    need,
    flush,
    loadChaptersIn,
    writePages,
    recordDocs,
    reloadCurrent,
    entryOf,
    langOf,
  } = ctx;
  /** An edit is running: a second one waits for its turn instead of racing it. */
  let running: Promise<unknown> = Promise.resolve();
  const edit = async (change: DocChange, undoLabel: string | null): Promise<number> => {
    await flush();
    const { manifest } = need();
    const lang = langOf(manifest);
    const pages = await loadChaptersIn(lang);
    // Typing that arrived while the pages were being read would be overwritten by the reload below.
    if (get().draft)
      throw new Error(
        t`The page changed while the book was being read, so nothing was changed. Try again.`,
      );
    const docs: NonNullable<HistoryEntry["docs"]> = [];
    let count = 0;
    for (const page of pages) {
      const file = entryFile(entryOf(manifest, page.id)!, lang); // the pages were read from this same manifest
      if (!file) continue; // not translated yet: a blank page has no file to change
      const r = change(page.doc, page.id);
      if (!r.count) continue;
      count += r.count;
      docs.push({
        file,
        before: JSON.stringify(page.doc, null, 2),
        after: JSON.stringify(r.doc, null, 2),
      });
    }
    if (!docs.length) return 0;
    try {
      await writePages(docs.map((d) => ({ file: d.file, from: d.before, to: d.after })));
    } catch (e) {
      const why = errText(e);
      const { stuck } = e as PartialWrite; // writePages only ever throws a PartialWrite
      if (!stuck.length)
        throw new Error(t`The change stopped: ${why}. Nothing was changed.`, { cause: e });
      if (undoLabel)
        recordDocs(
          undoLabel,
          docs.filter((d) => stuck.some((p) => p.file === d.file)),
        );
      await reloadCurrent().catch(() => {});
      throw new Error(
        t`The change stopped: ${why}. Some pages kept the change; Undo restores them.`,
        { cause: e },
      );
    }
    if (undoLabel) recordDocs(undoLabel, docs);
    await reloadCurrent();
    return count;
  };
  return (change: DocChange, undoLabel: string | null): Promise<number> => {
    const run = running.then(() => edit(change, undoLabel));
    running = run.catch(() => {});
    return run;
  };
}
