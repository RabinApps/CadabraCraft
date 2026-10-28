import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  createManifest,
  parseManifest,
  readingOrder,
  serializeManifest,
  validateManifest,
  type Manifest,
  sourceFile,
  sourceTitle,
} from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { bridge } from "../../lib/bridge";
import { runImport } from "../../lib/importBook";
import { errText } from "../../lib/projectError";
import { useSettings } from "../editorPrefs";
import { parseChapter, bestEffort, NO_HISTORY } from "./util";
import type { ProjectActions } from "./types";
import type { Ctx } from "./context";

/** Opening, closing and creating a book, changes from outside the app, import, and the book-level settings in cadabra.json. */
export const createProjectActions = (ctx: Ctx): ProjectActions => {
  const { set, get, need, saveManifest, flush, load, resetWordCache, forgetWords } = ctx;
  /** An import is running: a second one is refused instead of racing it. */
  let importing = false;
  return {
    async externalChange(path) {
      const { root, manifest, hashes } = get();
      if (!root || !manifest) return;
      const r = await bridge.readFile(root, path).catch(() => null);
      if (!r || r.hash === hashes[path]) return; // gone, unreadable, or our own write
      forgetWords(path);
      if (path === "cadabra.json") {
        try {
          set({
            manifest: parseManifest(r.contents).manifest,
            hashes: { ...get().hashes, [path]: r.hash },
            history: NO_HISTORY,
            notice: t`Chapter list updated from outside the app`,
          });
        } catch {
          set({
            notice: t`cadabra.json was changed outside the app and could not be read; saving will keep a copy of that version`,
          });
        }
        return;
      }
      const entry = readingOrder(manifest).find((c) => sourceFile(c, manifest.editions) === path);
      if (!entry || entry.id !== get().currentId) return; // other chapters load fresh when opened
      if (get().draft) {
        set({
          notice: t`${sourceTitle(entry, manifest.editions)} changed outside the app; saving will keep both versions`,
        });
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
      set({
        currentDoc: doc,
        hashes: { ...get().hashes, [path]: r.hash },
        reloadCount: get().reloadCount + 1,
        notice: t`${sourceTitle(entry, manifest.editions)} was updated from outside the app`,
      });
    },
    async openProject(root) {
      await flush(); // typing in the book being left
      const r = await bridge.readFile(root, "cadabra.json");
      if (!r) throw new Error(t`No cadabra.json in that folder`);
      const parsed = parseManifest(r.contents);
      resetWordCache();
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
      });
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
      await bridge.watchProject(root);
      void bestEffort(
        () => bridge.pruneSnapshots(root, pageFiles, useSettings.getState().snapshotKeep),
        0,
      );
    },
    async closeProject() {
      await flush();
      resetWordCache();
      set({
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
        importReport: null,
        audio: null,
      });
    },
    async createProject(root, title, author) {
      const manifest = createManifest({
        title,
        author,
        language: i18n.locale === "pseudo" ? "en" : i18n.locale,
        identifier: `urn:uuid:${crypto.randomUUID()}`,
      });
      await bridge.createProject(root, serializeManifest(manifest));
      await get().actions.openProject(root);
      await get().actions.add(t`Chapter One`);
      set({ history: NO_HISTORY }); // the first chapter is part of creating the book
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
    async setTemplate(id) {
      const { manifest } = need();
      if (manifest.template === id) return;
      await saveManifest({ ...manifest, template: id });
    },
    async updateDetails(d) {
      const { manifest } = need();
      const [source, ...translations] = manifest.editions;
      const language = d.language.trim();
      // Changing the source language re-keys every title and file of the source edition.
      const rekey = <T>(map: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(map).map(([k, v]) => [k === source!.language ? language : k, v]),
        );
      const next: Manifest = {
        ...manifest,
        editions: [
          {
            ...source!,
            language,
            title: d.title.trim(),
            author: d.author.trim(),
            identifier: d.identifier.trim(),
            isbn: d.isbn.trim() || null,
            cover: d.cover,
          },
          ...translations,
        ],
        ...(language === source!.language
          ? {}
          : {
              frontMatter: manifest.frontMatter.map((e) => ({
                ...e,
                titles: rekey(e.titles),
                files: rekey(e.files),
              })),
              chapters: manifest.chapters.map((e) => ({
                ...e,
                titles: rekey(e.titles),
                files: rekey(e.files),
              })),
              backMatter: manifest.backMatter.map((e) => ({
                ...e,
                titles: rekey(e.titles),
                files: rekey(e.files),
              })),
            }),
      };
      // validateManifest owns the rules; it names the field, which is enough for the dialog to show.
      validateManifest(next);
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
    },
  };
};
