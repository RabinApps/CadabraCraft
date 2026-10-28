import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import {
  createManifest,
  parseManifest,
  readingOrder,
  serializeManifest,
  validateFonts,
  validateManifest,
  updateEdition,
  type Manifest,
  sourceFile,
  sourceTitle,
} from "@cadabracraft/format";
import type { ChapterDoc, TrimSize } from "@cadabracraft/shared";
import { resolveTrimSize } from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { forgetProjectAssets } from "../../lib/assets";
import { forgetProjectReferences } from "../../lib/references";
import { runImport } from "../../lib/importBook";
import { errText, noManifestMessage } from "../../lib/projectError";
import { useSettings } from "../editorPrefs";
import { parseChapter, bestEffort, NO_HISTORY } from "./util";
import type { ProjectActions, ProjectState } from "./types";
import type { Ctx } from "./context";

/** Stores the book's trim size only when it differs from what the book resolves to now, so books that never chose one keep following their template. */
const withTrimSize = (m: Manifest, trimSize: TrimSize | undefined): Manifest =>
  !trimSize || resolveTrimSize(m) === trimSize ? m : { ...m, trimSize };

/** Opening, closing and creating a book, changes from outside the app, import, and the book-level settings in cadabra.json. */
export const createProjectActions = (ctx: Ctx): ProjectActions => {
  const { set, get, need, saveManifest, flush, load, resetWordCache, forgetWords } = ctx;
  /** An import is running: a second one is refused instead of racing it. */
  let importing = false;
  /** The open that is running, so a second one (a double click on a recent book) joins it instead of racing it. */
  let opening: Promise<void> | null = null;
  const closedState: Partial<ProjectState> = {
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
    referenceNotices: [],
    removedReferences: [],
    referenceImport: null,
    importReport: null,
    audio: null,
  };
  const openNow = async (root: string): Promise<void> => {
    await flush(); // typing in the book being left
    const r = await bridge.readFile(root, "cadabra.json");
    if (!r) throw new Error(noManifestMessage());
    const parsed = parseManifest(r.contents);
    resetWordCache();
    const previous = get().root;
    if (previous && previous !== root) {
      forgetProjectAssets(previous);
      forgetProjectReferences(previous);
    }
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
      referenceNotices: [],
      removedReferences: [],
      referenceImport: null,
    });
    try {
      await finishOpen(root, parsed);
    } catch (e) {
      // Never stay half open (a book on screen that is not watched): go back to no book.
      set({ ...closedState });
      throw e;
    }
  };
  const finishOpen = async (root: string, parsed: ReturnType<typeof parseManifest>) => {
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
  };
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
      // Any edition's file can change outside the app; only the open page in the open edition needs a reload.
      const language = ctx.langOf(manifest);
      const entry = readingOrder(manifest).find((c) => c.files[language] === path);
      if (!entry || entry.id !== get().currentId) return; // other chapters and editions load fresh when opened
      if (get().draft) {
        set({
          notice: t`${ctx.titleIn(entry, manifest, language)} changed outside the app; saving will keep both versions`,
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
        notice: t`${ctx.titleIn(entry, manifest, language)} was updated from outside the app`,
      });
    },
    openProject(root) {
      opening ??= openNow(root).finally(() => {
        opening = null;
      });
      return opening;
    },
    async closeProject() {
      await flush();
      resetWordCache();
      const root = get().root;
      if (root) {
        forgetProjectAssets(root);
        forgetProjectReferences(root);
      }
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
        referenceNotices: [],
        removedReferences: [],
        referenceImport: null,
        importReport: null,
        audio: null,
      });
    },
    async createProject(root, title, author, trimSize) {
      const manifest = createManifest({
        title,
        author,
        language: i18n.locale === "pseudo" ? "en" : i18n.locale,
        identifier: `urn:uuid:${crypto.randomUUID()}`,
        trimSize,
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
    async setBookFonts(fonts) {
      const { manifest } = need();
      const chosen = {
        ...(fonts.body?.trim() ? { body: fonts.body.trim() } : {}),
        ...(fonts.heading?.trim() ? { heading: fonts.heading.trim() } : {}),
      };
      const { fonts: _old, ...rest } = manifest;
      const next: Manifest = Object.keys(chosen).length
        ? { ...rest, fonts: validateFonts(chosen) }
        : rest;
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
    },
    async updateDetails(d, edition) {
      const { manifest } = need();
      const [source, ...translations] = manifest.editions;
      if (edition && edition !== source!.language) {
        // A translation edition: its own title, author, identifier, ISBN and cover. Its language is its key and does not change here.
        const next = updateEdition(manifest, edition, {
          title: d.title.trim(),
          author: d.author.trim(),
          identifier: d.identifier.trim(),
          isbn: d.isbn.trim() || null,
          cover: d.cover,
        });
        const withTrim = withTrimSize(next, d.trimSize);
        validateManifest(withTrim);
        if (JSON.stringify(withTrim) !== JSON.stringify(manifest)) await saveManifest(withTrim);
        return;
      }
      const language = d.language.trim();
      // Changing the source language re-keys every title and file of the source edition.
      const rekey = <T>(map: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(map).map(([k, v]) => [k === source!.language ? language : k, v]),
        );
      const next: Manifest = withTrimSize(
        {
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
        },
        d.trimSize,
      );
      // validateManifest owns the rules; it names the field, which is enough for the dialog to show.
      validateManifest(next);
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
      // The source language is the key of the shown edition: a stale `activeLanguage` would point at an edition that is gone.
      if (language !== source!.language && get().activeLanguage === source!.language)
        set({ activeLanguage: null });
    },
  };
};
