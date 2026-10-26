import { create } from "zustand";
import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { addChapter, createManifest, moveChapter, parseManifest, removeChapter, renameChapter, serializeManifest, type Manifest } from "@cadabracraft/format";
import { buildEpub } from "@cadabracraft/export-epub";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../lib/bridge";

const emptyDoc = (title: string): ChapterDoc => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, { type: "paragraph" }],
});

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
  actions: {
    externalChange: (path: string) => Promise<void>;
    setDraft: (doc: ChapterDoc) => void;
    openProject: (root: string) => Promise<void>;
    createProject: (root: string, title: string, author: string) => Promise<void>;
    selectChapter: (id: string) => Promise<void>;
    saveCurrent: (doc: ChapterDoc) => Promise<void>;
    add: (title: string) => Promise<void>;
    rename: (id: string, title: string) => Promise<void>;
    move: (id: string, delta: number) => Promise<void>;
    remove: (id: string) => Promise<void>;
    exportEpub: () => Promise<void>;
  };
}

export const useProject = create<State>((set, get) => {
  const need = () => {
    const { root, manifest } = get();
    if (!root || !manifest) throw new Error("no project open");
    return { root, manifest };
  };
  const saveManifest = async (manifest: Manifest) => {
    const { root } = need();
    const base = get().hashes["cadabra.json"] ?? null;
    const w = await bridge.writeFile(root, "cadabra.json", serializeManifest(manifest), base);
    set({ manifest, hashes: { ...get().hashes, "cadabra.json": w.hash }, notice: w.conflict_copy ? t`cadabra.json changed outside the app; your previous copy was kept as ${w.conflict_copy}` : get().notice });
  };
  /** Saves unsaved edits so switching chapters never loses typing. */
  const flush = async () => {
    const d = get().draft;
    if (d) { await get().actions.saveCurrent(d); set({ draft: null }); }
  };
  const load = async (id: string) => {
    await flush();
    const { root, manifest } = need();
    const entry = manifest.chapters.find((c) => c.id === id);
    if (!entry) return;
    const r = await bridge.readFile(root, entry.file);
    const doc = r ? (JSON.parse(r.contents) as ChapterDoc) : emptyDoc(entry.title);
    set({ currentId: id, currentDoc: doc, draft: null, hashes: r ? { ...get().hashes, [entry.file]: r.hash } : get().hashes });
  };

  return {
    root: null, manifest: null, currentId: null, currentDoc: null, notice: "", hashes: {}, draft: null, reloadCount: 0,
    actions: {
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
        const entry = manifest.chapters.find((c) => c.file === path);
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
        const first = parsed.manifest.chapters[0];
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
        const entry = manifest.chapters.find((c) => c.id === get().currentId);
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
      async rename(id, title) {
        await saveManifest(renameChapter(need().manifest, id, title));
      },
      async move(id, delta) {
        await saveManifest(moveChapter(need().manifest, id, delta));
      },
      async remove(id) {
        const { root, manifest } = need();
        const currentId = get().currentId;
        const { manifest: next, removed } = removeChapter(manifest, id);
        await saveManifest(next);
        await bridge.trashFile(root, removed.file); // moved to .cadabra/trash, never permanently deleted
        if (currentId === id) {
          set({ currentId: null, currentDoc: null });
          if (next.chapters[0]) await load(next.chapters[0].id);
        }
      },
      async exportEpub() {
        await flush();
        const { root, manifest } = need();
        const chapters = [];
        for (const c of manifest.chapters) {
          const r = await bridge.readFile(root, c.file);
          if (!r) throw new Error(t`Missing chapter file ${c.file}`);
          chapters.push({ id: c.id, title: c.title, doc: JSON.parse(r.contents) as ChapterDoc });
        }
        const bytes = buildEpub({ title: manifest.title, author: manifest.author, language: manifest.language, identifier: manifest.identifier, modified: new Date() }, chapters);
        await bridge.writeBytes(root, "exports/book.epub", Array.from(bytes));
        set({ notice: t`Exported exports/book.epub` });
      },
    },
  };
});
