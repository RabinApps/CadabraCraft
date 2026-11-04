import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { cx } from "../../ui/cx";
import { ProgressBar } from "../../ui/ProgressBar";
import { usePageView } from "../hooks/usePageView";
import { PageEstimate, PagePosition } from "./PageEstimate";
import { PageZoomSelect } from "./PageZoomSelect";

interface Props {
  /** Words in the open page and in the whole book (null while counting). */
  words: number;
  bookWords: number | null;
  section: "front" | "chapter" | "back" | null;
  chapterNo: number;
  chapterCount: number;
  /** Words written this session, and the goal (0 = no goal). */
  sessionWritten: number | null;
  sessionGoal: number;
  focus: boolean;
}

/** The footer of the Write view: session goal, word counts with the page estimate, where you are in the book, and the Page view zoom. */
export function StatusBar(p: Props) {
  const { t } = useLingui();
  const pageView = usePageView();
  const { words, bookWords, sessionWritten, sessionGoal } = p;
  return (
    <footer
      className={cx(
        "hidden shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-4 py-1.5 text-xs text-ink-muted md:flex",
        p.focus && "md:hidden",
      )}
    >
      {sessionGoal > 0 && sessionWritten !== null && (
        <span className="flex items-center gap-2" data-testid="session-goal">
          <ProgressBar
            label={t`Session goal`}
            value={Math.min(sessionWritten, sessionGoal)}
            max={sessionGoal}
            className="h-1.5 w-24 bg-border"
          />
          {t`${sessionWritten} of ${sessionGoal} words this session`}
        </span>
      )}
      <span>
        {p.section === "chapter"
          ? plural(words, { one: "# word in this chapter", other: "# words in this chapter" })
          : plural(words, { one: "# word on this page", other: "# words on this page" })}
        {bookWords !== null && ` · ${t`${bookWords} in the book`}`}
        <PageEstimate />
        {pageView.on && <PagePosition />}
      </span>
      <span className="flex items-center gap-3">
        {pageView.on && <PageZoomSelect zoom={pageView.zoom} onChange={pageView.setZoom} />}
        <span>
          {p.section === "front"
            ? t`Front matter`
            : p.section === "back"
              ? t`Back matter`
              : t`Chapter ${p.chapterNo} of ${p.chapterCount}`}
        </span>
      </span>
    </footer>
  );
}
