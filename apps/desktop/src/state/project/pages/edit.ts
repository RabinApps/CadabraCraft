import { t } from "@lingui/core/macro";
import {
  entryFile,
  markTranslated,
  setTranslationFile,
  sourceFile,
  translationFile,
} from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { whyText } from "../../../lib/projectError";
import { alertOf, AUTOSAVE_MS, AUTOSAVE_MAX_MS, SAVED_NOTICE_MS } from "../util";
import type { PageActions } from "../types";
import type { Ctx } from "../context";

/** Typing and saving the open page: select, autosave, write. */
export const createEditActions = (
  ctx: Ctx,
): Pick<PageActions, "flush" | "selectChapter" | "setDraft" | "saveCurrent"> => {
  const { set, get, need, entryOf, langOf, titleIn, saveManifest, flush, load } = ctx;
  let autosave: ReturnType<typeof setTimeout> | undefined;
  /** Fires AUTOSAVE_MAX_MS after the first unsaved keystroke, so continuous typing is still written. */
  let maxWait: ReturnType<typeof setTimeout> | undefined;
  /** Clears the app's own "Saved" notice SAVED_NOTICE_MS after the latest save (each save restarts the wait). */
  let savedFade: ReturnType<typeof setTimeout> | undefined;
  const showSaved = () => {
    // Another notice (a failure, a conflict copy) is never replaced by "Saved" and stays until it is dismissed.
    const saved = t`Saved`;
    if (get().notice && get().notice !== saved) return;
    set({ notice: saved });
    clearTimeout(savedFade);
    savedFade = setTimeout(() => {
      // Only that exact notice: one that arrived meanwhile is left alone.
      if (get().notice === saved) set({ notice: "" });
    }, SAVED_NOTICE_MS);
  };
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
        ...(w.conflict_copy && {
          notice: t`${titleIn(entry, manifest, lang)} changed outside the app; the other version was kept as ${w.conflict_copy}`,
        }),
      });
      if (!w.conflict_copy) showSaved();
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
  };
};
