import { useEffect, useMemo } from "react";
import type { BookPages } from "@cadabracraft/shared";
import { bookLayout } from "../../lib/pageNumbering";
import { clearBookWords, refreshBookWords, useBookWords } from "../../state/bookWords";
import { usePageMeasure } from "../../state/pageMeasure";
import { usePageCount } from "../../state/pageCount";
import { useProject } from "../../state/project/index";

/**
 * The page layout of the open book: where every entry starts, what number is printed there and how long the book is, from the
 * words of every page, Typst's report and what the editors measured (see `layoutBook`). The one source every Write-mode surface
 * asks; Read mode, the print preview and the PDF dialog build the same layout from the pages they load (`layoutOfPages`).
 *
 * The word count is refreshed when the book changes (a save, a page opened or moved, a chapter added), never per keystroke: the
 * numbers of the later pages move only when the open page's text is written. The last words stay while the new ones are counted,
 * so a page number never drops to a placeholder.
 */
export function useBookLayout(): BookPages | null {
  const manifest = useProject((s) => s.manifest);
  const hashes = useProject((s) => s.hashes);
  const currentDoc = useProject((s) => s.currentDoc);
  const entryWords = useProject((s) => s.actions.entryWords);
  const words = useBookWords((s) => s.words);
  const report = usePageMeasure((s) => s.report);
  const fresh = usePageMeasure((s) => s.fresh);
  const measured = usePageCount((s) => s.byId);
  useEffect(() => {
    if (!manifest) return clearBookWords();
    refreshBookWords(entryWords);
  }, [manifest, hashes, currentDoc, entryWords]);
  return useMemo(
    () => (manifest && words ? bookLayout(manifest, words, { report, fresh, measured }) : null),
    [manifest, words, report, fresh, measured],
  );
}
