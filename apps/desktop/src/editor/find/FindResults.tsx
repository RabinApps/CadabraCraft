import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";
import type { ResultRow } from "../../lib/search/findHelpers";

/** "All chapters" results: one row per page with matches, the page holding the current match highlighted. */
export function FindResults({ rows, onOpen }: { rows: ResultRow[]; onOpen: (id: string) => void }) {
  const { t } = useLingui();
  if (rows.length === 0) return null;
  const rowTitle = (r: ResultRow) =>
    r.section === "front"
      ? t`Front matter: ${r.title}`
      : r.section === "back"
        ? t`Back matter: ${r.title}`
        : r.title;
  // The visible number is part of the button's name (WCAG 2.5.3), so the name reads "Chapter One 2 matches".
  const matchWord = (n: number) => plural(n, { one: "match", other: "matches" });
  return (
    <ul
      aria-label={t`Results by page`}
      className="m-0 flex max-h-[132px] list-none flex-col gap-0.5 overflow-y-auto p-0 md:max-h-[128px]"
    >
      {rows.map((r) => (
        <li key={r.id} className="min-w-0">
          <button
            type="button"
            aria-current={r.current ? "true" : undefined}
            onClick={() => onOpen(r.id)}
            className={cx(
              "flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md px-2.5 text-start text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-7",
              r.current
                ? "bg-accent-soft font-semibold text-accent"
                : "text-ink hover:bg-accent-soft",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{rowTitle(r)}</span>
            <span
              className={cx("shrink-0 tabular-nums", r.current ? "text-accent" : "text-ink-muted")}
            >
              {r.count}
              <span className="sr-only"> {matchWord(r.count)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
