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
import { bridge } from "../../../lib/bridge";
import { forgetReference } from "../../../lib/references/references";
import { retargetEntry } from "../util";
import type { History, HistoryEntry } from "../types";
import type { Ctx } from "../context";

export type Direction = "undo" | "redo";

/** The history after `from`'s newest entry moved to the other stack as `flipped` (`fix` rewrites the other entries, e.g. after a rename). */
const flipHistory = (
  history: History,
  from: Direction,
  flipped: HistoryEntry,
  fix: (e: HistoryEntry) => HistoryEntry = (e) => e,
): History => {
  const kept = history[from].slice(0, -1).map(fix);
  const other = (from === "undo" ? history.redo : history.undo).map(fix);
  return from === "undo"
    ? { undo: kept, redo: [...other, flipped] }
    : { undo: [...other, flipped], redo: kept };
};

const doneNotice = (from: Direction, label: string): string =>
  from === "undo" ? t`Undid: ${label}` : t`Redid: ${label}`;

type Others = NonNullable<HistoryEntry["others"]>;
type Rename = { language: string; from: string; to: string };

/** Undo and redo of a removed reference. */
const referenceTravel = (ctx: Ctx) => {
  const { set, get, need, saveManifest } = ctx;
  return async (
    entry: HistoryEntry & { reference: NonNullable<HistoryEntry["reference"]> },
    from: Direction,
  ): Promise<void> => {
    const undoing = from === "undo";
    const { root, manifest } = need();
    const { index, trashPath } = entry.reference;
    let item = entry.reference.item;
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
    set({
      history: flipHistory(get().history, from, flipped),
      notice: doneNotice(from, entry.label),
    });
  };
};

/** Undo and redo of a text edit across pages. */
const docsTravel = (ctx: Ctx) => {
  const { set, get, need, writePages, reloadCurrent } = ctx;
  return async (
    entry: HistoryEntry & { docs: NonNullable<HistoryEntry["docs"]> },
    from: Direction,
  ): Promise<void> => {
    const undoing = from === "undo";
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
    set({ history: flipHistory(get().history, from, entry) });
    await reloadCurrent();
    const skip = skipped
      ? plural(skipped, {
          one: "# page is no longer in the book and was left out",
          other: "# pages are no longer in the book and were left out",
        })
      : "";
    set({ notice: [doneNotice(from, entry.label), skip, ...conflicts].filter(Boolean).join(". ") });
  };
};

/** Undo and redo of a chapter-tree edit (add, move, remove or restore a page). */
const treeTravel = (ctx: Ctx) => {
  const { set, get, need, entryOf, saveManifest, load } = ctx;
  /** Brings a removed page (and its translation files) back from the trash; the tree is retargeted where a name was taken since. */
  const restoreFiles = async (
    entry: HistoryEntry,
    file: string,
    target: HistoryEntry["before"],
  ) => {
    const { root } = need();
    if (!entry.trashPath) throw new Error(t`the page is no longer in the trash`);
    const renames: Rename[] = [];
    const back = await bridge.restoreTrash(root, entry.trashPath); // comes back as -2 when its name was taken since
    let tree = target;
    if (back !== file)
      tree = retargetFile(tree, sourceEdition(need().manifest.editions).language, file, back);
    const restored: Others = [];
    for (const o of entry.others ?? []) {
      if (!o.trashPath) {
        restored.push(o);
        continue;
      }
      const to = await bridge.restoreTrash(root, o.trashPath);
      if (to !== o.path) {
        tree = retargetFile(tree, o.language, o.path, to);
        renames.push({ language: o.language, from: o.path, to });
      }
      restored.push({ language: o.language, path: to });
    }
    return { target: tree, file: back, others: restored, renames };
  };

  /** Moves a page's files to the trash (never a hard delete) and returns where they went. */
  const trashFiles = async (file: string, others: Others) => {
    const { root } = need();
    const trashPath = await bridge.trashFile(root, file);
    const gone: Others = [];
    for (const o of others) gone.push({ ...o, trashPath: await bridge.trashFile(root, o.path) });
    return { trashPath, others: gone };
  };

  /** Shows a page that came back; otherwise keeps the open page unless it no longer exists. */
  const showAfterTravel = async (file: string | undefined, present: boolean) => {
    const next = need().manifest;
    const shown =
      file && present
        ? readingOrder(next).find((e) => sourceFile(e, next.editions) === file)
        : undefined;
    const cur = get().currentId;
    if (shown) {
      await load(shown.id);
      return;
    }
    if (!cur || entryOf(next, cur)) return;
    set({ currentId: null, currentDoc: null });
    const fallback = next.chapters[0] ?? readingOrder(next)[0];
    if (fallback) await load(fallback.id);
  };

  return async (entry: HistoryEntry, from: Direction): Promise<void> => {
    const undoing = from === "undo";
    let target = undoing ? entry.before : entry.after;
    const present = entry.file ? entry.file.added !== undoing : false; // should the page file exist when we are done?
    let file = entry.file?.path;
    let trashPath = entry.trashPath;
    const sourceLang = sourceEdition(need().manifest.editions).language;
    /** The translation files that came back under another name (every restored file is retargeted in the history). */
    let renames: Rename[] = [];
    let others = entry.others ?? [];
    // Files first when bringing one back, manifest first when sending one away: the manifest never names a missing file.
    if (file && present) {
      ({ target, file, others, renames } = await restoreFiles(entry, file, target));
      trashPath = undefined;
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
    if (file && !present) ({ trashPath, others } = await trashFiles(file, others));
    const was = entry.file?.path;
    if (was && file && was !== file) renames.push({ language: sourceLang, from: was, to: file });
    const fix = (e: HistoryEntry) =>
      renames.reduce((acc, r) => retargetEntry(acc, r.language, r.from, r.to), e);
    const { trashPath: _old, others: _others, ...rest } = fix(entry);
    const moved: HistoryEntry = {
      ...rest,
      ...(trashPath ? { trashPath } : {}),
      ...(others.length ? { others } : {}),
    };
    set({ history: flipHistory(get().history, from, moved, fix) });
    await showAfterTravel(file, present);
    set({ notice: doneNotice(from, entry.label) });
    if (get().trash.length)
      void get()
        .actions.refreshTrash()
        .catch(() => {});
  };
};

/** Undo and redo of one history entry, by kind: a removed reference, a text edit across pages, or a chapter-tree edit. */
export const createTravelEntries = (ctx: Ctx) => ({
  travelReference: referenceTravel(ctx),
  travelDocs: docsTravel(ctx),
  travelTree: treeTravel(ctx),
});
