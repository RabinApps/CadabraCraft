import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { useProject } from "../../state/project/index";
import { errText } from "../../lib/projectError";
import { type PageCounts } from "../../lib/search/findHelpers";
import { searchBook, type BookSearchOptions } from "../../lib/search/bookSearch";
import { getSearchInfo, searchKey } from "../search/plugin";

/**
 * Matches per page for the whole book (read from disk after saving unsaved typing), while "All chapters" is on.
 * Recounted when the search or the open page's own count changes; the open page itself is counted live by the editor.
 */
export function useBookCounts(
  on: boolean,
  options: BookSearchOptions,
  editorTotal: number,
): PageCounts {
  const { query, matchCase, wholeWord, regex } = options;
  const readPages = useProject((s) => s.actions.readPages);
  // A book-wide replace (or its undo) changes pages other than the open one, so it also triggers a recount.
  const history = useProject((s) => s.history);
  // Another book (or the same one after pages were added or removed) invalidates the counts too.
  const root = useProject((s) => s.root);
  const manifest = useProject((s) => s.manifest);
  const [counts, setCounts] = useState<PageCounts>({});
  useEffect(() => {
    if (!on || !query) {
      setCounts({});
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      readPages()
        .then((pages) => {
          if (live)
            setCounts(
              Object.fromEntries(
                searchBook(pages, { query, matchCase, wholeWord, regex }).pages.map((p) => [
                  p.id,
                  p.count,
                ]),
              ),
            );
        })
        .catch((e) => {
          if (!live) return;
          // A page that cannot be read is not silently "no results": say so (the same text is not set twice).
          setCounts({});
          const why = errText(e);
          if (useProject.getState().notice !== why) useProject.setState({ notice: why });
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [on, query, matchCase, wholeWord, regex, editorTotal, history, root, manifest, readPages]);
  return counts;
}

/**
 * Matches per edition (language code to total) for the whole book while "All languages" is on, read from disk like
 * `useBookCounts`. Recounted on the same triggers.
 */
export function useLanguageCounts(
  on: boolean,
  options: BookSearchOptions,
  editorTotal: number,
): Record<string, number> {
  const { query, matchCase, wholeWord, regex } = options;
  const readPages = useProject((s) => s.actions.readPages);
  const history = useProject((s) => s.history);
  const root = useProject((s) => s.root);
  const manifest = useProject((s) => s.manifest);
  const [totals, setTotals] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!on || !query || !manifest) {
      setTotals({});
      return;
    }
    let live = true;
    const languages = manifest.editions.map((e) => e.language);
    const id = setTimeout(() => {
      Promise.all(
        languages.map(async (language) => {
          const pages = await readPages(language);
          return [
            language,
            searchBook(pages, { query, matchCase, wholeWord, regex }).total,
          ] as const;
        }),
      )
        .then((entries) => {
          if (live) setTotals(Object.fromEntries(entries));
        })
        .catch((e) => {
          if (!live) return;
          setTotals({});
          const why = errText(e);
          if (useProject.getState().notice !== why) useProject.setState({ notice: why });
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [on, query, matchCase, wholeWord, regex, editorTotal, history, root, manifest, readPages]);
  return totals;
}

/** Total and 1-based current index, kept in step with the document without re-rendering when nothing changed. */
export function useSearchInfo(editor: Editor) {
  const [info, setInfo] = useState(() => getSearchInfo(editor));
  useEffect(() => {
    const update = () => {
      const next = getSearchInfo(editor);
      setInfo((prev) => (prev.total === next.total && prev.index === next.index ? prev : next));
    };
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  return info;
}

/** Selects the current match and scrolls to it (after a replace, when no step happened). The editor does not take focus. */
export function revealCurrent(editor: Editor) {
  const s = searchKey.getState(editor.state);
  const m = s?.matches[s.current];
  if (!m) return;
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, m.from, m.to))
      .scrollIntoView()
      .setMeta("addToHistory", false),
  );
}
