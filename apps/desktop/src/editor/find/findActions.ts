import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { bookStep, type PageCounts } from "../../lib/search/findHelpers";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";
import { getSearchInfo, searchCommands } from "../search/plugin";
import { revealCurrent } from "./findHooks";
import { useFind } from "./findStore";

const DEBOUNCE_MS = 100;

export type FindToggle =
  | { matchCase: boolean }
  | { wholeWord: boolean }
  | { allChapters: boolean }
  | { allLanguages: boolean }
  | { regex: boolean };

interface ActionsInput {
  editor: Editor;
  order: string[];
  counts: PageCounts;
  currentId: string | null;
  allLanguages: boolean;
}

/** The find bar's behaviour: debounced apply, stepping between matches and pages, replace, close and toggles. */
export function useFindActions({ editor, order, counts, currentId, allLanguages }: ActionsInput) {
  const f = useFind();
  const findRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Not kept across renders: TipTap binds `editor.commands` to the state at the time it is read.
  const commands = () => searchCommands(editor);

  const pending = useRef(false);
  const apply = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = false;
    const { query, replacement, matchCase, wholeWord, regex } = useFind.getState();
    searchCommands(editor).setSearch({ query, replacement, matchCase, wholeWord, regex });
  }, [editor]);
  /** Applies only if typing is still waiting for its debounce: applying rescans and would reset the current match. */
  const flush = () => {
    if (pending.current) apply();
  };
  const later = () => {
    clearTimeout(timer.current);
    pending.current = true;
    timer.current = setTimeout(apply, DEBOUNCE_MS);
  };

  // Opening (or reopening, or arriving in a new chapter's editor) applies the stored settings and focuses the input.
  useEffect(() => {
    apply();
    findRef.current?.focus();
    findRef.current?.select();
    // Arrived here by stepping to a match in another chapter: select it once the page has laid out.
    const reveal = useFind.getState().pendingReveal;
    if (reveal) {
      useFind.setState({ pendingReveal: null });
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        if (reveal === "last")
          searchCommands(editor).findPrevious(true); // from the first match this wraps to the last
        else revealCurrent(editor);
      });
    }
  }, [f.focusTick, apply, editor]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => {
    clearTimeout(timer.current);
    commands().clearSearch();
    f.close();
    editor.commands.focus();
  };
  const stepInPage = (dir: 1 | -1) => {
    if (dir === 1) commands().findNext(true);
    else commands().findPrevious(true);
  };
  /** Moves to the next/previous match; in book scope this may open another page (its editor then reveals the match). */
  const step = (dir: 1 | -1) => {
    flush();
    if (!f.allChapters) return stepInPage(dir);
    const to = bookStep(order, counts, currentId, getSearchInfo(editor), dir);
    if (to?.to === "stay") stepInPage(dir);
    else if (to) {
      useFind.setState({ pendingReveal: to.at });
      void useProject
        .getState()
        .actions.selectChapter(to.id)
        .catch((e) => useProject.setState({ notice: errText(e) }));
    }
  };
  const replaceOne = () => {
    flush();
    // Book scope with no match on this page: behave like Next (open the page that has the next one).
    if (f.allChapters && getSearchInfo(editor).total === 0) return step(1);
    if (!commands().replaceCurrent()) return;
    if (f.allChapters && getSearchInfo(editor).total === 0) step(1);
    else revealCurrent(editor);
  };
  const replaceAll = () => {
    flush();
    if (!f.allChapters) {
      commands().replaceAll();
      return;
    }
    // The store saves the open page first, rewrites every page that matches, records one undo step and reloads this page.
    const { query, replacement, matchCase, wholeWord, regex } = useFind.getState();
    void useProject
      .getState()
      .actions.replaceInBook({ query, matchCase, wholeWord, regex }, replacement, { allLanguages })
      .catch((e) => useProject.setState({ notice: errText(e) }));
  };
  const toggle = (patch: FindToggle) => {
    f.set(patch);
    queueMicrotask(apply);
  };
  /** Opens that page and selects its first match (the same hand-over as stepping into another page). */
  const openRow = (id: string) => {
    flush();
    if (id === currentId) {
      apply();
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) revealCurrent(editor);
      });
      return;
    }
    useFind.setState({ pendingReveal: "first" });
    void useProject
      .getState()
      .actions.selectChapter(id)
      .catch((e) => useProject.setState({ notice: errText(e) }));
  };
  return { findRef, later, close, step, replaceOne, replaceAll, toggle, openRow };
}
