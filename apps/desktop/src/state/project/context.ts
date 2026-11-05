import type { StoreApi } from "zustand";
import { t } from "@lingui/core/macro";
import {
  exportDir,
  exportPlan,
  readingOrder,
  sameTree,
  sectionOf,
  serializeManifest,
  treeOf,
  type Manifest,
  type EditionEntry,
  entryFile,
  sourceEdition,
  sourceTitle,
} from "@cadabracraft/format";
import { collectImageSources } from "@cadabracraft/export-epub";
import { countWords, type ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../lib/bridge";
import { errText, whyText } from "../../lib/projectError";
import { alertOf, emptyDoc, parseChapter, PartialWrite, HISTORY_LIMIT } from "./util";
import type { BookPage, EntryWords, HistoryEntry, ProjectState } from "./types";

type Set = StoreApi<ProjectState>["setState"];
type Get = StoreApi<ProjectState>["getState"];

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

  /** Every page of one language in reading order (front matter, chapters, back matter), read from disk (only page `only` when given). A page with no file yet is blank. */
  const loadChaptersIn = async (lang: string, only?: string) => {
    const { root, manifest } = need();
    const pages = [];
    const sectionFor = (e: EditionEntry): BookPage["section"] =>
      manifest.frontMatter.some((f) => f.id === e.id)
        ? "front"
        : manifest.backMatter.some((b) => b.id === e.id)
          ? "back"
          : "chapter";
    for (const c of readingOrder(manifest)) {
      if (only !== undefined && c.id !== only) continue;
      const file = entryFile(c, lang);
      const r = file ? await bridge.readFile(root, file) : null;
      if (file && !r) throw new Error(t`Missing chapter file ${file}`);
      const dropCap = sectionFor(c) === "chapter" ? (c.dropCap ?? manifest.dropCap) : undefined;
      pages.push({
        id: c.id,
        title: titleIn(c, manifest, lang),
        doc: r && file ? parseChapter(r.contents, file) : emptyDoc(titleIn(c, manifest, lang)),
        section: sectionFor(c),
        ...(c.kind ? { kind: c.kind } : {}),
        ...(dropCap === undefined ? {} : { dropCap }),
        ...(c.verticalCenter === undefined ? {} : { verticalCenter: c.verticalCenter }),
        ...(c.startOnNext === undefined ? {} : { startOnNext: c.startOnNext }),
      });
    }
    return pages;
  };
  /** The source edition's pages (audiobook and find and replace all read the source for now). */
  const loadChapters = () => loadChaptersIn(sourceEdition(need().manifest.editions).language);
  /**
   * What an export of `language` (default: the source) reads: its edition, its pages and the output folder.
   * Untranslated pages stop the export unless `skipUntranslated`; then they are left out and listed in `skipped`.
   */
  const loadExportPages = async (scope: { language?: string; skipUntranslated?: boolean } = {}) => {
    const { manifest } = need();
    const language = scope.language ?? sourceEdition(manifest.editions).language;
    const plan = exportPlan(manifest, language, scope.skipUntranslated ?? false);
    const keep = new Set(plan.included.map((e) => e.id));
    const pages = (await loadChaptersIn(language)).filter((p) => keep.has(p.id));
    const edition = manifest.editions.find((e) => e.language === language)!;
    return { edition, pages, dir: exportDir(language), skipped: plan.skipped };
  };
  /** Word count per chapter file, valid while the store's hash for that file is the one it was counted under. */
  let wordCache = new Map<string, { hash: string | undefined; words: number }>();
  /**
   * Words of every page of the book in reading order (front and back matter included, those with no text in the open language
   * left out), reading only pages that changed since they were last counted. The open page is counted from the draft or the
   * loaded doc.
   */
  const countEntries = async (): Promise<EntryWords[]> => {
    const { root, manifest } = need();
    const currentId = get().currentId;
    const lang = langOf(manifest);
    const out: EntryWords[] = [];
    for (const c of readingOrder(manifest)) {
      const section = sectionOf(manifest, c.id)!;
      const own = {
        id: c.id,
        section,
        kind: c.kind,
        verticalCenter: c.verticalCenter,
        startOnNext: c.startOnNext,
      };
      if (c.id === currentId) {
        const open = get().draft ?? get().currentDoc;
        if (open) {
          out.push({ ...own, words: countWords(open) });
          continue;
        }
      }
      const file = entryFile(c, lang);
      // No text in this language yet: the page is still in the book (the PDF exports its title), with no words.
      if (!file) {
        out.push({ ...own, words: 0 });
        continue;
      }
      const hash = get().hashes[file];
      const hit = wordCache.get(file);
      if (hit && hit.hash === hash) {
        out.push({ ...own, words: hit.words });
        continue;
      }
      const r = await bridge.readFile(root, file);
      if (!r) throw new Error(t`Missing chapter file ${file}`);
      const words = countWords(parseChapter(r.contents, file));
      wordCache.set(file, { hash, words });
      out.push({ ...own, words });
    }
    return out;
  };
  /** Words in the book's chapters. */
  const countBook = async () =>
    (await countEntries()).reduce((a, e) => (e.section === "chapter" ? a + e.words : a), 0);
  /** Bytes of every image the chapters use. */
  const loadAssets = async (chapters: { doc: ChapterDoc }[]) => {
    const { root } = need();
    const assets = new Map<string, Uint8Array>();
    for (const src of chapters.flatMap((c) => collectImageSources(c.doc))) {
      if (assets.has(src)) continue;
      try {
        assets.set(src, await bridge.readAsset(root, src));
      } catch {
        throw new Error(t`Missing image file ${src}`);
      }
    }
    return assets;
  };

  /** Bytes of the cover image, or undefined when the book has none. A cover that cannot be read stops the export instead of leaving it out. */
  const loadCover = async (
    cover: string | null,
  ): Promise<{ path: string; bytes: Uint8Array } | undefined> => {
    const { root } = need();
    if (!cover) return undefined;
    try {
      return { path: cover, bytes: await bridge.readAsset(root, cover) };
    } catch {
      throw new Error(
        t`The cover image ${cover} could not be read. Choose it again in Book details, or remove the cover.`,
      );
    }
  };
  /** Forget every counted page (a different book was opened or the book was closed). */
  const resetWordCache = () => {
    wordCache = new Map();
  };
  /** Forget one page's count (its file changed outside the app). */
  const forgetWords = (path: string) => {
    wordCache.delete(path);
  };

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
    loadChapters,
    loadChaptersIn,
    loadExportPages,
    countBook,
    countEntries,
    loadAssets,
    loadCover,
    resetWordCache,
    forgetWords,
  };
}

export type Ctx = ReturnType<typeof createContext>;
