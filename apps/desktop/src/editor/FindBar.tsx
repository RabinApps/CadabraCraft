import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button, IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { Field } from "../ui/Input";
import { readingOrder, entryRows } from "@cadabracraft/format";
import { useProject } from "../state/project/index";
import { errText } from "../lib/projectError";
import {
  bookPosition,
  bookStep,
  countLabel,
  isComposing,
  resultRows,
  type ResultRow,
} from "../lib/search/findHelpers";
import { MAX_QUERY_CHARS, MAX_REPLACEMENT_CHARS, useFind } from "./findStore";
import { isInvalidRegex } from "../lib/search/match";
import { getSearchInfo, searchCommands } from "./search/plugin";
import { revealCurrent, useBookCounts, useSearchInfo } from "./findHooks";

const DEBOUNCE_MS = 100;

const chip =
  "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const small = "px-3 py-1.5 text-xs";

/**
 * Find and replace bar, docked top-right of the writing area (full width under the top bar on phones). It is a toolbar,
 * not a modal: focus is not trapped. It is available in Write mode only (the search plugin is not loaded when reading),
 * and also in Focus mode, where it sits below the "Exit focus mode" button, so Cmd/Ctrl+F still works with the chrome hidden.
 */
export function FindBar({ editor, focusMode }: { editor: Editor; focusMode?: boolean }) {
  const { t } = useLingui();
  const f = useFind();
  const editorInfo = useSearchInfo(editor);
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const counts = useBookCounts(
    f.allChapters,
    f.query,
    f.matchCase,
    f.wholeWord,
    f.regex,
    editorInfo.total,
  );
  const order = manifest ? readingOrder(manifest).map((e) => e.id) : [];
  const info = f.allChapters ? bookPosition(order, counts, currentId, editorInfo) : editorInfo;
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
      .actions.replaceInBook({ query, matchCase, wholeWord, regex }, replacement)
      .catch((e) => useProject.setState({ notice: errText(e) }));
  };
  const toggle = (
    patch:
      | { matchCase: boolean }
      | { wholeWord: boolean }
      | { allChapters: boolean }
      | { regex: boolean },
  ) => {
    f.set(patch);
    queueMicrotask(apply);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !isComposing(e.nativeEvent)) {
      // Stop here so focus mode's own Escape does not also exit.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const invalid = f.regex && isInvalidRegex(f.query, f.matchCase);
  const noResults = f.query !== "" && info.total === 0;
  const rows =
    f.allChapters && !invalid && manifest
      ? resultRows(
          {
            frontMatter: entryRows(manifest.frontMatter, manifest.editions),
            chapters: entryRows(manifest.chapters, manifest.editions),
            backMatter: entryRows(manifest.backMatter, manifest.editions),
          },
          counts,
          currentId,
          editorInfo,
        )
      : [];
  const rowTitle = (r: ResultRow) =>
    r.section === "front"
      ? t`Front matter: ${r.title}`
      : r.section === "back"
        ? t`Back matter: ${r.title}`
        : r.title;
  const rowCount = (n: number) => plural(n, { one: "# match", other: "# matches" });
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

  return (
    <div
      role="search"
      aria-label={t`Find and replace`}
      onKeyDown={onKeyDown}
      className={cx(
        "absolute z-20 flex flex-col gap-2 border border-border bg-raised p-2 text-ink shadow-xl",
        "max-md:inset-x-0 max-md:top-0 max-md:border-x-0 max-md:border-t-0",
        "md:end-4 md:w-[380px] md:rounded-lg",
        focusMode ? "md:top-14" : "md:top-3",
      )}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Field
            ref={findRef}
            label={t`Find`}
            hideLabel
            placeholder={t`Find`}
            value={f.query}
            maxLength={MAX_QUERY_CHARS}
            className="py-1.5"
            onChange={(e) => {
              f.set({ query: e.target.value });
              later();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e.nativeEvent)) {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
          />
        </div>
        <span
          aria-live="polite"
          className={cx(
            "min-w-14 shrink-0 text-end text-xs tabular-nums",
            noResults || invalid ? "text-danger" : "text-ink-muted",
          )}
        >
          {invalid ? t`Invalid pattern` : countLabel(f.query, info.total, info.index)}
        </span>
        <IconButton
          icon={ChevronUp}
          label={t`Previous match`}
          onClick={() => step(-1)}
          disabled={info.total === 0}
        />
        <IconButton
          icon={ChevronDown}
          label={t`Next match`}
          onClick={() => step(1)}
          disabled={info.total === 0}
        />
        <IconButton icon={X} label={t`Close`} onClick={close} />
      </div>
      {f.replace && (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Field
              label={t`Replace with`}
              hideLabel
              placeholder={t`Replace with`}
              value={f.replacement}
              maxLength={MAX_REPLACEMENT_CHARS}
              className="py-1.5"
              onChange={(e) => {
                f.set({ replacement: e.target.value });
                later();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isComposing(e.nativeEvent)) {
                  e.preventDefault();
                  replaceOne();
                }
              }}
            />
          </div>
          <Button
            className={small}
            onClick={replaceOne}
            disabled={info.total === 0}
          >{t`Replace`}</Button>
          <Button
            className={small}
            onClick={replaceAll}
            disabled={info.total === 0}
          >{t`Replace all`}</Button>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={f.matchCase}
          className={cx(
            chip,
            f.matchCase
              ? "border-accent bg-accent-soft text-accent"
              : "border-border text-ink hover:bg-accent-soft",
          )}
          onClick={() => toggle({ matchCase: !f.matchCase })}
        >{t`Match case`}</button>
        <button
          type="button"
          aria-pressed={f.wholeWord}
          className={cx(
            chip,
            f.wholeWord
              ? "border-accent bg-accent-soft text-accent"
              : "border-border text-ink hover:bg-accent-soft",
          )}
          onClick={() => toggle({ wholeWord: !f.wholeWord })}
        >{t`Whole word`}</button>
        <button
          type="button"
          aria-pressed={f.allChapters}
          className={cx(
            chip,
            f.allChapters
              ? "border-accent bg-accent-soft text-accent"
              : "border-border text-ink hover:bg-accent-soft",
          )}
          onClick={() => toggle({ allChapters: !f.allChapters })}
        >{t`All chapters`}</button>
        <button
          type="button"
          aria-pressed={f.regex}
          className={cx(
            chip,
            f.regex
              ? "border-accent bg-accent-soft text-accent"
              : "border-border text-ink hover:bg-accent-soft",
          )}
          onClick={() => toggle({ regex: !f.regex })}
        >{t`Regex`}</button>
      </div>
      {rows.length > 0 && (
        <ul
          aria-label={t`Results by page`}
          className="m-0 flex max-h-[132px] list-none flex-col gap-0.5 overflow-y-auto p-0 md:max-h-[128px]"
        >
          {rows.map((r) => (
            <li key={r.id} className="min-w-0">
              <button
                type="button"
                aria-label={`${rowTitle(r)}, ${rowCount(r.count)}`}
                aria-current={r.current ? "true" : undefined}
                onClick={() => openRow(r.id)}
                className={cx(
                  "flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md px-2.5 text-start text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-7",
                  r.current
                    ? "bg-accent-soft font-semibold text-accent"
                    : "text-ink hover:bg-accent-soft",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{rowTitle(r)}</span>
                <span
                  className={cx(
                    "shrink-0 tabular-nums",
                    r.current ? "text-accent" : "text-ink-muted",
                  )}
                >
                  {r.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
