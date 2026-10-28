import { t } from "@lingui/core/macro";
import {
  addBackMatter,
  addChapter,
  addFrontMatter,
  moveChapter,
  moveMatter,
  readingOrder,
  removeChapter,
  removeMatter,
  renameChapter,
  renameMatter,
  sectionOf,
  starterDoc,
  starterTitle,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import { emptyDoc, AUTOSAVE_MS } from "./util";
import type { PageActions } from "./types";
import type { Ctx } from "./context";

/** The chapter list and the open page: select, type, save, add, rename, move, remove, and reading pages and word counts. */
export const createPageActions = (ctx: Ctx): PageActions => {
  const { set, get, need, entryOf, saveManifest, record, flush, load, loadChapters, countBook } =
    ctx;
  let autosave: ReturnType<typeof setTimeout> | undefined;
  return {
    flush,
    selectChapter: load,
    setDraft(doc) {
      set({ draft: doc });
      clearTimeout(autosave);
      autosave = setTimeout(() => {
        flush().catch((e) => set({ notice: t`Could not save: ${errText(e)}` }));
      }, AUTOSAVE_MS);
    },
    async saveCurrent(doc) {
      const { root, manifest } = need();
      const entry = entryOf(manifest, get().currentId ?? "");
      if (!entry) return;
      const w = await bridge.writeFile(
        root,
        entry.file,
        JSON.stringify(doc, null, 2),
        get().hashes[entry.file] ?? null,
      );
      set({
        hashes: { ...get().hashes, [entry.file]: w.hash },
        notice: w.conflict_copy
          ? t`${entry.title} changed outside the app; the other version was kept as ${w.conflict_copy}`
          : t`Saved`,
      });
    },
    async add(title) {
      await flush();
      const { root, manifest } = need();
      const { manifest: next, entry } = addChapter(manifest, title);
      const w = await bridge.writeFile(
        root,
        entry.file,
        JSON.stringify(emptyDoc(title), null, 2),
        null,
      );
      set({ hashes: { ...get().hashes, [entry.file]: w.hash } });
      await saveManifest(next);
      record({ label: t`Add ${title}`, file: { path: entry.file, added: true } }, manifest, next);
      await load(entry.id);
    },
    async addMatter(section, kind, title) {
      await flush();
      const { root, manifest } = need();
      const name = title ?? starterTitle(kind, manifest.language);
      const { manifest: next, entry } = (section === "front" ? addFrontMatter : addBackMatter)(
        manifest,
        kind,
        name,
      );
      const doc = starterDoc(kind, {
        title: manifest.title,
        author: manifest.author,
        language: manifest.language,
        isbn: manifest.isbn,
        year: new Date().getFullYear(),
      });
      const w = await bridge.writeFile(root, entry.file, JSON.stringify(doc, null, 2), null);
      set({ hashes: { ...get().hashes, [entry.file]: w.hash } });
      await saveManifest(next);
      record({ label: t`Add ${name}`, file: { path: entry.file, added: true } }, manifest, next);
      await load(entry.id);
    },
    async rename(id, title) {
      const m = need().manifest;
      const next =
        sectionOf(m, id) === "chapter" ? renameChapter(m, id, title) : renameMatter(m, id, title);
      await saveManifest(next);
      record({ label: t`Rename ${entryOf(m, id)?.title ?? ""}` }, m, next);
    },
    async move(id, delta) {
      const m = need().manifest;
      const next =
        sectionOf(m, id) === "chapter" ? moveChapter(m, id, delta) : moveMatter(m, id, delta);
      await saveManifest(next);
      record({ label: t`Move ${entryOf(m, id)?.title ?? ""}` }, m, next);
    },
    async remove(id) {
      const { root, manifest } = need();
      const currentId = get().currentId;
      const { manifest: next, removed } =
        sectionOf(manifest, id) === "chapter"
          ? removeChapter(manifest, id)
          : removeMatter(manifest, id);
      await saveManifest(next);
      const trashPath = await bridge.trashFile(root, removed.file); // moved to .cadabra/trash, never permanently deleted
      record(
        {
          label: t`Move ${removed.title} to trash`,
          file: { path: removed.file, added: false },
          trashPath,
        },
        manifest,
        next,
      );
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
    async bookWords() {
      return countBook();
    },
  };
};
