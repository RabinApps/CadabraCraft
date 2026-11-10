import { t } from "@lingui/core/macro";
import { parseManifest, readingOrder, sourceFile, sourceTitle } from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { forgetProjectAssets } from "../../../lib/assets";
import { forgetProjectReferences } from "../../../lib/references/references";
import { noManifestMessage } from "../../../lib/projectError";
import { useSettings } from "../../view/editorPrefs";
import { useRecents } from "../../app/recents";
import { bestEffort, NO_HISTORY } from "../util";
import { noteWritingBaseline } from "../writingSave";
import type { ProjectState } from "../types";
import type { Ctx } from "../context";

/** What the loading skeleton calls the book before its manifest is read: the recent list's title, else the folder name. */
const bookNameOf = (root: string): string =>
  useRecents.getState().recents.find((r) => r.root === root)?.title ||
  root.split(/[\\/]/).filter(Boolean).pop() ||
  root;

/** Opens a book: reading cadabra.json, switching from the book being left, and the first page. Opens never overlap. */
export const createOpener = (ctx: Ctx) => {
  const { set, get, saveManifest, flush, load, resetWordCache } = ctx;
  /** The open that is running, so a second one (a double click on a recent book) joins it instead of racing it. */
  let opening: Promise<void> | null = null;
  /** Starts the open, or joins the one running. `skeleton` shows the loading screen; creating or importing keeps its own dialog up instead. */
  const join = (root: string, skeleton: boolean): Promise<void> => {
    if (!opening) {
      if (skeleton) set({ opening: { root, name: bookNameOf(root) } });
      opening = openNow(root).finally(() => {
        opening = null;
        if (get().opening) set({ opening: null });
      });
    }
    return opening;
  };
  const closedState: Partial<ProjectState> = {
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    activeLanguage: null,
    draft: null,
    hashes: {},
    notice: "",
    history: NO_HISTORY,
    trash: [],
    recovery: [],
    referenceNotices: [],
    removedReferences: [],
    referenceImport: null,
    importReport: null,
    audio: null,
  };
  const openNow = async (root: string): Promise<void> => {
    await flush(); // typing in the book being left
    const r = await bridge.readFile(root, "cadabra.json");
    if (!r) throw new Error(noManifestMessage());
    const parsed = parseManifest(r.contents);
    resetWordCache();
    const previous = get().root;
    if (previous && previous !== root) {
      forgetProjectAssets(previous);
      forgetProjectReferences(previous);
      await bestEffort(() => bridge.unwatchProject(), undefined); // the old book's changes must not reach the new one
    }
    set({
      root,
      manifest: parsed.manifest,
      hashes: { "cadabra.json": r.hash },
      currentId: null,
      currentDoc: null,
      activeLanguage: null,
      notice: "",
      history: NO_HISTORY,
      trash: [],
      recovery: [],
      referenceNotices: [],
      removedReferences: [],
      referenceImport: null,
    });
    try {
      await finishOpen(root, parsed);
    } catch (e) {
      // Never stay half open (a book on screen that is not watched): go back to no book.
      set({ ...closedState });
      await bestEffort(() => bridge.unwatchProject(), undefined);
      throw e;
    }
  };
  const finishOpen = async (root: string, parsed: ReturnType<typeof parseManifest>) => {
    const pageFiles = readingOrder(parsed.manifest).map((e) =>
      sourceFile(e, parsed.manifest.editions),
    );
    // Offered before any page is opened: a page that was put back to older text by a sync folder is easy to miss otherwise.
    const stale = await bestEffort(() => bridge.findStalePages(root, pageFiles), []);
    const recovery = stale.flatMap((x) => {
      const e = readingOrder(parsed.manifest).find(
        (m) => sourceFile(m, parsed.manifest.editions) === x.path,
      );
      return e
        ? [
            {
              id: e.id,
              title: sourceTitle(e, parsed.manifest.editions),
              file: sourceFile(e, parsed.manifest.editions),
              snapshot: x.snapshot,
            },
          ]
        : [];
    });
    set({ recovery });
    if (parsed.migrated) {
      const backup = await bridge.backupManifest(root);
      await saveManifest(parsed.manifest);
      set({
        notice: t`Project upgraded from format ${parsed.fromVersion}; backup saved to ${backup}`,
      });
    }
    const first = parsed.manifest.chapters[0] ?? readingOrder(parsed.manifest)[0];
    if (first) await load(first.id);
    // The baseline for the writing history: the book's words as it opens, so the first save counts only what is typed after.
    void noteWritingBaseline(root, () => get().actions.bookWords());
    await bridge.watchProject(root);
    void bestEffort(
      () => bridge.pruneSnapshots(root, pageFiles, useSettings.getState().snapshotKeep),
      0,
    );
    const { bookSnapshotKeep, bookSnapshotMaxMb } = useSettings.getState();
    void bestEffort(
      () =>
        bridge.pruneBookSnapshots(root, { maxCount: bookSnapshotKeep, maxMb: bookSnapshotMaxMb }),
      null,
    );
  };
  return { join, closedState };
};
