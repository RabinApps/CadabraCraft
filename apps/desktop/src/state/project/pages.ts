import { t } from "@lingui/core/macro";
import {
  addBackMatter,
  addChapter,
  addFrontMatter,
  addBlank as insertBlank,
  moveChapter,
  moveMatter,
  readingOrder,
  removeChapter,
  removeMatter,
  renameChapter,
  renameMatter,
  setChapterDropCap,
  setMatterVerticalCenter,
  setMatterStartOnNext,
  setEntryIcon,
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
  linksOf,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { alertOf, emptyDoc, AUTOSAVE_MS, AUTOSAVE_MAX_MS } from "./util";
import type { HistoryEntry, PageActions } from "./types";
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
    countEntries,
  } = ctx;
  let autosave: ReturnType<typeof setTimeout> | undefined;
  /** Fires AUTOSAVE_MAX_MS after the first unsaved keystroke, so continuous typing is still written. */
  let maxWait: ReturnType<typeof setTimeout> | undefined;
  const runAutosave = () => {
    clearTimeout(autosave);
    clearTimeout(maxWait);
    autosave = maxWait = undefined;
    flush().catch((e) => {
      const why = whyText(e);
      set(
        alertOf(
          t`Could not save: ${why}. Your text is still in the editor and CadabraCraft will try again. Free some space or check the folder if it keeps failing.`,
        ),
      );
      // Typing is still unsaved: try again, so a short write error does not leave it for the window close.
      if (get().draft && autosave === undefined) autosave = setTimeout(runAutosave, AUTOSAVE_MS);
    });
  };
  return {
    flush,
    selectChapter: load,
    setDraft(doc) {
      set({ draft: doc });
      clearTimeout(autosave);
      autosave = setTimeout(runAutosave, AUTOSAVE_MS);
      maxWait ??= setTimeout(runAutosave, AUTOSAVE_MAX_MS);
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
          : get().notice || t`Saved`,
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
      // A blank page is added straight after the page that was open: the author put it between two particular pages.
      const { manifest: next, entry } = (section === "front" ? addFrontMatter : addBackMatter)(
        manifest,
        kind,
        name,
        get().currentId ?? undefined,
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
    async addBlank() {
      await flush();
      const { root, manifest } = need();
      const name = starterTitle("blank", sourceEdition(manifest.editions).language);
      // A blank page goes straight after the open page, in that page's own part of the book; with no page open, at the end of the
      // chapters (before the back matter).
      const { manifest: next, entry } = insertBlank(manifest, get().currentId ?? undefined, name);
      const file = sourceFile(entry, manifest.editions);
      const w = await bridge.writeFile(root, file, JSON.stringify(emptyDoc(name), null, 2), null);
      set({ hashes: { ...get().hashes, [file]: w.hash } });
      await saveManifest(next);
      record({ label: t`Add ${name}`, file: { path: file, added: true } }, manifest, next);
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
      record({ label: t`Rename ${sourceTitleById(m, id)!}` }, m, next);
    },
    async move(id, delta) {
      const m = need().manifest;
      const next =
        sectionOf(m, id) === "chapter" ? moveChapter(m, id, delta) : moveMatter(m, id, delta);
      await saveManifest(next);
      record({ label: t`Move ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setIcon(id, icon) {
      const m = need().manifest;
      const next = setEntryIcon(m, id, icon);
      await saveManifest(next);
      record({ label: t`Change icon of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setChapterDropCap(id, dropCap) {
      const m = need().manifest;
      const next = setChapterDropCap(m, id, dropCap);
      await saveManifest(next);
      record({ label: t`Change first letter of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setVerticalCenter(id, verticalCenter) {
      const m = need().manifest;
      const next = setMatterVerticalCenter(m, id, verticalCenter);
      await saveManifest(next);
      record({ label: t`Change vertical position of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async setStartOnNext(id, startOnNext) {
      const m = need().manifest;
      const next = setMatterStartOnNext(m, id, startOnNext);
      await saveManifest(next);
      record({ label: t`Change page start of ${sourceTitleById(m, id)!}` }, m, next);
    },
    async remove(id) {
      await flush(); // typing in the page being removed would otherwise be written back after it went to trash
      const { root, manifest } = need();
      const currentId = get().currentId;
      const { manifest: next, removed } =
        sectionOf(manifest, id) === "chapter"
          ? removeChapter(manifest, id)
          : removeMatter(manifest, id);
      const links = linksOf(manifest, id);
      await saveManifest(next);
      const trashPath = await bridge.trashFile(root, sourceFile(removed, manifest.editions)); // moved to .cadabra/trash, never permanently deleted
      // The page's translations go with it (a translation file may not exist yet: the page was added after the edition).
      const sourceLang = sourceEdition(manifest.editions).language;
      const others: NonNullable<HistoryEntry["others"]> = [];
      for (const [language, path] of Object.entries(removed.files)) {
        if (language === sourceLang || !(await bridge.readFile(root, path))) continue;
        others.push({ language, path, trashPath: await bridge.trashFile(root, path) });
      }
      record(
        {
          label: t`Move ${sourceTitle(removed, manifest.editions)} to trash`,
          file: { path: sourceFile(removed, manifest.editions), added: false },
          trashPath,
          ...(others.length ? { others } : {}),
          ...(links.length ? { links } : {}),
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
    async readPages(language) {
      await flush();
      return loadChaptersIn(language ?? langOf(need().manifest));
    },
    async bookWords() {
      return countBook();
    },
    async entryWords() {
      return countEntries();
    },
  };
};
