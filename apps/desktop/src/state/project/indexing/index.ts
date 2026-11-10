import { t } from "@lingui/core/macro";
import { errText } from "../../../lib/projectError";
import { alertOf } from "../util";
import type { BookPage } from "../types";
import type { Ctx } from "../context";
import { createMarkActions } from "./marks";
import { createSettingsActions } from "./settings";
import type { IndexActions } from "./types";

/** The back-of-book index and the glossary: settings, entries and the marks that tie them to the text. */
export const createIndexActions = (ctx: Ctx): IndexActions => {
  const { get, set, need, langOf, loadChaptersIn } = ctx;
  return {
    async indexSources(): Promise<BookPage[]> {
      const { manifest } = need();
      const lang = langOf(manifest);
      let pages: BookPage[];
      try {
        pages = await loadChaptersIn(lang);
      } catch (e) {
        set(alertOf(t`The index could not read the book: ${errText(e)}.`));
        return [];
      }
      // What is on screen stands in for the open page's file (typing is saved a moment later).
      const open = get().draft ?? get().currentDoc;
      const id = get().currentId;
      return open && id ? pages.map((p) => (p.id === id ? { ...p, doc: open } : p)) : pages;
    },
    ...createSettingsActions(ctx),
    ...createMarkActions(ctx),
  };
};
