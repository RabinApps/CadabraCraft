import { create } from "zustand";
import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  addBackMatter, addChapter, addFrontMatter, createManifest, moveChapter, moveMatter, parseManifest, readingOrder, removeChapter, removeMatter,
  renameChapter, renameMatter, restoreEntry, retargetFile, sameTree, sectionOf, serializeManifest, starterDoc, starterTitle, treeOf, withTree,
  type Manifest, type ManuscriptEntry, type Tree,
} from "@cadabracraft/format";
import { buildEpub, collectImageSources } from "@cadabracraft/export-epub";
import { renderPdf, type TrimSize } from "@cadabracraft/export-pdf";
import type { ChapterDoc, MatterKind } from "@cadabracraft/shared";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate } from "@cadabracraft/templates";
import { bridge } from "../lib/bridge";
import { runImport, type ImportReport } from "./importBook";
import { describePdfError } from "../lib/pdfErrors";
import { createTauriRunner } from "../lib/typstRunner";

const emptyDoc = (title: string): ChapterDoc => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, { type: "paragraph" }],
});

export interface PdfExportOptions {
  trimSize: TrimSize;
  pdfA: boolean;
  /** Template id; saved in the manifest when it differs from the current one. */
  template: string;
  /** User-configured location of the typst program (an app preference, never stored in the project). */
  typstPath?: string;
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
  const texts = (n: any): string => (typeof n?.text === "string" ? n.text : Array.isArray(n?.content) ? n.content.map(texts).join("") : "");
  const nodes: any[] = (doc as any)?.content ?? [];
  const found = [nodes.find((n) => n?.type === "heading"), ...nodes].map((n) => texts(n).trim()).find((x) => x);
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
  /** Restorable pages in the project trash, newest first (filled by `refreshTrash`). */
  trash: TrashItem[];
  /** Undo and redo stacks for chapter-tree edits (the editor's own text undo is separate). Cleared on open and external reload. */
  history: History;
  actions: {
    /** Reverts the latest chapter-tree edit (add, rename, move, trash, add page, restore). Added pages go to the trash, trashed pages come back from it. Resolves to false when there is nothing to undo or it failed (see `notice`). */
    undo: () => Promise<boolean>;
    redo: () => Promise<boolean>;
    /** Reloads `trash` from the project folder. */
    refreshTrash: () => Promise<void>;
    /** Moves a trashed page back, adds it to the end of its section and opens it. Never overwrites an existing page (a taken file name gets a `-2` suffix). */
    restoreTrash: (path: string) => Promise<void>;
    /** Saves unsaved typing, if any, without reloading the chapter. */
    flush: () => Promise<void>;
    externalChange: (path: string) => Promise<void>;
    setDraft: (doc: ChapterDoc) => void;
    openProject: (root: string) => Promise<void>;
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
    /** Sets the book's template (cadabra.json). A no-op when it is already set. */
    setTemplate: (id: string) => Promise<void>;
    exportEpub: () => Promise<void>;
    /** Builds exports/book.pdf with Typst. Throws `PdfUiError` (message for the author, `code` for the dialog). */
    exportPdf: (options: PdfExportOptions) => Promise<void>;
    /** Asks for an image file, copies it into assets/, and returns `assets/<name>` (null if cancelled or refused; refusals set `notice`). */
    importImage: () => Promise<string | null>;
    /** Imports a .docx/.md file into a NEW project in `root` (the source is only read), opens it and sets `importReport`. Throws, having created nothing, when the file cannot be imported. */
    importBook: (sourcePath: string, root: string, title: string, author: string) => Promise<void>;
    dismissImportReport: () => void;
  };
}

