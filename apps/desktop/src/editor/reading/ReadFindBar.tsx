import { useEffect, useRef, type KeyboardEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { cx } from "../../ui/cx";
import { Field } from "../../ui/Input";
import { countLabel, isComposing } from "../../lib/search/findHelpers";
import { readRows } from "../../lib/search/readFind";
import { MAX_QUERY_CHARS, useFind } from "../findStore";
import { FindResults } from "../FindResults";
import type { useReadFindState } from "./useReadFind";

/**
 * Find bar of Read mode, docked top-right of the reader like the Write bar. It searches the whole book (there is no "this chapter"
 * scope, and nothing is replaced: Read mode is read-only), shows "3 of 12" across all chapters and a row per chapter with matches.
 * Focus is not trapped.
 */
export function ReadFindBar({ find }: { find: ReturnType<typeof useReadFindState> }) {
  const { t } = useLingui();
  const f = useFind();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [f.focusTick]);
  const typing = f.query !== "" && find.applied?.query !== f.query;
  const noResults = f.query !== "" && !typing && find.total === 0;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !isComposing(e.nativeEvent)) {
      e.preventDefault();
      e.stopPropagation();
      f.close();
    }
  };
  return (
    <div
      role="search"
      aria-label={t`Find in the book`}
      onKeyDown={onKeyDown}
      className={cx(
        "absolute z-(--z-panel) flex flex-col gap-2 border border-border bg-raised p-2 text-ink shadow-popover",
        "max-md:inset-x-0 max-md:top-0 max-md:border-x-0 max-md:border-t-0",
        "md:end-4 md:top-3 md:w-[380px] md:rounded-lg",
      )}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Field
            ref={input}
            label={t`Find`}
            hideLabel
            placeholder={t`Find`}
            aria-invalid={find.invalid || undefined}
            value={f.query}
            maxLength={MAX_QUERY_CHARS}
            className="py-1.5"
            onChange={(e) => f.set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e.nativeEvent)) {
                e.preventDefault();
                find.step(e.shiftKey ? -1 : 1);
              }
            }}
          />
        </div>
        <span
          aria-live="polite"
          className={cx(
            "min-w-14 shrink-0 text-end text-xs tabular-nums",
            noResults || find.invalid ? "text-danger" : "text-ink-muted",
          )}
        >
          {find.invalid
            ? t`Invalid pattern`
            : typing
              ? ""
              : countLabel(f.query, find.total, find.index + 1)}
        </span>
        <IconButton
          icon={ChevronUp}
          label={t`Previous match`}
          onClick={() => find.step(-1)}
          disabled={find.total === 0}
        />
        <IconButton
          icon={ChevronDown}
          label={t`Next match`}
          onClick={() => find.step(1)}
          disabled={find.total === 0}
        />
        <IconButton icon={X} label={t`Close`} onClick={f.close} />
      </div>
      <div className="flex items-center gap-1.5">
        <Chip
          pressed={f.matchCase}
          onClick={() => f.set({ matchCase: !f.matchCase })}
        >{t`Match case`}</Chip>
        <Chip
          pressed={f.wholeWord}
          onClick={() => f.set({ wholeWord: !f.wholeWord })}
        >{t`Whole word`}</Chip>
        <Chip pressed={f.regex} onClick={() => f.set({ regex: !f.regex })}>{t`Regex`}</Chip>
      </div>
      <FindResults rows={readRows(find.hits, find.index)} onOpen={find.openPage} />
    </div>
  );
}
