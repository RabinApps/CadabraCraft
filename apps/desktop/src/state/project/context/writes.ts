import { t } from "@lingui/core/macro";
import { sameTree, serializeManifest, treeOf, type Manifest } from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { errText } from "../../../lib/projectError";
import { PartialWrite, HISTORY_LIMIT } from "../util";
import type { HistoryEntry } from "../types";
import type { Get, Set } from "../context";

/** Everything that writes the open book: the manifest, the undo history and page files (all through the backup and temp-file write path). */
export function createWrites(set: Set, get: Get, need: () => { root: string; manifest: Manifest }) {
  const saveManifest = async (manifest: Manifest) => {
    const { root } = need();
    const base = get().hashes["cadabra.json"] ?? null;
    const w = await bridge.writeFile(root, "cadabra.json", serializeManifest(manifest), base);
    set({
      manifest,
      hashes: { ...get().hashes, "cadabra.json": w.hash },
      notice: w.conflict_copy
        ? t`cadabra.json changed outside the app; your previous copy was kept as ${w.conflict_copy}`
        : get().notice,
    });
  };
  /** Remembers a finished tree edit. A new edit drops the redo stack. */
  const record = (
    entry: Omit<HistoryEntry, "before" | "after">,
    before: Manifest,
    after: Manifest,
  ) => {
    const tree = { before: treeOf(before), after: treeOf(after) };
    if (sameTree(tree.before, tree.after)) return; // e.g. moving the first page up
    set({
      history: {
        undo: [...get().history.undo, { ...entry, ...tree }].slice(-HISTORY_LIMIT),
        redo: [],
      },
    });
  };
  /** Remembers a text edit across pages as one undo step: each page's file text before and after (the chapter tree is unchanged). */
  const recordDocs = (label: string, docs: NonNullable<HistoryEntry["docs"]>) => {
    const tree = treeOf(need().manifest);
    set({
      history: {
        undo: [...get().history.undo, { label, before: tree, after: tree, docs }].slice(
          -HISTORY_LIMIT,
        ),
        redo: [],
      },
    });
  };
  /** Writes a page's file text through the normal save path (backup, temp file and rename in the Rust layer). */
  const writePage = async (file: string, contents: string) => {
    const { root } = need();
    const w = await bridge.writeFile(root, file, contents, get().hashes[file] ?? null);
    set({
      hashes: { ...get().hashes, [file]: w.hash },
      ...(w.conflict_copy
        ? {
            notice: t`${file} changed outside the app; the other version was kept as ${w.conflict_copy}`,
          }
        : {}),
    });
    return w.conflict_copy
      ? t`${file} changed outside the app; the other version was kept as ${w.conflict_copy}`
      : null;
  };
  /**
   * Writes several pages as a group: when one write fails, the pages already written are put back, so a failure does
   * not leave the book half changed. Throws a `PartialWrite` naming the pages that could not be put back (empty when
   * everything was restored). Returns the conflict messages of pages that changed outside the app.
   */
  const writePages = async (
    pages: { file: string; from: string; to: string }[],
  ): Promise<string[]> => {
    const done: typeof pages = [];
    const conflicts: string[] = [];
    try {
      for (const p of pages) {
        const c = await writePage(p.file, p.to);
        if (c) conflicts.push(c);
        done.push(p);
      }
    } catch (e) {
      const stuck: typeof pages = [];
      for (const p of done.reverse()) {
        try {
          await writePage(p.file, p.from);
        } catch {
          stuck.push(p);
        }
      }
      throw new PartialWrite(errText(e), stuck);
    }
    return conflicts;
  };
  return { saveManifest, record, recordDocs, writePage, writePages };
}
