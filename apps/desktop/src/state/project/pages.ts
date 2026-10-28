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
  sourceEdition,
  sourceFile,
  sourceTitle,
  sourceTitleById,
  entryFile,
  markTranslated,
  renameIn,
  setTranslationFile,
  translationFile,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import { emptyDoc, AUTOSAVE_MS } from "./util";
import type { PageActions } from "./types";
import type { Ctx } from "./context";

/** The chapter list and the open page: select, type, save, add, rename, move, remove, and reading pages and word counts. */
export const createPageActions = (ctx: Ctx): PageActions => {
  const {
    set,
    get,
    need,
    entryOf,
    langOf,
    titleIn,
    saveManifest,
    record,
    flush,
    load,
    loadChaptersIn,
    countBook,
  } = ctx;
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
      const lang = langOf(manifest);
      // A chapter added after this edition was made has no file in it yet: the first save creates the file.
      const file =
        entryFile(entry, lang) ?? translationFile(sourceFile(entry, manifest.editions), lang);
      const w = await bridge.writeFile(
        root,
        file,
        JSON.stringify(doc, null, 2),
        get().hashes[file] ?? null,
      );
      set({
        hashes: { ...get().hashes, [file]: w.hash },
        notice: w.conflict_copy
          ? t`${titleIn(entry, manifest, lang)} changed outside the app; the other version was kept as ${w.conflict_copy}`
          : t`Saved`,
      });
      // Typing in a copy or blank page is the translation: the chapter stops being marked untranslated.
      const newFile = entryFile(entry, lang) === undefined;
      if (newFile || (entry.untranslated ?? []).includes(lang)) {
        const next = markTranslated(
          setTranslationFile(manifest, entry.id, lang, file),
          entry.id,
          lang,
        );
        await saveManifest(next);
      }
    },
    async add(title) {
      await flush();
      const { root, manifest } = need();
      const { manifest: next, entry } = addChapter(manifest, title);
      const w = await bridge.writeFile(
        root,
        sourceFile(entry, manifest.editions),
        JSON.stringify(emptyDoc(title), null, 2),
        null,
      );
      set({ hashes: { ...get().hashes, [sourceFile(entry, manifest.editions)]: w.hash } });
      await saveManifest(next);
      record(
        {
          label: t`Add ${title}`,
          file: { path: sourceFile(entry, manifest.editions), added: true },
        },
        manifest,
        next,
      );
      await load(entry.id);
    },
    async addMatter(section, kind, title) {
      await flush();
      const { root, manifest } = need();
      const name = title ?? starterTitle(kind, sourceEdition(manifest.editions).language);
      const { manifest: next, entry } = (section === "front" ? addFrontMatter : addBackMatter)(
        manifest,
        kind,
        name,
      );
      const doc = starterDoc(kind, {
        title: sourceEdition(manifest.editions).title,
        author: sourceEdition(manifest.editions).author,
        language: sourceEdition(manifest.editions).language,
        isbn: sourceEdition(manifest.editions).isbn,
        year: new Date().getFullYear(),
      });
      const w = await bridge.writeFile(
        root,
        sourceFile(entry, manifest.editions),
        JSON.stringify(doc, null, 2),
        null,
      );
      set({ hashes: { ...get().hashes, [sourceFile(entry, manifest.editions)]: w.hash } });
      await saveManifest(next);
      record(
        {
          label: t`Add ${name}`,
          file: { path: sourceFile(entry, manifest.editions), added: true },
        },
        manifest,
        next,
      );
      await load(entry.id);
    },
    async rename(id, title) {
      const m = need().manifest;
      const lang = langOf(m);
      if (lang !== sourceEdition(m.editions).language) {
        // A translated title is not part of the chapter tree, so it is not in the undo history.
        await saveManifest(renameIn(m, id, lang, title));
        return;
      }
      const next =
        sectionOf(m, id) === "chapter" ? renameChapter(m, id, title) : renameMatter(m, id, title);
      await saveManifest(next);
      record({ label: t`Rename ${sourceTitleById(m, id) ?? ""}` }, m, next);
    },
    async move(id, delta) {
      const m = need().manifest;
      const next =
        sectionOf(m, id) === "chapter" ? moveChapter(m, id, delta) : moveMatter(m, id, delta);
      await saveManifest(next);
      record({ label: t`Move ${sourceTitleById(m, id) ?? ""}` }, m, next);
    },
    async remove(id) {
      const { root, manifest } = need();
      const currentId = get().currentId;
      const { manifest: next, removed } =
        sectionOf(manifest, id) === "chapter"
          ? removeChapter(manifest, id)
          : removeMatter(manifest, id);
      await saveManifest(next);
      const trashPath = await bridge.trashFile(root, sourceFile(removed, manifest.editions)); // moved to .cadabra/trash, never permanently deleted
      record(
        {
          label: t`Move ${sourceTitle(removed, manifest.editions)} to trash`,
          file: { path: sourceFile(removed, manifest.editions), added: false },
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
      return loadChaptersIn(langOf(need().manifest));
    },
    async bookWords() {
      return countBook();
    },
  };
};
