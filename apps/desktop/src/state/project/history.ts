import { plural, t } from "@lingui/core/macro";
import {
  readingOrder,
  retargetFile,
  withTree,
  sourceFile,
  entryFile,
  sourceEdition,
  relink,
  nextReferenceId,
  removeReference,
  unlinkEntry,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { forgetReference } from "../../lib/references";
import { whyText } from "../../lib/projectError";
import { alertOf, PartialWrite, retargetEntry } from "./util";
import type { HistoryEntry, HistoryActions } from "./types";
import type { Ctx } from "./context";

/** Undo and redo of chapter-tree edits (and book-wide replaces). */
export const createHistoryActions = (ctx: Ctx): HistoryActions => {
  const { set, get, need, entryOf, saveManifest, writePages, reloadCurrent, flush, load } = ctx;
  let historyBusy = false;
  /** Undoes (`from` = "undo") or redoes (`from` = "redo") the latest entry of that stack. */
  const travel = async (from: "undo" | "redo"): Promise<boolean> => {
    if (historyBusy) return false;
    historyBusy = true;
    try {
      await flush();
      const entry = get().history[from].at(-1);
      if (!entry) return false;
      const { root } = need();
      const undoing = from === "undo";
      if (entry.reference) {
        const { index, trashPath } = entry.reference;
        let item = entry.reference.item;
        const { manifest } = need();
        let after: typeof manifest;
        let moved: string | undefined;
        if (undoing) {
          // The file first, then the list: the manifest never names a missing file. Comes back under another name when its own was taken since.
          item = { ...item, file: await bridge.restoreTrash(root, trashPath!) };
          if (manifest.references.some((r) => r.id === item.id))
            item = { ...item, id: nextReferenceId(manifest) };
          const list = [...manifest.references];
          list.splice(index, 0, item);
          after = { ...manifest, references: list };
        } else {
          after = removeReference(manifest, item.id).manifest;
        }
        await saveManifest(after);
        if (!undoing) {
          forgetReference(root, item.file);
          moved = await bridge.trashReference(root, item.file);
        }
        void get().actions.refreshRemovedReferences();
        const flipped: HistoryEntry = {
          ...entry,
          reference: { item, index, ...(moved ? { trashPath: moved } : {}) },
        };
        const { history } = get();
        const kept = history[from].slice(0, -1);
        const other = undoing ? history.redo : history.undo;
        set({
          history: undoing
            ? { undo: kept, redo: [...other, flipped] }
            : { undo: [...other, flipped], redo: kept },
          notice: undoing ? t`Undid: ${entry.label}` : t`Redid: ${entry.label}`,
        });
        return true;
      }
      if (entry.docs) {
        // A text edit across pages: write each page's saved text back (no tree change).
        // Pages removed from the book since (trashed) are skipped: writing them would bring back a file the book no longer lists.
        const current = need().manifest;
        // Every edition's file counts: a replace across languages records translation files too.
        const listed = new Set(
          readingOrder(current).flatMap((e) =>
            current.editions.flatMap((ed) => entryFile(e, ed.language) ?? []),
          ),
        );
        const live = entry.docs.filter((d) => listed.has(d.file));
        const skipped = entry.docs.length - live.length;
        const conflicts = await writePages(
          live.map((d) => ({
            file: d.file,
            from: undoing ? d.after : d.before,
            to: undoing ? d.before : d.after,
          })),
        );
        const { history } = get();
        const kept = history[from].slice(0, -1);
        const other = undoing ? history.redo : history.undo;
        set({
          history: undoing
            ? { undo: kept, redo: [...other, entry] }
            : { undo: [...other, entry], redo: kept },
        });
        await reloadCurrent();
        const done = undoing ? t`Undid: ${entry.label}` : t`Redid: ${entry.label}`;
        const skip = skipped
          ? plural(skipped, {
              one: "# page is no longer in the book and was left out",
              other: "# pages are no longer in the book and were left out",
            })
          : "";
        set({ notice: [done, skip, ...conflicts].filter(Boolean).join(". ") });
        return true;
      }
      let target = undoing ? entry.before : entry.after;
      const present = entry.file ? entry.file.added !== undoing : false; // should the page file exist when we are done?
      let file = entry.file?.path;
      let trashPath = entry.trashPath;
      const sourceLang = sourceEdition(need().manifest.editions).language;
      /** The translation files that came back under another name (every restored file is retargeted in the history). */
      const renames: { language: string; from: string; to: string }[] = [];
      let others = entry.others ?? [];
      // Files first when bringing one back, manifest first when sending one away: the manifest never names a missing file.
      if (file && present) {
        if (!trashPath) throw new Error(t`the page is no longer in the trash`);
        const back = await bridge.restoreTrash(root, trashPath); // comes back as -2 when its name was taken since
        if (back !== file)
          target = retargetFile(
            target,
            sourceEdition(need().manifest.editions).language,
            file,
            back,
          );
        file = back;
        trashPath = undefined;
        const restored: typeof others = [];
        for (const o of others) {
          if (!o.trashPath) {
            restored.push(o);
            continue;
          }
          const to = await bridge.restoreTrash(root, o.trashPath);
          if (to !== o.path) {
            target = retargetFile(target, o.language, o.path, to);
            renames.push({ language: o.language, from: o.path, to });
          }
          restored.push({ language: o.language, path: to });
        }
        others = restored;
      }
      const tree = withTree(need().manifest, target);
      const linked = entry.links ?? [];
      // The links a removed page had come back with it (a reference removed since is skipped) and go again on redo.
      await saveManifest(
        !linked.length
          ? tree
          : present
            ? relink(tree, linked)
            : unlinkEntry(tree, linked[0]!.chapter),
      );
      if (file && !present) {
        trashPath = await bridge.trashFile(root, file); // never a hard delete
        const gone: typeof others = [];
        for (const o of others)
          gone.push({ ...o, trashPath: await bridge.trashFile(root, o.path) });
        others = gone;
      }
      const was = entry.file?.path;
      if (was && file && was !== file) renames.push({ language: sourceLang, from: was, to: file });
      const fix = (e: HistoryEntry) =>
        renames.reduce((acc, r) => retargetEntry(acc, r.language, r.from, r.to), e);
      const { history } = get();
      const { trashPath: _old, others: _others, ...rest } = fix(entry);
      const moved: HistoryEntry = {
        ...rest,
        ...(trashPath ? { trashPath } : {}),
        ...(others.length ? { others } : {}),
      };
      const kept = history[from].slice(0, -1).map(fix);
      const other = (undoing ? history.redo : history.undo).map(fix);
      set({
        history: undoing
          ? { undo: kept, redo: [...other, moved] }
          : { undo: [...other, moved], redo: kept },
      });
      // Show a page that came back; otherwise keep the open page unless it no longer exists.
      const next = need().manifest;
      const shown =
        file && present
          ? readingOrder(next).find((e) => sourceFile(e, next.editions) === file)
          : undefined;
      const cur = get().currentId;
      if (shown) await load(shown.id);
      else if (cur && !entryOf(next, cur)) {
        set({ currentId: null, currentDoc: null });
        const fallback = next.chapters[0] ?? readingOrder(next)[0];
        if (fallback) await load(fallback.id);
      }
      set({ notice: undoing ? t`Undid: ${entry.label}` : t`Redid: ${entry.label}` });
      if (get().trash.length)
        void get()
          .actions.refreshTrash()
          .catch(() => {});
      return true;
    } catch (e) {
      const why = whyText(e);
      const stuck = e instanceof PartialWrite ? e.stuck.length : 0;
      const base =
        from === "undo"
          ? t`Could not undo: ${why}. Try again, or restore the page from History.`
          : t`Could not redo: ${why}. Try again, or restore the page from History.`;
      set(
        alertOf(
          stuck
            ? `${base} ${plural(stuck, { one: "# page could not be put back and is now in the other state.", other: "# pages could not be put back and are now in the other state." })}`
            : base,
        ),
      );
      return false;
    } finally {
      historyBusy = false;
    }
  };
  return {
    undo: () => travel("undo"),
    redo: () => travel("redo"),
  };
};
