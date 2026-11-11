import type { PageActions } from "./types";
import type { Ctx } from "./context";
import { withGeneratedPages } from "../../lib/indexing/pageSpecs";
import { createAddActions } from "./pages/add";
import { createEditActions } from "./pages/edit";
import { createSplitActions } from "./pages/split";
import { createStructureActions } from "./pages/structure";

/** The chapter list and the open page: select, type, save, add, rename, move, remove, and reading pages and word counts. */
export const createPageActions = (ctx: Ctx): PageActions => {
  const { need, langOf, flush, loadChaptersIn, countBook, countEntries } = ctx;
  return {
    ...createEditActions(ctx),
    ...createAddActions(ctx),
    ...createStructureActions(ctx),
    ...createSplitActions(ctx),
    async readPages(language) {
      await flush();
      const lang = language ?? langOf(need().manifest);
      return withGeneratedPages(need().manifest, await loadChaptersIn(lang), lang);
    },
    async bookWords() {
      return countBook();
    },
    async entryWords() {
      return countEntries();
    },
  };
};
