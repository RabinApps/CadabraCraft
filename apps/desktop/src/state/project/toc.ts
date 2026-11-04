import { t } from "@lingui/core/macro";
import {
  addTocCustom as addCustomTo,
  entryFile,
  extractOutline,
  hideTocItem as hideIn,
  moveTocItem as moveIn,
  readingOrder,
  removeTocOverride as removeOverrideIn,
  renameTocItem as renameIn,
  resetToc as resetIn,
  setTocDepth as setDepthIn,
  setTocPageNumbers as setPageNumbersIn,
  showTocItem as showIn,
  TOC_UNLISTED_KINDS,
  type Manifest,
  type OutlineItem,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { alertOf, parseChapter } from "./util";
import type { TocActions } from "./types";
import type { Ctx } from "./context";

/**
 * The contents page's settings and overrides. Every action saves the manifest and adds a book-undo entry (the settings live in the
 * contents entry, which is part of the chapter tree the history restores). A failure sets `notice` and leaves the book as it was.
 */
export const createTocActions = (ctx: Ctx): TocActions => {
  const { set, need, langOf, saveManifest, record } = ctx;
  /** Applies `change` to the manifest, saves it and remembers it for Undo; `failure` is the notice when the save does not work. */
  const edit = async (
    label: string,
    failure: (why: string) => string,
    change: (m: Manifest) => Manifest,
  ): Promise<boolean> => {
    const before = need().manifest;
    try {
      const after = change(before);
      if (after === before) return true;
      await saveManifest(after);
      record({ label }, before, after);
      return true;
    } catch (e) {
      set(alertOf(failure(whyText(e))));
      return false;
    }
  };
  const couldNot = (why: string) => t`Could not change the contents page: ${why}. Try again.`;
  return {
    async tocOutlines() {
      const { root, manifest } = need();
      const language = langOf(manifest);
      const outlines: Record<string, OutlineItem[]> = {};
      for (const entry of readingOrder(manifest)) {
        if (entry.kind === "contents") continue;
        if (entry.kind !== undefined && TOC_UNLISTED_KINDS.includes(entry.kind)) continue;
        const file = entryFile(entry, language);
        const r = file ? await bridge.readFile(root, file) : null;
        if (!r || !file) continue;
        try {
          outlines[entry.id] = extractOutline(parseChapter(r.contents, file));
        } catch {
          // A page that cannot be read lists no headings; opening it shows why.
        }
      }
      return outlines;
    },
    setTocDepth: async (id, depth) => {
      await edit(t`Change contents depth`, couldNot, (m) => setDepthIn(m, id, depth));
    },
    setTocPageNumbers: async (id, on) => {
      await edit(t`Change contents page numbers`, couldNot, (m) => setPageNumbersIn(m, id, on));
    },
    renameTocItem: async (id, key, title) => {
      await edit(t`Rename contents entry`, couldNot, (m) => renameIn(m, id, key, langOf(m), title));
    },
    hideTocItem: async (id, key) => {
      await edit(t`Hide contents entry`, couldNot, (m) => hideIn(m, id, key));
    },
    showTocItem: async (id, key) => {
      await edit(t`Show contents entry`, couldNot, (m) => showIn(m, id, key));
    },
    moveTocItem: async (id, items, key, to) => {
      await edit(t`Move contents entry`, couldNot, (m) => moveIn(m, id, items, key, to));
    },
    async addTocCustom(id, init) {
      let key: string | null = null;
      const ok = await edit(t`Add contents entry`, couldNot, (m) => {
        const added = addCustomTo(m, id, { ...init, language: langOf(m) });
        key = added.key;
        return added.manifest;
      });
      return ok ? key : null;
    },
    removeTocOverride: async (id, key) => {
      await edit(t`Remove contents change`, couldNot, (m) => removeOverrideIn(m, id, key));
    },
    resetToc: async (id) => {
      await edit(t`Reset contents to outline`, couldNot, (m) => resetIn(m, id));
    },
  };
};
