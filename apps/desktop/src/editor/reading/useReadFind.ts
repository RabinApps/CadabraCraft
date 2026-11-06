import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prefillQuery } from "../../lib/search/findHelpers";
import type { BookSearchOptions } from "../../lib/search/bookSearch";
import { isInvalidRegex } from "../../lib/search/match";
import {
  firstIndexOf,
  noMatches,
  readMatches,
  startIndex,
  stepIndex,
  type ReadMatches,
} from "../../lib/search/readFind";
import { pressed } from "../../app/settings/shortcutBindings";
import { modalOpen, useRegisterCommands } from "../../state/commands";
import type { BookPage } from "../../state/project/types";
import { goToReadMatch, setReadMatch, useReadFind } from "../../state/readFind";
import { useReadingPosition } from "../../state/readingPosition";
import { useFind } from "../findStore";

/** Typing waits this long before the book is searched again. */
const DEBOUNCE_MS = 120;

/**
 * Find in Read mode. The query and options come from the find bar's store (shared with Write mode); the whole book is searched on the
 * pages' JSON, so chapters that have no editor mounted are counted too. `applied` is what the chapters' editors highlight: the search
 * as it was when the counts were made, null while Find is closed or empty. A new search goes to the first match at or after the
 * reading line.
 */
export function useReadFindState(pages: readonly BookPage[]) {
  const open = useFind((s) => s.open);
  const { query, matchCase, wholeWord, regex } = useFind();
  const wanted = useMemo<BookSearchOptions | null>(
    () => (open && query ? { query, matchCase, wholeWord, regex } : null),
    [open, query, matchCase, wholeWord, regex],
  );
  const [found, setFound] = useState<{ opts: BookSearchOptions | null; matches: ReadMatches }>({
    opts: null,
    matches: noMatches,
  });
  useEffect(() => {
    if (!wanted) {
      setFound((f) => (f.opts ? { opts: null, matches: noMatches } : f));
      setReadMatch(-1);
      return;
    }
    const timer = setTimeout(() => {
      const matches = readMatches(pages, wanted);
      setFound({ opts: wanted, matches });
      goToReadMatch(
        startIndex(
          matches.hits,
          pages.map((p) => p.id),
          useReadingPosition.getState().id,
        ),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wanted, pages]);

  const index = useReadFind((s) => s.index);
  const { hits, total } = found.matches;
  const step = useCallback(
    (dir: 1 | -1) => {
      if (total) goToReadMatch(stepIndex(useReadFind.getState().index, total, dir));
    },
    [total],
  );
  /** Goes to the first match of a page of the results list. */
  const openPage = useCallback(
    (id: string) => {
      const at = firstIndexOf(hits, id);
      if (at !== null) goToReadMatch(at);
    },
    [hits],
  );
  const invalid = regex && isInvalidRegex(query, matchCase);
  return { applied: found.opts, hits, total, index, invalid, step, openPage };
}

/** Cmd/Ctrl+F (and the menu's Find) opens the find bar in Read mode, with the selected text as the query when it is one short line. */
export function useReadFindShortcut(): void {
  const last = useRef(0);
  const invoke = () => {
    if (modalOpen() || Date.now() - last.current < 80) return;
    last.current = Date.now();
    useFind.getState().show({ query: prefillQuery(window.getSelection()?.toString() ?? "") });
  };
  const ref = useRef(invoke);
  ref.current = invoke;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pressed(e, "edit.find") && !pressed(e, "edit.findReplace")) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useRegisterCommands({
    "edit.find": { run: () => ref.current() },
    "edit.findReplace": { run: () => ref.current() },
  });
}
