import { create } from "zustand";
import { plural, t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  addBackMatter, addChapter, addFrontMatter, createManifest, moveChapter, moveMatter, parseManifest, readingOrder, removeChapter, removeMatter,
  renameChapter, renameMatter, restoreEntry, retargetFile, sameTree, sectionOf, serializeManifest, validateManifest, starterDoc, starterTitle, treeOf, withTree,
  type Manifest, type ManuscriptEntry, type Tree,
} from "@cadabracraft/format";
import { buildEpub, collectImageSources } from "@cadabracraft/export-epub";
import { buildDocx, type ManuscriptFont } from "@cadabracraft/export-docx";
import { renderAudiobook, type AudioFormat } from "@cadabracraft/export-audio";
import { bookToMarkdown, chapterToMarkdown, MarkdownExportError } from "@cadabracraft/export-markdown";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import { renderPdf, type TrimSize } from "@cadabracraft/export-pdf";
import { countWords, type ChapterDoc, type MatterKind } from "@cadabracraft/shared";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate } from "@cadabracraft/templates";
import { bridge } from "../lib/bridge";
import { mergeAdjacentText } from "../editor/findHelpers";
import { replaceInDoc, type BookSearchOptions } from "../editor/search/bookSearch";
import { runImport, type ImportChoices, type ImportReport } from "./importBook";
import { describePdfError } from "../lib/pdfErrors";
import { describeEpubError } from "../lib/epubErrors";
import { createTauriRunner } from "../lib/typstRunner";
import { createTauriAudioRunner, mapAudioError } from "../lib/audioRunner";
import { describeAudioError, type AudioUiError } from "../lib/audioErrors";
import { errText } from "../lib/projectError";
import { useSettings } from "./editorPrefs";

const emptyDoc = (title: string): ChapterDoc => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, { type: "paragraph" }],
});

export interface PdfExportOptions {
  trimSize: TrimSize;
  pdfA: boolean;
  /** Template id; saved in the manifest when it differs from the current one. */
  template: string;
  /** Put the book's cover (if it has one) first, as a full-page image. Default true. */
  cover?: boolean;
  /** User-configured location of the typst program (an app preference, never stored in the project). */
  typstPath?: string;
}

export interface AudioExportOptions {
  voice: string;
  /** 0.5 to 2; 1 is normal. */
  speed: number;
  formats: AudioFormat[];
  /** Only these chapters (default: every chapter, not front or back matter). */
  chapterIds?: string[];
}

export interface AudioChapterState {
  id: string;
  title: string;
  state: "waiting" | "rendering" | "done" | "empty" | "failed";
  /** 0..1 while rendering. */
  progress: number;
}

/** The audiobook export in progress or just finished. It lives in the store, not the dialog, so the dialog can close while it runs. */
export interface AudioJob {
  status: "running" | "done" | "error";
  chapters: AudioChapterState[];
  /** 0..1 across all chapters. */
  overall: number;
  /** Cancel was pressed and the engine is being stopped. */
  cancelling: boolean;
  durationSec: number;
  files: number;
  error: AudioUiError | null;
}

/** A voice download in progress or just failed. It lives in the store so the dialog can be closed and reopened while it runs. */
export interface VoiceDownload {
  status: "running" | "error";
  /** Bytes present of everything being downloaded. */
  done: number;
  total: number;
  cancelling: boolean;
  error: AudioUiError | null;
}

/** A page in the project trash, with a title for the list. */
export interface TrashItem {
  path: string;
  original: string;
  title: string;
  /** `YYYYMMDD-HHMM` (UTC). */
  trashedAt: string;
}

/** The first heading's text, else the first text found, else the file name without its number prefix and extension. */
function titleOfDoc(doc: unknown, file: string): string {
  const texts = (n: unknown): string => {
    const { text, content } = (n ?? {}) as { text?: unknown; content?: unknown };
    return typeof text === "string" ? text : Array.isArray(content) ? content.map(texts).join("") : "";
  };
  const raw = (doc as { content?: unknown } | null)?.content;
  const nodes: unknown[] = Array.isArray(raw) ? raw : [];
  const found = [nodes.find((n) => (n as { type?: unknown } | null)?.type === "heading"), ...nodes].map((n) => texts(n).trim()).find((x) => x);
  return found?.slice(0, 80) || (file.split("/").pop() ?? file).replace(/\.json$/, "").replace(/^\d+-/, "");
}

/**
 * One undoable chapter-tree edit: the tree before and after, and the page file it created or removed (if any).
 * Plain data. While the file is in the trash, `trashPath` says where, so undo and redo can move it back.
 */
export interface HistoryEntry {
  label: string;
  before: Tree;
  after: Tree;
  /** `added`: the edit made the page exist (add, add page, restore); otherwise it moved the page to the trash. */
  file?: { path: string; added: boolean };
  trashPath?: string;
  /** A text edit across pages (Replace all in the whole book): the pages' file text before and after. `before` and `after` trees are equal. */
  docs?: { file: string; before: string; after: string }[];
}

export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

const NO_HISTORY: History = { undo: [], redo: [] };
const HISTORY_LIMIT = 100;

/** Rewrites every mention of page file `from` as `to` (a restored page that had to take another name). */
function retargetEntry(e: HistoryEntry, from: string, to: string): HistoryEntry {
  return { ...e, before: retargetFile(e.before, from, to), after: retargetFile(e.after, from, to), ...(e.file?.path === from ? { file: { ...e.file, path: to } } : {}) };
}

/** The book fields the Book details dialog edits. */
/** A page whose newest snapshot is newer than the saved page and differs from it (see `find_stale_pages`). */
export interface Recovery {
  id: string;
  title: string;
  file: string;
  /** Project-relative path of the newer snapshot. */
  snapshot: string;
}

