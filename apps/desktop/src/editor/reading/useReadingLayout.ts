import { useCallback, useMemo, useState } from "react";
import { countWords, folioText } from "@cadabracraft/shared";
import { useBookLayout } from "../../app/hooks/useBookLayout";
import { bookWordsPerPage, chapterPageCount } from "../../lib/page/pageNumbering";
import type { BookPage } from "../../state/project/types";

/**
 * Where every section starts in the book and what number it prints there: the same layout Write mode uses (Typst's report, the
 * editors' measures and the words), never a chain of its own. `laid` is which sections have laid out their pages here, for the
 * placeholder heights.
 */
export function useReadingLayout(
  pages: readonly BookPage[],
  book: Parameters<typeof bookWordsPerPage>[0],
) {
  const layout = useBookLayout();
  const perPage = bookWordsPerPage(book);
  const words = useMemo(() => pages.map((p) => countWords(p.doc)), [pages]);
  const [laid, setLaid] = useState<ReadonlySet<string>>(() => new Set());
  const folioFor = useCallback(
    (physical: number) => (layout ? folioText(layout, physical) : ""),
    [layout],
  );
  /** Content pages of a section (a blank verso before it not counted): its measured layout, else the estimate. */
  const pagesOf = useCallback(
    (id: string, i: number) => layout?.byId.get(id)?.pages ?? chapterPageCount(words[i]!, perPage),
    [layout, words, perPage],
  );
  // 1-based position among the chapters, for the "CHAPTER n" label of the opening.
  const chapterNumbers = useMemo(() => {
    let n = 0;
    return new Map(pages.map((p) => [p.id, p.section === "chapter" ? ++n : undefined]));
  }, [pages]);
  return { layout, words, laid, setLaid, folioFor, pagesOf, chapterNumbers };
}
