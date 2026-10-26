import { create } from "zustand";
import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  addBackMatter, addChapter, addFrontMatter, createManifest, moveChapter, moveMatter, parseManifest, readingOrder, removeChapter, removeMatter,
  renameChapter, renameMatter, restoreEntry, sectionOf, serializeManifest, starterDoc, starterTitle, type Manifest, type ManuscriptEntry,
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

export type PdfStage = "preparing" | "rendering" | "saving";

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
  /** Set while a PDF export runs. */
  pdfStage: PdfStage | null;
  /** Restorable pages in the project trash, newest first (filled by `refreshTrash`). */
  trash: TrashItem[];
  actions: {
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
    root: null, manifest: null, currentId: null, currentDoc: null, notice: "", hashes: {}, draft: null, reloadCount: 0, importReport: null, pdfStage: null, trash: [],
    actions: {
      flush,
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
            set({ manifest: parseManifest(r.contents).manifest, hashes: { ...get().hashes, [path]: r.hash }, notice: t`Chapter list updated from outside the app` });
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
        set({ root, manifest: parsed.manifest, hashes: { "cadabra.json": r.hash }, currentId: null, currentDoc: null, notice: "" });
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
        await load(entry.id);
      },
      async rename(id, title) {
        const m = need().manifest;
        await saveManifest(sectionOf(m, id) === "chapter" ? renameChapter(m, id, title) : renameMatter(m, id, title));
      },
      async move(id, delta) {
        const m = need().manifest;
        await saveManifest(sectionOf(m, id) === "chapter" ? moveChapter(m, id, delta) : moveMatter(m, id, delta));
      },
      async remove(id) {
        const { root, manifest } = need();
        const currentId = get().currentId;
        const { manifest: next, removed } = sectionOf(manifest, id) === "chapter" ? removeChapter(manifest, id) : removeMatter(manifest, id);
        await saveManifest(next);
        await bridge.trashFile(root, removed.file); // moved to .cadabra/trash, never permanently deleted
        if (currentId === id) {
          set({ currentId: null, currentDoc: null });
          const fallback = next.chapters[0] ?? readingOrder(next)[0];
          if (fallback) await load(fallback.id);
        }
      },
      async exportEpub() {
        await flush();
        const { root, manifest } = need();
        const chapters = await loadChapters();
        const assets = await loadAssets(chapters);
        const bytes = buildEpub({ title: manifest.title, author: manifest.author, language: manifest.language, identifier: manifest.identifier, modified: new Date() }, chapters, { assets, css: getTemplate(hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID).epub.css });
        await bridge.writeBytes(root, "exports/book.epub", Array.from(bytes));
        set({ notice: t`Exported exports/book.epub` });
      },
      async importBook(sourcePath, root, title, author) {
        await flush();
        const report = await runImport({ sourcePath, root, title, author });
        await get().actions.openProject(root);
        set({ importReport: report });
      },
      dismissImportReport: () => set({ importReport: null }),
      async exportPdf(options) {
        if (get().pdfStage) throw new Error(t`A PDF export is already running`);
        set({ pdfStage: "preparing" });
        try {
          await flush();
          const { root, manifest } = need();
          const templateId = hasTemplate(options.template) ? options.template : DEFAULT_TEMPLATE_ID;
          const template = getTemplate(templateId);
          const chapters = await loadChapters();
          const assets = await loadAssets(chapters);
          set({ pdfStage: "rendering" });
          const runner = createTauriRunner(bridge, options.typstPath);
          const { pdf } = await renderPdf(
            { title: manifest.title, author: manifest.author, language: manifest.language },
            chapters,
            { template, trimSize: options.trimSize, mirrored: true, pageNumbers: true, pdfA: options.pdfA, assets: Object.fromEntries(assets) },
            runner,
          );
          set({ pdfStage: "saving" });
          await bridge.writeBytes(root, "exports/book.pdf", Array.from(pdf));
          if (manifest.template !== templateId) await saveManifest({ ...need().manifest, template: templateId });
          set({ notice: t`Exported exports/book.pdf` });
        } catch (e) {
          throw describePdfError(e);
        } finally {
          set({ pdfStage: null });
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