export const useProject = create<State>((set, get) => {
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
      const why = e instanceof Error ? e.message : String(e);
      set({ notice: from === "undo" ? t`Could not undo: ${why}` : t`Could not redo: ${why}` });
      return false;
    } finally {
      historyBusy = false;
    }
  };
  /** Saves unsaved edits so switching chapters never loses typing. */
  const flush = async () => {
    const d = get().draft;
    if (d) { await get().actions.saveCurrent(d); set({ draft: null, currentDoc: d }); }
  };
  const load = async (id: string) => {
    await flush();
    const { root, manifest } = need();
    const entry = entryOf(manifest, id);
    if (!entry) return;
    const r = await bridge.readFile(root, entry.file);
    const doc = r ? (JSON.parse(r.contents) as ChapterDoc) : emptyDoc(entry.title);
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
      pages.push({ id: c.id, title: c.title, doc: JSON.parse(r.contents) as ChapterDoc, section: sectionFor(c), ...(c.kind ? { kind: c.kind } : {}) });
    }
    return pages;
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

  return {
    root: null, manifest: null, currentId: null, currentDoc: null, notice: "", hashes: {}, draft: null, reloadCount: 0, importReport: null, exportStage: null, trash: [], history: NO_HISTORY,
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
        set({ currentDoc: JSON.parse(r.contents) as ChapterDoc, hashes: { ...get().hashes, [path]: r.hash }, reloadCount: get().reloadCount + 1, notice: t`${entry.title} was updated from outside the app` });
      },
      setDraft: (doc) => set({ draft: doc }),
      async openProject(root) {
        const r = await bridge.readFile(root, "cadabra.json");
        if (!r) throw new Error(t`No cadabra.json in that folder`);
        const parsed = parseManifest(r.contents);
        set({ root, manifest: parsed.manifest, hashes: { "cadabra.json": r.hash }, currentId: null, currentDoc: null, notice: "", history: NO_HISTORY, trash: [] });
        if (parsed.migrated) {
          const backup = await bridge.backupManifest(root);
          await saveManifest(parsed.manifest);
          set({ notice: t`Project upgraded from format ${parsed.fromVersion}; backup saved to ${backup}` });
        }
        const first = parsed.manifest.chapters[0] ?? readingOrder(parsed.manifest)[0];
        if (first) await load(first.id);
        await bridge.watchProject(root);
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
      async readPages() {
        await flush();
        return loadChapters();
      },
      async setTemplate(id) {
        const { manifest } = need();
        if (manifest.template === id) return;
        await saveManifest({ ...manifest, template: id });
      },
      async exportEpub() {
        if (get().exportStage) throw new Error(t`An export is already running`);
        set({ exportStage: "preparing" });
        try {
          await flush();
          const { root, manifest } = need();
          const chapters = await loadChapters();
          const assets = await loadAssets(chapters);
          set({ exportStage: "rendering" });
          const bytes = buildEpub({ title: manifest.title, author: manifest.author, language: manifest.language, identifier: manifest.identifier, modified: new Date() }, chapters, { assets, css: getTemplate(hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID).epub.css });
          set({ exportStage: "saving" });
          await bridge.writeBytes(root, "exports/book.epub", Array.from(bytes));
          set({ notice: t`Exported exports/book.epub` });
        } finally {
          set({ exportStage: null });
        }
      },
      async importBook(sourcePath, root, title, author) {
        await flush();
        const report = await runImport({ sourcePath, root, title, author });
        await get().actions.openProject(root);
        set({ importReport: report });
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
          set({ exportStage: "rendering" });
          const runner = createTauriRunner(bridge, options.typstPath);
          const { pdf } = await renderPdf(
            { title: manifest.title, author: manifest.author, language: manifest.language },
            chapters,
            { template, trimSize: options.trimSize, mirrored: true, pageNumbers: true, pdfA: options.pdfA, assets: Object.fromEntries(assets) },
            runner,
          );
          set({ exportStage: "saving" });
          await bridge.writeBytes(root, "exports/book.pdf", Array.from(pdf));
          if (manifest.template !== templateId) await saveManifest({ ...need().manifest, template: templateId });
          set({ notice: t`Exported exports/book.pdf` });
        } catch (e) {
          throw describePdfError(e);
        } finally {
          set({ exportStage: null });
        }
      },
      async importImage() {
        const { root } = need();
        const picked = await bridge.pickImage();
        if (!picked) return null;
        try {
          return await bridge.importAsset(root, picked);
        } catch (e) {
          set({ notice: t`Could not add the image: ${e instanceof Error ? e.message : String(e)}` });
          return null;
        }
      },
    },
  };
});
