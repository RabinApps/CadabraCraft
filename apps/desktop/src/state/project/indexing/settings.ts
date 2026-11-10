import { t } from "@lingui/core/macro";
import {
  defaultGlossarySettings,
  defaultIndexSettings,
  MAX_GLOSSARY_ENTRIES,
  validateGlossarySettings,
  validateIndexSettings,
  type GlossarySettings,
  type Manifest,
} from "@cadabracraft/format";
import { termKey } from "@cadabracraft/shared";
import { whyText } from "../../../lib/projectError";
import { newGlossaryId } from "../../../lib/indexing/ids";
import { entryProblemText as problemText } from "../../../lib/indexing/problemText";
import { entryProblem } from "../../../lib/indexing/validation";
import { alertOf } from "../util";
import type { Ctx } from "../context";
import type { IndexActions } from "./types";

/** The settings of the index and the glossary and the glossary's entries: manifest edits that are saved at once. */
export function createSettingsActions(
  ctx: Ctx,
): Pick<
  IndexActions,
  | "setIndexSettings"
  | "setGlossarySettings"
  | "setIndexTermHidden"
  | "addGlossaryEntry"
  | "updateGlossaryEntry"
> {
  const { set, need, saveManifest } = ctx;
  /** Saves `change` of the manifest; a failure is shown and leaves the book as it was. */
  const save = async (change: (m: Manifest) => Manifest): Promise<boolean> => {
    try {
      const before = need().manifest;
      const after = change(before);
      if (after === before) return true;
      await saveManifest(after);
      return true;
    } catch (e) {
      set(alertOf(t`Could not save the index settings: ${whyText(e)}. Try again.`));
      return false;
    }
  };
  const glossaryOf = (m: Manifest): GlossarySettings => m.glossary ?? defaultGlossarySettings();
  return {
    async setIndexSettings(patch) {
      await save((m) => ({
        ...m,
        index: validateIndexSettings({ ...(m.index ?? defaultIndexSettings()), ...patch }),
      }));
    },
    async setGlossarySettings(patch) {
      await save((m) => ({
        ...m,
        glossary: validateGlossarySettings({ ...glossaryOf(m), ...patch }),
      }));
    },
    async setIndexTermHidden(term, hidden) {
      await save((m) => {
        const index = m.index ?? defaultIndexSettings();
        const rest = index.hidden.filter((h) => termKey(h) !== termKey(term));
        return {
          ...m,
          index: validateIndexSettings({ ...index, hidden: hidden ? [...rest, term] : rest }),
        };
      });
    },
    async addGlossaryEntry(entry) {
      const { manifest } = need();
      const glossary = glossaryOf(manifest);
      const id = newGlossaryId();
      const clean = { id, ...entry, term: entry.term.trim() };
      const problem = entryProblem(clean, glossary.entries);
      if (problem || glossary.entries.length >= MAX_GLOSSARY_ENTRIES) {
        set(alertOf(problem ? problemText(problem) : t`The glossary is full.`));
        return null;
      }
      const ok = await save((m) => ({
        ...m,
        glossary: validateGlossarySettings({
          ...glossaryOf(m),
          entries: [...glossaryOf(m).entries, clean],
        }),
      }));
      return ok ? id : null;
    },
    async updateGlossaryEntry(id, patch) {
      const glossary = glossaryOf(need().manifest);
      const old = glossary.entries.find((e) => e.id === id);
      if (!old) return false;
      const next = { ...old, ...patch, term: (patch.term ?? old.term).trim() };
      const problem = entryProblem(next, glossary.entries);
      if (problem) {
        set(alertOf(problemText(problem)));
        return false;
      }
      return save((m) => ({
        ...m,
        glossary: validateGlossarySettings({
          ...glossaryOf(m),
          entries: glossaryOf(m).entries.map((e) => (e.id === id ? next : e)),
        }),
      }));
    },
  };
}