export interface BookDetails {
  title: string;
  author: string;
  language: string;
  isbn: string;
  identifier: string;
  cover: string | null;
}

/** Cover images the exporters can place: png, jpg, jpeg and webp (not gif or svg). */
export const COVER_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export type PdfStage = "preparing" | "rendering" | "saving";

/** A page of the book in reading order, with its chapter document. */
export interface BookPage {
  id: string;
  title: string;
  doc: ChapterDoc;
  section: "front" | "chapter" | "back";
  kind?: MatterKind;
}

interface State {
  root: string | null;
  manifest: Manifest | null;
  currentId: string | null;
  /** Loaded content of the current chapter; the editor owns edits until saveCurrent. */
  currentDoc: ChapterDoc | null;
  notice: string;
  hashes: Record<string, string>;
  /** Unsaved editor content for the current chapter; flushed before switching chapters or exporting. */
  draft: ChapterDoc | null;
  /** Bumped when the current chapter is reloaded from disk so the editor remounts with the new content. */
  reloadCount: number;
  /** Result of the last import, shown in a dialog until dismissed. */
  importReport: ImportReport | null;
  /** Set while an EPUB or PDF export runs. */
  exportStage: PdfStage | null;
  /** The audiobook export (running, finished or failed); null when none has run or it was dismissed. */
  audio: AudioJob | null;
  /** The voice download (running, or failed and waiting for a retry); null when none is active. */
  voiceDownload: VoiceDownload | null;
  /** Restorable pages in the project trash, newest first (filled by `refreshTrash`). */
  trash: TrashItem[];
  /** Undo and redo stacks for chapter-tree edits (the editor's own text undo is separate). Cleared on open and external reload. */
  history: History;
  /** Pages offered for recovery when the book was opened, one dialog at a time; entries leave when restored or dismissed. */
  recovery: Recovery[];
  actions: {
    /** Reverts the latest chapter-tree edit (add, rename, move, trash, add page, restore). Added pages go to the trash, trashed pages come back from it. Resolves to false when there is nothing to undo or it failed (see `notice`). */
    undo: () => Promise<boolean>;
    redo: () => Promise<boolean>;
    /** Reloads `trash` from the project folder. */
    refreshTrash: () => Promise<void>;
    /** Moves a trashed page back, adds it to the end of its section and opens it. Never overwrites an existing page (a taken file name gets a `-2` suffix). */
    restoreTrash: (path: string) => Promise<void>;
    /** Puts an earlier version of a page back and opens the page. The text it replaces is kept as a snapshot first, so this can be undone from History. */
    restoreSnapshot: (id: string, snapshot: string) => Promise<void>;
    /** Stops offering a page for recovery until the book is opened again. */
    dismissRecovery: (id: string) => void;
    /** Saves unsaved typing, if any, without reloading the chapter. */
    flush: () => Promise<void>;
    externalChange: (path: string) => Promise<void>;
    setDraft: (doc: ChapterDoc) => void;
    openProject: (root: string) => Promise<void>;
    /** Saves unsaved typing, then leaves the open book (back to the start screen). Nothing on disk changes. */
    closeProject: () => Promise<void>;
    createProject: (root: string, title: string, author: string) => Promise<void>;
    /** Opens any page (front matter, chapter or back matter) in the editor. */
    selectChapter: (id: string) => Promise<void>;
    saveCurrent: (doc: ChapterDoc) => Promise<void>;
    add: (title: string) => Promise<void>;
    /** Adds a front or back matter page of `kind` with generated starter content and opens it. Throws when a limited kind (title page, copyright) already exists. */
    addMatter: (section: "front" | "back", kind: MatterKind, title?: string) => Promise<void>;
    /** Rename, move and remove work on chapters, front matter and back matter alike (`id` decides). */
    rename: (id: string, title: string) => Promise<void>;
    move: (id: string, delta: number) => Promise<void>;
    remove: (id: string) => Promise<void>;
    /** Every page in reading order with its chapter document, for previews and checks. Reads the files from disk; unsaved typing is flushed first. */
    readPages: () => Promise<BookPage[]>;
    /** Words in all chapters (front and back matter excluded). Pages whose file is unchanged since they were last counted are not read again; the open page is counted from memory. */
    bookWords: () => Promise<number>;
    /**
     * Replaces every match in every page (front and back matter too) and returns how many were replaced. Saves unsaved
     * typing first, writes the changed pages through the normal save path (backup, temp file and rename), reloads the open
     * page, and records ONE book undo step (Undo/Redo, Mod+Alt+Z) that restores or reapplies all of those pages.
     */
    replaceInBook: (opts: BookSearchOptions, replacement: string) => Promise<number>;
    /** Sets the book's template (cadabra.json). A no-op when it is already set. */
    setTemplate: (id: string) => Promise<void>;
    /** Saves the book details (cadabra.json). Trims text; an empty ISBN becomes null. Throws (a message for the author) when the title, author, language or identifier is empty or the cover is not an `assets/` image. */
    updateDetails: (details: BookDetails) => Promise<void>;
    /** Asks for a cover image (png, jpg or webp), copies it into assets/ and returns `assets/<name>`. Null if cancelled or refused (refusals set `notice`). Does not change the manifest. */
    importCover: () => Promise<string | null>;
    exportEpub: () => Promise<void>;
    /** Writes the whole book as exports/book.md. With `htmlMarks` false it throws `MarkdownExportError` (naming the chapter) at the first underline, small caps, superscript or subscript. */
    exportMarkdown: (options: { htmlMarks: boolean }) => Promise<void>;
    /** Writes the whole book as exports/manuscript.docx in standard manuscript format. Throws a `DocxExportError` message that names the page (and node) it cannot write. */
    exportDocx: (options: { font: ManuscriptFont }) => Promise<void>;
    /** Builds exports/book.pdf with Typst. Throws `PdfUiError` (message for the author, `code` for the dialog). */
    exportPdf: (options: PdfExportOptions) => Promise<void>;
    /**
     * Reads every chapter aloud with a local voice into exports/audio/, one chapter at a time on a worker thread (the page stays
     * responsive). Progress and the outcome are in `audio`; a render failure does not throw, it sets `audio.error` (and `audio.status`).
     * Throws only when it cannot start: another export is running, or the book has no chapters.
     */
    exportAudio: (options: AudioExportOptions) => Promise<void>;
    /**
     * Downloads the given voice packs (skipping files already there; a stopped or failed download resumes). Progress and failure are
     * in `voiceDownload`. Resolves true when every pack finished; false when it was stopped or failed (not an exception).
     */
    downloadVoices: (packs: { id: string; bytes: number }[]) => Promise<boolean>;
    /** Stops the voice download; what was fetched is kept for a retry. */
    cancelVoiceDownload: () => void;
    /** Clears a failed or stopped voice download. A running one is left alone. */
    dismissVoiceDownload: () => void;
    /** Stops the audiobook: the engine is killed and finished chapters are kept. */
    cancelAudio: () => void;
    /** Clears a finished or failed audiobook from `audio`. A running one is left alone. */
    dismissAudio: () => void;
    /** Asks for an image file, copies it into assets/, and returns `assets/<name>` (null if cancelled or refused; refusals set `notice`). */
    importImage: () => Promise<string | null>;
    /** Imports a .docx/.md file into a NEW project in `root` (the source is only read), opens it and sets `importReport`. Throws, having created nothing, when the file cannot be imported. */
    importBook: (sourcePath: string, root: string, title: string, author: string, opts?: ImportChoices) => Promise<void>;
    dismissImportReport: () => void;
  };
}

