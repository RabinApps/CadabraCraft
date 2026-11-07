import type { StoreApi } from "zustand";
import { t } from "@lingui/core/macro";
import {
  readingOrder,
  type Manifest,
  type EditionEntry,
  entryFile,
  sourceEdition,
  sourceTitle,
} from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { alertOf, emptyDoc, parseChapter } from "./util";
import type { ProjectState } from "./types";
import { createReads } from "./context/reads";
import { createWrites } from "./context/writes";

export type Set = StoreApi<ProjectState>["setState"];
export type Get = StoreApi<ProjectState>["getState"];

/** What every slice of the project store shares: the open book's helpers, built once over the store's `set` and `get`. */
export function createContext(set: Set, get: Get) {
  const need = () => {
    const { root, manifest } = get();
    if (!root || !manifest) throw new Error("no project open");
    return { root, manifest };
  };
  const entryOf = (manifest: Manifest, id: string): EditionEntry | undefined =>
    readingOrder(manifest).find((e) => e.id === id);
  /** The language the editor shows and writes: the chosen edition, or the source edition. */
  const langOf = (manifest: Manifest): string =>
    get().activeLanguage ?? sourceEdition(manifest.editions).language;
  /** An entry's title in `language`, falling back to the source title while it is not translated. */
  const titleIn = (entry: EditionEntry, manifest: Manifest, language: string): string =>
    entry.titles[language] ?? sourceTitle(entry, manifest.editions);
  /** Loads the open page again from disk and remounts its editor. */
  const reloadCurrent = async () => {
    const id = get().currentId;
    if (!id) return;
    await load(id);
    set({ reloadCount: get().reloadCount + 1 });
  };
  const flushNow = async () => {
    const d = get().draft;
    if (!d) return;
    await get().actions.saveCurrent(d);
    // Typing that arrived while the write was running stays a draft (and is saved by the next flush).
    set(get().draft === d ? { draft: null, currentDoc: d } : { currentDoc: d });
  };
  /** Flushes run one after another so two saves of the same chapter never overlap. */
  let flushTail: Promise<void> | null = null;
  /** Saves unsaved edits so switching chapters never loses typing. Starts the write synchronously when idle (it is also called as the window closes). */
  const flush = (): Promise<void> => {
    const run = flushTail ? flushTail.then(flushNow) : flushNow();
    const tail: Promise<void> = run
      .then(
        () => {},
        () => {},
      )
      .then(() => {
        if (flushTail === tail) flushTail = null;
      });
    flushTail = tail;
    return run;
  };
  /** Counts page loads: a load that a newer one overtook stops without touching the store. */
  let loadSeq = 0;
  const load = async (id: string) => {
    const seq = ++loadSeq;
    let target: { root: string; manifest: Manifest; entry: EditionEntry; lang: string };
    let file: string | undefined;
    let r: Awaited<ReturnType<typeof bridge.readFile>>;
    for (;;) {
      await flush();
      if (seq !== loadSeq) return;
      const { root, manifest } = need();
      const entry = entryOf(manifest, id);
      if (!entry) return;
      const lang = langOf(manifest);
      target = { root, manifest, entry, lang };
      file = entryFile(entry, lang);
      r = file ? await bridge.readFile(root, file) : null;
      if (seq !== loadSeq) return;
      // Typing that arrived while the file was being read is written first (and the file read again), never dropped.
      if (!get().draft) break;
    }
    const { manifest, entry, lang } = target;
    let doc: ChapterDoc;
    try {
      doc = r && file ? parseChapter(r.contents, file) : emptyDoc(titleIn(entry, manifest, lang));
    } catch (e) {
      // Show no editor for a corrupt page, so nothing can be typed over it and saved.
      const why = whyText(e);
      set({
        currentId: null,
        currentDoc: null,
        draft: null,
        ...alertOf(
          t`This page could not be opened: ${why}. Restore an earlier version from History, or choose another page.`,
        ),
      });
      return;
    }
    set({
      currentId: id,
      currentDoc: doc,
      draft: null,
      hashes: r && file ? { ...get().hashes, [file]: r.hash } : get().hashes,
    });
  };

  const { saveManifest, record, recordDocs, writePage, writePages } = createWrites(set, get, need);
  const reads = createReads(get, need, langOf, titleIn);

  return {
    set,
    get,
    need,
    entryOf,
    langOf,
    titleIn,
    saveManifest,
    record,
    recordDocs,
    writePage,
    writePages,
    reloadCurrent,
    flush,
    load,
    ...reads,
  };
}

export type Ctx = ReturnType<typeof createContext>;
