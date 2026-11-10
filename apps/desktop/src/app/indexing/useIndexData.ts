import { useEffect, useMemo, useState } from "react";
import { sourceEdition } from "@cadabracraft/format";
import { deriveIndexData, type IndexData } from "../../lib/indexing/indexData";
import { useProject } from "../../state/project/index";
import type { BookPage } from "../../state/project/index";

/** Waits this long after typing before the index is read again, so it follows the text without reading the book at every key. */
const TYPING_MS = 300;

/**
 * The pages of the open book and what the index and glossary make of them, read again whenever the open page, its unsaved typing, a
 * reload or the glossary changes. Nothing is read while `active` is false (a closed panel).
 */
export function useBookIndex(active: boolean): {
  pages: BookPage[] | null;
  data: IndexData | null;
} {
  const actions = useProject((s) => s.actions);
  const root = useProject((s) => s.root);
  const currentDoc = useProject((s) => s.currentDoc);
  const draft = useProject((s) => s.draft);
  const reload = useProject((s) => s.reloadCount);
  const glossary = useProject((s) => s.manifest?.glossary);
  const language = useProject(
    (s) => s.activeLanguage ?? (s.manifest ? sourceEdition(s.manifest.editions).language : "en"),
  );
  const [pages, setPages] = useState<BookPage[] | null>(null);
  useEffect(() => {
    if (!active || !root) return;
    let stale = false;
    const timer = setTimeout(
      () => {
        void actions.indexSources().then((p) => {
          if (!stale) setPages(p);
        });
      },
      draft ? TYPING_MS : 0,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [active, actions, root, currentDoc, draft, reload]);
  const data = useMemo(
    () => (pages ? deriveIndexData(pages, glossary, language) : null),
    [pages, glossary, language],
  );
  return { pages, data };
}