/** How long typing may sit unsaved before it is written to disk. */
export const AUTOSAVE_MS = 2000;

/** Parses a chapter file's text and checks it against the editor schema. Throws (a message for the author) for corrupt files; the file is never touched. */
function parseChapter(contents: string, file: string): ChapterDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error(t`${file} is not valid JSON, so it was not opened. The file was left untouched.`);
  }
  if (!isChapterDoc(raw)) throw new Error(t`${file} is not a valid chapter, so it was not opened. The file was left untouched.`);
  return raw;
}

/** Runs housekeeping that must never stop a book from opening: any failure (rejected or thrown) gives `fallback`. */
async function bestEffort<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

/** A group of page writes failed; `stuck` are the pages that were written and could not be put back. */
class PartialWrite extends Error {
  constructor(message: string, readonly stuck: { file: string; from: string; to: string }[]) { super(message); }
}

export const useProject = create<State>((set, get) => {
  /** A book-wide replace is running: a second one is ignored instead of racing it. */
  let replacing = false;
  let importing = false;
  let audioAbort: AbortController | null = null;
  let voiceAbort: AbortController | null = null;
  const need = () => {
    const { root, manifest } = get();
    if (!root || !manifest) throw new Error("no project open");
    return { root, manifest };
  };
  const entryOf = (manifest: Manifest, id: string): ManuscriptEntry | undefined => readingOrder(manifest).find((e) => e.id === id);
  const saveManifest = async (manifest: Manifest) => {
    const { root } = need();
    const base = get().hashes["cadabra.json"] ?? null;
    const w = await bridge.writeFile(root, "cadabra.json", serializeManifest(manifest), base);
    set({ manifest, hashes: { ...get().hashes, "cadabra.json": w.hash }, notice: w.conflict_copy ? t`cadabra.json changed outside the app; your previous copy was kept as ${w.conflict_copy}` : get().notice });
  };
  /** Remembers a finished tree edit. A new edit drops the redo stack. */
  const record = (entry: Omit<HistoryEntry, "before" | "after">, before: Manifest, after: Manifest) => {
    const tree = { before: treeOf(before), after: treeOf(after) };
    if (sameTree(tree.before, tree.after)) return; // e.g. moving the first page up
    set({ history: { undo: [...get().history.undo, { ...entry, ...tree }].slice(-HISTORY_LIMIT), redo: [] } });
  };
  let historyBusy = false;
  /** Writes a page's file text through the normal save path (backup, temp file and rename in the Rust layer). */
  const writePage = async (file: string, contents: string) => {
    const { root } = need();
    const w = await bridge.writeFile(root, file, contents, get().hashes[file] ?? null);
    set({ hashes: { ...get().hashes, [file]: w.hash }, ...(w.conflict_copy ? { notice: t`${file} changed outside the app; the other version was kept as ${w.conflict_copy}` } : {}) });
    return w.conflict_copy ? t`${file} changed outside the app; the other version was kept as ${w.conflict_copy}` : null;
  };
  /**
   * Writes several pages as a group: when one write fails, the pages already written are put back, so a failure does
   * not leave the book half changed. Throws a `PartialWrite` naming the pages that could not be put back (empty when
   * everything was restored). Returns the conflict messages of pages that changed outside the app.
   */
  const writePages = async (pages: { file: string; from: string; to: string }[]): Promise<string[]> => {
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
        try { await writePage(p.file, p.from); } catch { stuck.push(p); }
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
      if (entry.docs) {
        // A text edit across pages: write each page's saved text back (no tree change).
        // Pages removed from the book since (trashed) are skipped: writing them would bring back a file the book no longer lists.
        const listed = new Set(readingOrder(need().manifest).map((e) => e.file));
        const live = entry.docs.filter((d) => listed.has(d.file));
        const skipped = entry.docs.length - live.length;
        const conflicts = await writePages(live.map((d) => ({ file: d.file, from: undoing ? d.after : d.before, to: undoing ? d.before : d.after })));
        const { history } = get();
        const kept = history[from].slice(0, -1);
        const other = undoing ? history.redo : history.undo;
        set({ history: undoing ? { undo: kept, redo: [...other, entry] } : { undo: [...other, entry], redo: kept } });
        await reloadCurrent();
        const done = undoing ? t`Undid: ${entry.label}` : t`Redid: ${entry.label}`;
        const skip = skipped ? plural(skipped, { one: "# page is no longer in the book and was left out", other: "# pages are no longer in the book and were left out" }) : "";
        set({ notice: [done, skip, ...conflicts].filter(Boolean).join(". ") });
        return true;
      }
      let target = undoing ? entry.before : entry.after;
      const present = entry.file ? entry.file.added !== undoing : false; // should the page file exist when we are done?
      let file = entry.file?.path;
      let trashPath = entry.trashPath;
      // Files first when bringing one back, manifest first when sending one away: the manifest never names a missing file.
      if (file && present) {
        if (!trashPath) throw new Error(t`the page is no longer in the trash`);
        const back = await bridge.restoreTrash(root, trashPath); // comes back as -2 when its name was taken since
        if (back !== file) target = retargetFile(target, file, back);
        file = back;
        trashPath = undefined;
      }
      await saveManifest(withTree(need().manifest, target));
      if (file && !present) trashPath = await bridge.trashFile(root, file); // never a hard delete
      const was = entry.file?.path;
      const fix = (e: HistoryEntry) => (was && file && was !== file ? retargetEntry(e, was, file) : e);
      const { history } = get();
      const { trashPath: _old, ...rest } = fix(entry);
      const moved: HistoryEntry = trashPath ? { ...rest, trashPath } : rest;
      const kept = history[from].slice(0, -1).map(fix);
      const other = (undoing ? history.redo : history.undo).map(fix);
      set({ history: undoing ? { undo: kept, redo: [...other, moved] } : { undo: [...other, moved], redo: kept } });
      // Show a page that came back; otherwise keep the open page unless it no longer exists.
      const next = need().manifest;
      const shown = file && present ? readingOrder(next).find((e) => e.file === file) : undefined;
      const cur = get().currentId;
      if (shown) await load(shown.id);
      else if (cur && !entryOf(next, cur)) {
        set({ currentId: null, currentDoc: null });
        const fallback = next.chapters[0] ?? readingOrder(next)[0];
        if (fallback) await load(fallback.id);
      }
      set({ notice: undoing ? t`Undid: ${entry.label}` : t`Redid: ${entry.label}` });
      if (get().trash.length) void get().actions.refreshTrash().catch(() => {});
      return true;
    } catch (e) {
      const why = errText(e);
      const stuck = e instanceof PartialWrite ? e.stuck.length : 0;
      const base = from === "undo" ? t`Could not undo: ${why}` : t`Could not redo: ${why}`;
      set({ notice: stuck ? `${base}. ${plural(stuck, { one: "# page could not be put back and is now in the other state", other: "# pages could not be put back and are now in the other state" })}` : base });
      return false;
    } finally {
      historyBusy = false;
    }
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
    const tail: Promise<void> = run.then(() => {}, () => {}).then(() => { if (flushTail === tail) flushTail = null; });
    flushTail = tail;
    return run;
  };
  let autosave: ReturnType<typeof setTimeout> | undefined;
  const load = async (id: string) => {
    await flush();
    const { root, manifest } = need();
    const entry = entryOf(manifest, id);
    if (!entry) return;
    const r = await bridge.readFile(root, entry.file);
    let doc: ChapterDoc;
    try {
      doc = r ? parseChapter(r.contents, entry.file) : emptyDoc(entry.title);
    } catch (e) {
      // Show no editor for a corrupt page, so nothing can be typed over it and saved.
      set({ currentId: null, currentDoc: null, draft: null, notice: errText(e) });
      return;
    }
    set({ currentId: id, currentDoc: doc, draft: null, hashes: r ? { ...get().hashes, [entry.file]: r.hash } : get().hashes });
  };

  /** Every page in reading order (front matter, chapters, back matter), read from disk. */
  const loadChapters = async () => {
    const { root, manifest } = need();
    const pages = [];
    const sectionFor = (e: ManuscriptEntry) => sectionOf(manifest, e.id) ?? "chapter";
    for (const c of readingOrder(manifest)) {
      const r = await bridge.readFile(root, c.file);
      if (!r) throw new Error(t`Missing chapter file ${c.file}`);
      pages.push({ id: c.id, title: c.title, doc: parseChapter(r.contents, c.file), section: sectionFor(c), ...(c.kind ? { kind: c.kind } : {}) });
    }
    return pages;
  };
  /** Word count per chapter file, valid while the store's hash for that file is the one it was counted under. */
  let wordCache = new Map<string, { hash: string | undefined; words: number }>();
  /** Words in the book's chapters, reading only pages that changed since they were last counted. The open page is counted from the draft or the loaded doc. */
  const countBook = async () => {
    const { root, manifest } = need();
    const currentId = get().currentId;
    let total = 0;
    for (const c of readingOrder(manifest)) {
      if (sectionOf(manifest, c.id) !== "chapter") continue;
      if (c.id === currentId) {
        const open = get().draft ?? get().currentDoc;
        if (open) { total += countWords(open); continue; }
      }
      const hash = get().hashes[c.file];
      const hit = wordCache.get(c.file);
      if (hit && hit.hash === hash) { total += hit.words; continue; }
      const r = await bridge.readFile(root, c.file);
      if (!r) throw new Error(t`Missing chapter file ${c.file}`);
      const words = countWords(parseChapter(r.contents, c.file));
      wordCache.set(c.file, { hash, words });
      total += words;
    }
    return total;
  };
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
  const loadCover = async (): Promise<{ path: string; bytes: Uint8Array } | undefined> => {
    const { root, manifest } = need();
    if (!manifest.cover) return undefined;
    try {
      return { path: manifest.cover, bytes: await bridge.readAsset(root, manifest.cover) };
    } catch {
      throw new Error(t`The cover image ${manifest.cover} could not be read. Choose it again in Book details, or remove the cover.`);
    }
  };

  return {
    root: null, manifest: null, currentId: null, currentDoc: null, notice: "", hashes: {}, draft: null, reloadCount: 0, importReport: null, exportStage: null, audio: null, voiceDownload: null, trash: [], history: NO_HISTORY, recovery: [],
    actions: {
      flush,
      undo: () => travel("undo"),
      redo: () => travel("redo"),
      async refreshTrash() {
        const { root } = need();
        const entries = await bridge.listTrash(root);
        const trash: TrashItem[] = [];
        for (const e of entries) {
          const r = await bridge.readFile(root, e.path).catch(() => null);
          let doc: unknown = null;
          try { doc = r ? JSON.parse(r.contents) : null; } catch { /* unreadable page: the title falls back to the file name */ }
          trash.push({ path: e.path, original: e.original, title: titleOfDoc(doc, e.original), trashedAt: e.trashed_at });
        }
        if (get().root === root) set({ trash });
      },
      async restoreSnapshot(id, snapshot) {
        await flush();
        const { root, manifest } = need();
        const entry = entryOf(manifest, id);
        if (!entry) return;
        const w = await bridge.restoreSnapshot(root, entry.file, snapshot);
        set({ hashes: { ...get().hashes, [entry.file]: w.hash }, recovery: get().recovery.filter((r) => r.id !== id) });
        if (get().currentId === id) await reloadCurrent();
        else await load(id);
        set({ notice: t`Restored an earlier version of ${entry.title}. The text it replaced is kept in History.` });
      },
      dismissRecovery(id) {
        set({ recovery: get().recovery.filter((r) => r.id !== id) });
      },
      async restoreTrash(path) {
        await flush();
        const { root, manifest } = need();
        const file = await bridge.restoreTrash(root, path);
        const r = await bridge.readFile(root, file);
        let doc: unknown = null;
        try { doc = r ? JSON.parse(r.contents) : null; } catch { /* keep the file; the title falls back to its name */ }
        const { manifest: next, entry } = restoreEntry(manifest, file, titleOfDoc(doc, file));
        if (r) set({ hashes: { ...get().hashes, [file]: r.hash } });
        await saveManifest(next);
        record({ label: t`Restore ${entry.title}`, file: { path: file, added: true } }, manifest, next);
        set({ trash: get().trash.filter((x) => x.path !== path) });
        await load(entry.id);
      },
      async externalChange(path) {
        const { root, manifest, hashes } = get();
        if (!root || !manifest) return;
        const r = await bridge.readFile(root, path).catch(() => null);
        if (!r || r.hash === hashes[path]) return; // gone, unreadable, or our own write
        wordCache.delete(path);
        if (path === "cadabra.json") {
          try {
            set({ manifest: parseManifest(r.contents).manifest, hashes: { ...get().hashes, [path]: r.hash }, history: NO_HISTORY, notice: t`Chapter list updated from outside the app` });
          } catch {
            set({ notice: t`cadabra.json was changed outside the app and could not be read; saving will keep a copy of that version` });
          }
          return;
        }
        const entry = readingOrder(manifest).find((c) => c.file === path);
        if (!entry || entry.id !== get().currentId) return; // other chapters load fresh when opened
        if (get().draft) {
          set({ notice: t`${entry.title} changed outside the app; saving will keep both versions` });
          return;
        }
        let doc: ChapterDoc;
        try {
          doc = parseChapter(r.contents, path);
        } catch (e) {
          // Keep what is open and its old hash, so a later save keeps the unreadable version as a conflict copy instead of replacing it silently.
          set({ notice: errText(e) });
          return;
        }
        set({ currentDoc: doc, hashes: { ...get().hashes, [path]: r.hash }, reloadCount: get().reloadCount + 1, notice: t`${entry.title} was updated from outside the app` });
      },
      setDraft(doc) {
        set({ draft: doc });
        clearTimeout(autosave);
        autosave = setTimeout(() => {
          flush().catch((e) => set({ notice: t`Could not save: ${errText(e)}` }));
        }, AUTOSAVE_MS);
      },
      async openProject(root) {
        await flush(); // typing in the book being left
        const r = await bridge.readFile(root, "cadabra.json");
        if (!r) throw new Error(t`No cadabra.json in that folder`);
        const parsed = parseManifest(r.contents);
        wordCache = new Map();
        set({ root, manifest: parsed.manifest, hashes: { "cadabra.json": r.hash }, currentId: null, currentDoc: null, notice: "", history: NO_HISTORY, trash: [], recovery: [] });
        const pageFiles = readingOrder(parsed.manifest).map((e) => e.file);
        // Offered before any page is opened: a page that was put back to older text by a sync folder is easy to miss otherwise.
        const stale = await bestEffort(() => bridge.findStalePages(root, pageFiles), []);
        const recovery = stale.flatMap((x) => { const e = readingOrder(parsed.manifest).find((m) => m.file === x.path); return e ? [{ id: e.id, title: e.title, file: e.file, snapshot: x.snapshot }] : []; });
        set({ recovery });
        if (parsed.migrated) {
          const backup = await bridge.backupManifest(root);
          await saveManifest(parsed.manifest);
          set({ notice: t`Project upgraded from format ${parsed.fromVersion}; backup saved to ${backup}` });
        }
        const first = parsed.manifest.chapters[0] ?? readingOrder(parsed.manifest)[0];
        if (first) await load(first.id);
        await bridge.watchProject(root);
        void bestEffort(() => bridge.pruneSnapshots(root, pageFiles, useSettings.getState().snapshotKeep), 0);
      },
      async closeProject() {
        await flush();
        wordCache = new Map();
        set({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", history: NO_HISTORY, trash: [], recovery: [], importReport: null, audio: null });
      },
      async createProject(root, title, author) {
        const manifest = createManifest({ title, author, language: i18n.locale === "pseudo" ? "en" : i18n.locale, identifier: `urn:uuid:${crypto.randomUUID()}` });
        await bridge.createProject(root, serializeManifest(manifest));
        await get().actions.openProject(root);
        await get().actions.add(t`Chapter One`);
        set({ history: NO_HISTORY }); // the first chapter is part of creating the book
      },
      selectChapter: load,
      async saveCurrent(doc) {
        const { root, manifest } = need();
        const entry = entryOf(manifest, get().currentId ?? "");
        if (!entry) return;
        const w = await bridge.writeFile(root, entry.file, JSON.stringify(doc, null, 2), get().hashes[entry.file] ?? null);
        set({ hashes: { ...get().hashes, [entry.file]: w.hash }, notice: w.conflict_copy ? t`${entry.title} changed outside the app; the other version was kept as ${w.conflict_copy}` : t`Saved` });
      },
      async add(title) {
        await flush();
        const { root, manifest } = need();
        const { manifest: next, entry } = addChapter(manifest, title);
        const w = await bridge.writeFile(root, entry.file, JSON.stringify(emptyDoc(title), null, 2), null);
        set({ hashes: { ...get().hashes, [entry.file]: w.hash } });
        await saveManifest(next);
        record({ label: t`Add ${title}`, file: { path: entry.file, added: true } }, manifest, next);
        await load(entry.id);
      },
      async addMatter(section, kind, title) {
        await flush();
        const { root, manifest } = need();
        const name = title ?? starterTitle(kind, manifest.language);
        const { manifest: next, entry } = (section === "front" ? addFrontMatter : addBackMatter)(manifest, kind, name);
        const doc = starterDoc(kind, { title: manifest.title, author: manifest.author, language: manifest.language, isbn: manifest.isbn, year: new Date().getFullYear() });
        const w = await bridge.writeFile(root, entry.file, JSON.stringify(doc, null, 2), null);
        set({ hashes: { ...get().hashes, [entry.file]: w.hash } });
        await saveManifest(next);
        record({ label: t`Add ${name}`, file: { path: entry.file, added: true } }, manifest, next);
        await load(entry.id);
      },
      async rename(id, title) {
        const m = need().manifest;
        const next = sectionOf(m, id) === "chapter" ? renameChapter(m, id, title) : renameMatter(m, id, title);
        await saveManifest(next);
        record({ label: t`Rename ${entryOf(m, id)?.title ?? ""}` }, m, next);
      },
      async move(id, delta) {
        const m = need().manifest;
        const next = sectionOf(m, id) === "chapter" ? moveChapter(m, id, delta) : moveMatter(m, id, delta);
        await saveManifest(next);
        record({ label: t`Move ${entryOf(m, id)?.title ?? ""}` }, m, next);
      },
      async remove(id) {
        const { root, manifest } = need();
        const currentId = get().currentId;
        const { manifest: next, removed } = sectionOf(manifest, id) === "chapter" ? removeChapter(manifest, id) : removeMatter(manifest, id);
        await saveManifest(next);
        const trashPath = await bridge.trashFile(root, removed.file); // moved to .cadabra/trash, never permanently deleted
        record({ label: t`Move ${removed.title} to trash`, file: { path: removed.file, added: false }, trashPath }, manifest, next);
        if (currentId === id) {
          set({ currentId: null, currentDoc: null });
          const fallback = next.chapters[0] ?? readingOrder(next)[0];
          if (fallback) await load(fallback.id);
        }
      },
      async bookWords() {
        return countBook();
      },
      async readPages() {
        await flush();
        return loadChapters();
      },
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
          if (get().draft) throw new Error(t`The page changed while searching, so nothing was replaced. Try again.`);
          for (const page of pages) {
            const r = replaceInDoc(page.doc, opts, replacement);
            if (!r.count) continue;
            const file = entryOf(manifest, page.id)?.file;
            if (!file) continue;
            count += r.count;
            docs.push({ file, before: JSON.stringify(page.doc, null, 2), after: JSON.stringify(mergeAdjacentText(r.doc), null, 2) });
          }
          if (!docs.length) return 0;
          const tree = treeOf(manifest);
          const record = (list: typeof docs) => set({ history: { undo: [...get().history.undo, { label: t`Replace all “${opts.query}”`, before: tree, after: tree, docs: list }].slice(-HISTORY_LIMIT), redo: [] } });
          let conflicts: string[];
          try {
            conflicts = await writePages(docs.map((d) => ({ file: d.file, from: d.before, to: d.after })));
          } catch (e) {
            const why = errText(e);
            const stuck = e instanceof PartialWrite ? e.stuck : [];
            if (!stuck.length) throw new Error(t`Replace all stopped: ${why}. Nothing was changed.`);
            // Some pages could not be put back: keep one undo step for exactly those, so Undo finishes the job.
            record(docs.filter((d) => stuck.some((p) => p.file === d.file)));
            await reloadCurrent().catch(() => {});
            throw new Error(`${t`Replace all stopped: ${why}.`} ${plural(stuck.length, { one: "# page could not be put back and keeps the replacement; Undo restores it.", other: "# pages could not be put back and keep the replacement; Undo restores them." })}`);
          }
          record(docs);
          await reloadCurrent();
          set({ notice: [t`Replaced ${count} in the book`, ...conflicts].join(". ") });
          return count;
        } finally {
          replacing = false;
        }
      },
      async setTemplate(id) {
        const { manifest } = need();
        if (manifest.template === id) return;
        await saveManifest({ ...manifest, template: id });
      },
      async updateDetails(d) {
        const { manifest } = need();
        const next: Manifest = {
          ...manifest,
          title: d.title.trim(),
          author: d.author.trim(),
          language: d.language.trim(),
          identifier: d.identifier.trim(),
          isbn: d.isbn.trim() || null,
          cover: d.cover,
        };
        // validateManifest owns the rules; it names the field, which is enough for the dialog to show.
        validateManifest(next);
        if (JSON.stringify(next) === JSON.stringify(manifest)) return;
        await saveManifest(next);
      },
      async importCover() {
        const { root } = need();
        const picked = await bridge.pickImage();
        if (!picked) return null;
        const ext = picked.split(".").pop()?.toLowerCase() ?? "";
        if (!COVER_EXTENSIONS.includes(ext)) {
          set({ notice: t`A cover must be a PNG, JPEG or WebP image.` });
          return null;
        }
        try {
          return await bridge.importAsset(root, picked);
        } catch (e) {
          set({ notice: t`Could not add the cover: ${errText(e)}` });
          return null;
        }
      },
      async exportEpub() {
        if (get().exportStage) throw new Error(t`An export is already running`);
        set({ exportStage: "preparing" });
        try {
          await flush();
          const { root, manifest } = need();
          const chapters = await loadChapters();
          const assets = await loadAssets(chapters);
          const cover = await loadCover();
          set({ exportStage: "rendering" });
          const bytes = buildEpub({ title: manifest.title, author: manifest.author, language: manifest.language, identifier: manifest.identifier, isbn: manifest.isbn, modified: new Date() }, chapters, { assets, cover, css: getTemplate(hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID).epub.css });
          set({ exportStage: "saving" });
          await bridge.writeBytes(root, "exports/book.epub", bytes);
          set({ notice: t`Exported exports/book.epub` });
        } catch (e) {
          const manifest = get().manifest;
          throw describeEpubError(e, (id) => (manifest ? entryOf(manifest, id)?.file : undefined));
        } finally {
          set({ exportStage: null });
        }
      },
      async exportMarkdown({ htmlMarks }) {
        if (get().exportStage) throw new Error(t`An export is already running`);
        set({ exportStage: "preparing" });
        try {
          await flush();
          const { root, manifest } = need();
          const chapters = await loadChapters();
          // An empty book would write an empty file and still report success.
          if (!chapters.length) throw new Error(t`The book has no pages to export yet. Add a chapter first.`);
          set({ exportStage: "rendering" });
          const opts = { htmlMarks, imageBase: "../" };
          let markdown: string;
          try {
            markdown = bookToMarkdown({ title: manifest.title, author: manifest.author }, chapters, opts);
          } catch (e) {
            if (!(e instanceof MarkdownExportError)) throw e;
            // The library's message does not say where; find the first page that fails so the author can.
            const bad = chapters.find((c) => { try { chapterToMarkdown(c.doc, opts); return false; } catch { return true; } });
            // A page with an empty title is named by its file instead.
            const where = bad ? bad.title.trim() || entryOf(manifest, bad.id)?.file || "" : "";
            throw new Error(where ? t`In “${where}”: ${e.message}` : e.message);
          }
          set({ exportStage: "saving" });
          await bridge.writeBytes(root, "exports/book.md", new TextEncoder().encode(markdown));
          set({ notice: t`Exported exports/book.md` });
        } finally {
          set({ exportStage: null });
        }
      },
      async exportDocx({ font }) {
        if (get().exportStage) throw new Error(t`An export is already running`);
        set({ exportStage: "preparing" });
        try {
          await flush();
          const { root, manifest } = need();
          const chapters = await loadChapters();
          // An empty book would write a title page only and still report success.
          if (!chapters.length) throw new Error(t`The book has no pages to export yet. Add a chapter first.`);
          const assets = await loadAssets(chapters);
          set({ exportStage: "rendering" });
          // A page with an empty title is named by its file in error messages.
          const pages = chapters.map((c) => ({ ...c, id: entryOf(manifest, c.id)?.file ?? c.id }));
          const bytes = buildDocx({ title: manifest.title, author: manifest.author, language: manifest.language }, pages, { assets, font, modified: new Date() });
          set({ exportStage: "saving" });
          await bridge.writeBytes(root, "exports/manuscript.docx", bytes);
          set({ notice: t`Exported exports/manuscript.docx` });
        } finally {
          set({ exportStage: null });
        }
      },
      async importBook(sourcePath, root, title, author, opts) {
        // Two imports at once would both write into a project and fight over which one opens.
        if (importing) throw new Error(t`An import is already running`);
        importing = true;
        try {
          await flush();
          const report = await runImport({ sourcePath, root, title, author, ...opts });
          await get().actions.openProject(root);
          set({ importReport: report });
        } finally {
          importing = false;
        }
      },
      dismissImportReport: () => set({ importReport: null }),
      async exportPdf(options) {
        if (get().exportStage) throw new Error(t`A PDF export is already running`);
        set({ exportStage: "preparing" });
        try {
          await flush();
          const { root, manifest } = need();
          const templateId = hasTemplate(options.template) ? options.template : DEFAULT_TEMPLATE_ID;
          const template = getTemplate(templateId);
          const chapters = await loadChapters();
          const assets = await loadAssets(chapters);
          const cover = options.cover === false ? undefined : await loadCover();
          if (cover) assets.set(cover.path, cover.bytes);
          set({ exportStage: "rendering" });
          const runner = createTauriRunner(bridge, options.typstPath);
          const { pdf } = await renderPdf(
            { title: manifest.title, author: manifest.author, language: manifest.language },
            chapters,
            { template, trimSize: options.trimSize, mirrored: true, pageNumbers: true, pdfA: options.pdfA, assets: Object.fromEntries(assets), ...(cover ? { cover: cover.path } : {}) },
            runner,
          );
          set({ exportStage: "saving" });
          await bridge.writeBytes(root, "exports/book.pdf", pdf);
          if (manifest.template !== templateId) await saveManifest({ ...need().manifest, template: templateId });
          set({ notice: t`Exported exports/book.pdf` });
        } catch (e) {
          throw describePdfError(e);
        } finally {
          set({ exportStage: null });
        }
      },
      async exportAudio(options) {
        if (get().audio?.status === "running" || get().exportStage) throw new Error(t`An export is already running`);
        await flush();
        const { root } = need();
        const pages = (await loadChapters()).filter((p) => p.section === "chapter" && (!options.chapterIds || options.chapterIds.includes(p.id)));
        if (pages.length === 0) throw new Error(t`The book has no chapters to read aloud yet. Add a chapter first.`);
        const jobId = crypto.randomUUID();
        const ctrl = new AbortController();
        audioAbort = ctrl;
        const update = (fn: (j: AudioJob) => AudioJob) => set((s) => (s.audio ? { audio: fn(s.audio) } : {}));
        const mark = (j: AudioJob, i: number, patch: Partial<AudioChapterState>) => j.chapters.map((c, k) => (k === i ? { ...c, ...patch } : c));
        set({ audio: { status: "running", chapters: pages.map((p) => ({ id: p.id, title: p.title, state: "waiting", progress: 0 })), overall: 0, cancelling: false, durationSec: 0, files: 0, error: null } });
        try {
          await renderAudiobook(
            pages.map(({ id, title, doc }) => ({ id, title, doc })),
            { voice: options.voice, speed: options.speed, formats: options.formats },
            createTauriAudioRunner(bridge, root, jobId),
            {
              onChapterStart: (i) => update((j) => ({ ...j, chapters: mark(j, i, { state: "rendering" }) })),
              onProgress: (p) => update((j) => ({ ...j, overall: p.overall, chapters: mark(j, p.chapterIndex, { progress: p.fraction }) })),
              onChapterDone: (i, r) => update((j) => ({ ...j, durationSec: j.durationSec + r.durationSec, files: j.files + r.files.length, chapters: mark(j, i, { state: r.status === "empty" ? "empty" : "done", progress: 1 }) })),
            },
            ctrl.signal,
          );
          update((j) => ({ ...j, status: "done", overall: 1 }));
          set({ notice: t`Exported the audiobook to exports/audio` });
        } catch (e) {
          const error = describeAudioError(e);
          update((j) => ({ ...j, status: "error", error, chapters: error.chapterIndex === undefined ? j.chapters : mark(j, error.chapterIndex, { state: "failed" }) }));
        } finally {
          audioAbort = null;
          bridge.audioForget(jobId).catch(() => undefined);
        }
      },
      async downloadVoices(packs) {
        if (get().voiceDownload?.status === "running") throw new Error(t`A download is already running`);
        const total = packs.reduce((n, p) => n + p.bytes, 0);
        const jobId = crypto.randomUUID();
        const ctrl = new AbortController();
        voiceAbort = ctrl;
        const update = (patch: Partial<VoiceDownload>) => set((s) => (s.voiceDownload ? { voiceDownload: { ...s.voiceDownload, ...patch } } : {}));
        set({ voiceDownload: { status: "running", done: 0, total, cancelling: false, error: null } });
        const stop = () => void bridge.audioCancel(jobId).catch(() => undefined);
        ctrl.signal.addEventListener("abort", stop, { once: true });
        let before = 0;
        try {
          for (const pack of packs) {
            await bridge.audioDownloadPack(pack.id, jobId, (p) => update({ done: before + p.done })).catch((e) => { throw mapAudioError(e); });
            before += pack.bytes;
          }
          set({ voiceDownload: null });
          return true;
        } catch (e) {
          update({ status: "error", error: describeAudioError(e) });
          return false;
        } finally {
          voiceAbort = null;
          bridge.audioForget(jobId).catch(() => undefined);
        }
      },
      cancelVoiceDownload() {
        if (!voiceAbort) return;
        set((s) => (s.voiceDownload ? { voiceDownload: { ...s.voiceDownload, cancelling: true } } : {}));
        voiceAbort.abort();
      },
      dismissVoiceDownload() {
        if (get().voiceDownload?.status !== "running") set({ voiceDownload: null });
      },
      cancelAudio() {
        if (!audioAbort) return;
        set((s) => (s.audio ? { audio: { ...s.audio, cancelling: true } } : {}));
        audioAbort.abort();
      },
      dismissAudio() {
        if (get().audio?.status !== "running") set({ audio: null });
      },
      async importImage() {
        const { root } = need();
        const picked = await bridge.pickImage();
        if (!picked) return null;
        try {
          return await bridge.importAsset(root, picked);
        } catch (e) {
          set({ notice: t`Could not add the image: ${errText(e)}` });
          return null;
        }
      },
    },
  };
});
