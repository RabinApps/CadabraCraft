import { plural, t } from "@lingui/core/macro";
import { termKey } from "@cadabracraft/shared";
import { errText } from "../../../lib/projectError";
import { markOccurrences } from "../../../lib/indexing/docMarks";
import { newIndexEntryId } from "../../../lib/indexing/ids";
import {
  indexMark,
  moveUnder,
  removeGlossaryUses,
  removePlace,
  removeTerm,
  renameTerm,
  usesGlossaryEntry,
} from "../../../lib/indexing/termOps";
import { alertOf } from "../util";
import type { Ctx } from "../context";
import { createBookEdit, type DocChange } from "./bookEdit";
import type { IndexActions } from "./types";

/** The marks in the pages: marking words everywhere, renaming, moving and removing terms, and removing a glossary entry's uses. */
export function createMarkActions(
  ctx: Ctx,
): Pick<
  IndexActions,
  | "markIndexOccurrences"
  | "renameIndexTerm"
  | "moveIndexTerm"
  | "deleteIndexTerm"
  | "removeIndexPlace"
  | "removeGlossaryEntry"
  | "markGlossaryOccurrences"
> {
  const { set, need } = ctx;
  const editBook = createBookEdit(ctx);
  /** Runs an edit, showing why it stopped (0 marks) instead of throwing. */
  const run = async (change: DocChange, undoLabel: string | null, done?: (n: number) => string) => {
    try {
      const n = await editBook(change, undoLabel);
      if (n > 0 && done) set({ notice: done(n) });
      return n;
    } catch (e) {
      set(alertOf(errText(e)));
      return 0;
    }
  };
  const placesText = (n: number) =>
    plural(n, { one: "# place changed in the book", other: "# places changed in the book" });
  return {
    markIndexOccurrences: (entry, query) =>
      run(
        (doc) =>
          markOccurrences(
            doc,
            [query],
            () => indexMark({ id: newIndexEntryId(), ...entry }),
            (m) =>
              m.type === "indexEntry" &&
              termKey(m.attrs?.term ?? "") === termKey(entry.term) &&
              termKey(m.attrs?.sub ?? "") === termKey(entry.sub ?? ""),
          ),
        t`Mark “${query}” in the index`,
        (n) =>
          plural(n, {
            one: "# more place marked in the index",
            other: "# more places marked in the index",
          }),
      ),
    renameIndexTerm: (from, to) =>
      run((doc) => renameTerm(doc, from, to.trim()), t`Rename index term “${from}”`, placesText),
    moveIndexTerm: (term, under) =>
      run((doc) => moveUnder(doc, term, under), t`Move index term “${term}”`, placesText),
    deleteIndexTerm: (term) =>
      run(
        (doc) => removeTerm(doc, term),
        t`Delete index term “${term}”`,
        (n) =>
          plural(n, {
            one: "# place taken out of the index",
            other: "# places taken out of the index",
          }),
      ),
    removeIndexPlace: (id) => run((doc) => removePlace(doc, id), t`Remove index place`),
    markGlossaryOccurrences(id, firstOnly) {
      const entry = need().manifest.glossary?.entries.find((e) => e.id === id);
      if (!entry) return Promise.resolve(0);
      return run(
        (doc) =>
          // First use only: a page that already uses the term has its first use.
          firstOnly && usesGlossaryEntry(doc, id)
            ? { doc, count: 0 }
            : markOccurrences(
                doc,
                [entry.term, ...(entry.aliases ?? [])],
                () => ({ type: "glossaryTerm", attrs: { id } }),
                (m) => m.type === "glossaryTerm" && m.attrs?.id === id,
                firstOnly,
              ),
        t`Mark glossary term “${entry.term}”`,
        (n) => plural(n, { one: "# use of the term marked", other: "# uses of the term marked" }),
      );
    },
    async removeGlossaryEntry(id) {
      try {
        // The uses go first: when that fails the entry stays, so no mark is left naming an entry that is gone.
        await editBook((doc) => removeGlossaryUses(doc, id), null);
        const { manifest } = need();
        const glossary = manifest.glossary;
        if (!glossary) return;
        await ctx.saveManifest({
          ...manifest,
          glossary: { ...glossary, entries: glossary.entries.filter((e) => e.id !== id) },
        });
      } catch (e) {
        set(alertOf(t`Could not remove the glossary term: ${errText(e)}. Try again.`));
      }
    },
  };
}
