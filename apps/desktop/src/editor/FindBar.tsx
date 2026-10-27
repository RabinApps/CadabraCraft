import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button, IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { Field } from "../ui/Input";
import { countLabel } from "./findHelpers";
import { useFind } from "./findStore";
import { getSearchInfo, searchCommands, searchKey } from "./search/plugin";

const DEBOUNCE_MS = 100;

/** Total and 1-based current index, kept in step with the document without re-rendering when nothing changed. */
function useSearchInfo(editor: Editor) {
  const [info, setInfo] = useState(() => getSearchInfo(editor));
  useEffect(() => {
    const update = () => {
      const next = getSearchInfo(editor);
      setInfo((prev) => (prev.total === next.total && prev.index === next.index ? prev : next));
    };
    update();
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);
  return info;
}

/** Selects the current match and scrolls to it (after a replace, when no step happened). The editor does not take focus. */
function revealCurrent(editor: Editor) {
  const s = searchKey.getState(editor.state);
  const m = s?.matches[s.current];
  if (!m) return;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView().setMeta("addToHistory", false));
}

const chip = "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const small = "px-3 py-1.5 text-xs";

/**
 * Find and replace bar, docked top-right of the writing area (full width under the top bar on phones). It is a toolbar,
 * not a modal: focus is not trapped. It is available in Write mode only (the search plugin is not loaded when reading),
 * and also in Focus mode, where it sits below the "Exit focus mode" button, so Cmd/Ctrl+F still works with the chrome hidden.
 */
export function FindBar({ editor, focusMode }: { editor: Editor; focusMode?: boolean }) {
  const { t } = useLingui();
  const f = useFind();
  const info = useSearchInfo(editor);
  const findRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Not kept across renders: TipTap binds `editor.commands` to the state at the time it is read.
  const commands = () => searchCommands(editor);

  const pending = useRef(false);
  const apply = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = false;
    const { query, replacement, matchCase, wholeWord } = useFind.getState();
    searchCommands(editor).setSearch({ query, replacement, matchCase, wholeWord });
  }, [editor]);
  /** Applies only if typing is still waiting for its debounce: applying rescans and would reset the current match. */
  const flush = () => { if (pending.current) apply(); };
  const later = () => { clearTimeout(timer.current); pending.current = true; timer.current = setTimeout(apply, DEBOUNCE_MS); };

  // Opening (or reopening, or arriving in a new chapter's editor) applies the stored settings and focuses the input.
  useEffect(() => {
    apply();
    findRef.current?.focus();
    findRef.current?.select();
  }, [f.focusTick, apply]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => {
    clearTimeout(timer.current);
    commands().clearSearch();
    f.close();
    editor.commands.focus();
  };
  const step = (dir: 1 | -1) => { flush(); if (dir === 1) commands().findNext(true); else commands().findPrevious(true); };
  const replaceOne = () => { flush(); if (commands().replaceCurrent()) revealCurrent(editor); };
  const replaceAll = () => { flush(); commands().replaceAll(); };
  const toggle = (patch: { matchCase: boolean } | { wholeWord: boolean }) => { f.set(patch); queueMicrotask(apply); };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Stop here so focus mode's own Escape does not also exit.
      e.preventDefault(); e.stopPropagation(); close();
    }
  };
  const noResults = f.query !== "" && info.total === 0;

  return (
    <div
      role="search"
      aria-label={t`Find and replace`}
      onKeyDown={onKeyDown}
      className={cx(
        "absolute z-20 flex flex-col gap-2 border border-border bg-raised p-2 text-ink shadow-xl",
        "max-md:inset-x-0 max-md:top-0 max-md:border-x-0 max-md:border-t-0",
        "md:end-4 md:w-[380px] md:rounded-lg", focusMode ? "md:top-14" : "md:top-3",
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
            className="py-1.5"
            onChange={(e) => { f.set({ query: e.target.value }); later(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }}
          />
        </div>
        <span aria-live="polite" className={cx("min-w-14 shrink-0 text-end text-xs tabular-nums", noResults ? "text-danger" : "text-ink-muted")}>
          {countLabel(f.query, info.total, info.index)}
        </span>
        <IconButton icon={ChevronUp} label={t`Previous match`} onClick={() => step(-1)} disabled={info.total === 0} />
        <IconButton icon={ChevronDown} label={t`Next match`} onClick={() => step(1)} disabled={info.total === 0} />
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
              className="py-1.5"
              onChange={(e) => { f.set({ replacement: e.target.value }); later(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } }}
            />
          </div>
          <Button className={small} onClick={replaceOne} disabled={info.total === 0}>{t`Replace`}</Button>
          <Button className={small} onClick={replaceAll} disabled={info.total === 0}>{t`Replace all`}</Button>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button type="button" aria-pressed={f.matchCase} className={cx(chip, f.matchCase ? "border-accent bg-accent-soft text-accent" : "border-border text-ink hover:bg-accent-soft")} onClick={() => toggle({ matchCase: !f.matchCase })}>{t`Match case`}</button>
        <button type="button" aria-pressed={f.wholeWord} className={cx(chip, f.wholeWord ? "border-accent bg-accent-soft text-accent" : "border-border text-ink hover:bg-accent-soft")} onClick={() => toggle({ wholeWord: !f.wholeWord })}>{t`Whole word`}</button>
      </div>
    </div>
  );
}
