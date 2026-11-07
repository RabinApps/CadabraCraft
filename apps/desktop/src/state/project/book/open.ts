import { t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { createManifest, serializeManifest } from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { forgetProjectAssets } from "../../../lib/assets";
import { forgetProjectReferences } from "../../../lib/references/references";
import { bestEffort, NO_HISTORY } from "../util";
import type { ProjectActions } from "../types";
import type { Ctx } from "../context";
import { createOpener } from "./opener";

/** Opening, closing and creating a book, and importing into it. */
export const createOpenActions = (
  ctx: Ctx,
): Pick<
  ProjectActions,
  | "openProject"
  | "closeProject"
  | "createProject"
  | "importBook"
  | "importIntoBook"
  | "dismissImportReport"
> => {
  const { set, get, need, saveManifest, record, flush, load, resetWordCache } = ctx;
  /** An import is running: a second one is refused instead of racing it. */
  let importing = false;
  const { join } = createOpener(ctx);
  return {
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
        const { runImport } = await import("../../../lib/import/importWrite");
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
        const { runImportInto } = await import("../../../lib/import/importWrite");
        const { report, firstId, created } = await runImportInto({
          sourcePath,
          root,
          manifest,
          saveManifest,
          ...opts,
        });
        // One undo step for the whole import; earlier steps stay valid because undo goes newest first.
        record(
          {
            label: t`Import ${report.fileName}`,
            imported: created.map((c) => ({ path: c.file })),
          },
          manifest,
          get().manifest!,
        );
        set({ importReport: report });
        if (firstId) await load(firstId);
      } finally {
        importing = false;
      }
    },
    dismissImportReport: () => set({ importReport: null }),
  };
};
