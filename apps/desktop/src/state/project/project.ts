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
  type Edition,
  type Manifest,
  sourceFile,
  sourceTitle,
} from "@cadabracraft/format";
import type { ChapterDoc, TrimSize } from "@cadabracraft/shared";
import { resolveTrimSize } from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { forgetProjectAssets } from "../../lib/assets";
import { forgetProjectReferences } from "../../lib/references";
import { runImport, runImportInto } from "../../lib/importBook";
import { publishingFromForm, type PublishingForm } from "../../lib/publishingForm";
import { noManifestMessage, whyText } from "../../lib/projectError";
import { useSettings } from "../editorPrefs";
import { useRecents } from "../recents";
import { alertOf, parseChapter, bestEffort, NO_HISTORY } from "./util";
import type { ProjectActions, ProjectState } from "./types";
import type { Ctx } from "./context";

/** Stores the book's trim size only when it differs from what the book resolves to now, so books that never chose one keep following their template. */
const withTrimSize = (m: Manifest, trimSize: TrimSize | undefined): Manifest =>
  !trimSize || resolveTrimSize(m) === trimSize ? m : { ...m, trimSize };

/** The edition with the retail details of `form`; with no form it is unchanged, and an empty form removes `publishing`. */
const withPublishing = (e: Edition, form: PublishingForm | undefined): Edition => {
  if (!form) return e;
  const { publishing: _old, ...rest } = e;
  const publishing = publishingFromForm(form);
  return Object.keys(publishing).length ? { ...rest, publishing } : rest;
};

/** What the loading skeleton calls the book before its manifest is read: the recent list's title, else the folder name. */
const bookNameOf = (root: string): string =>
  useRecents.getState().recents.find((r) => r.root === root)?.title ||
  root.split(/[\\/]/).filter(Boolean).pop() ||
  root;

/** Opening, closing and creating a book, changes from outside the app, import, and the book-level settings in cadabra.json. */
export const createProjectActions = (ctx: Ctx): ProjectActions => {
  const { set, get, need, saveManifest, flush, load, resetWordCache, forgetWords } = ctx;
  /** An import is running: a second one is refused instead of racing it. */
  let importing = false;
  /** The open that is running, so a second one (a double click on a recent book) joins it instead of racing it. */
  let opening: Promise<void> | null = null;
  /** Starts the open, or joins the one running. `skeleton` shows the loading screen; creating or importing keeps its own dialog up instead. */
  const join = (root: string, skeleton: boolean): Promise<void> => {
    if (!opening) {
      if (skeleton) set({ opening: { root, name: bookNameOf(root) } });
      opening = openNow(root).finally(() => {
        opening = null;
        if (get().opening) set({ opening: null });
      });
    }
    return opening;
  };
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
      await bestEffort(() => bridge.unwatchProject(), undefined); // the old book's changes must not reach the new one
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
      await bestEffort(() => bridge.unwatchProject(), undefined);
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
    watchFailed() {
      if (get().root)
        set({ notice: t`Changes made outside the app may not be noticed. Saving still works.` });
    },
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
          set(
            alertOf(
              t`cadabra.json was changed outside the app and could not be read; saving will keep a copy of that version. Restore the book's list from History if chapters are missing.`,
            ),
          );
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
        const why = whyText(e);
        set(
          alertOf(
            t`A change made outside the app could not be read: ${why}. The version you have open is kept; saving keeps a copy of the changed file. You can also restore an earlier version from History.`,
          ),
        );
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
      return join(root, true);
    },
    async closeProject() {
      await flush();
      resetWordCache();
      const root = get().root;
      if (root) {
        forgetProjectAssets(root);
        forgetProjectReferences(root);
      }
      await bestEffort(() => bridge.unwatchProject(), undefined);
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
      await join(root, false);
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
        await join(root, false);
        set({ importReport: report });
      } finally {
        importing = false;
      }
    },
    async importIntoBook(sourcePath, opts) {
      if (importing) throw new Error(t`An import is already running`);
      importing = true;
      try {
        await flush();
        const { root, manifest } = need();
        const { report, firstId } = await runImportInto({
          sourcePath,
          root,
          manifest,
          saveManifest,
          ...opts,
        });
        // The new chapters are appended after the existing ones: earlier tree edits no longer describe the book, so
        // undo does not offer them (chapter text and files are untouched).
        set({ history: NO_HISTORY, importReport: report });
        if (firstId) await load(firstId);
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
    async setBookDropCap(dropCap) {
      const { manifest } = need();
      const { dropCap: _old, ...rest } = manifest;
      const next: Manifest = dropCap === null ? rest : { ...rest, dropCap };
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
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
        const withTrim = withTrimSize(
          {
            ...next,
            editions: next.editions.map((e) =>
              e.language === edition ? withPublishing(e, d.publishing) : e,
            ),
          },
          d.trimSize,
        );
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
            withPublishing(
              {
                ...source!,
                language,
                title: d.title.trim(),
                author: d.author.trim(),
                identifier: d.identifier.trim(),
                isbn: d.isbn.trim() || null,
                cover: d.cover,
              },
              d.publishing,
            ),
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
