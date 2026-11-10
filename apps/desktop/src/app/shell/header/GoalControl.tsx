import type { BookGoal } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { Target } from "lucide-react";
import { useState } from "react";
import { GoalDialog } from "../../dialogs/GoalDialog";
import { goalView, localDateKey } from "../../../lib/goal/goalForm";
import { ProgressBar } from "../../../ui/feedback/ProgressBar";

interface Props {
  /** The book's writing goal, if one is set. */
  goal: BookGoal | undefined;
  /** Words in the whole book (null while counting). */
  bookWords: number | null;
}

/**
 * The goal in the status bar: the words written toward the goal with a progress bar, or a Set a goal button when there is none.
 * Either opens the Writing goal dialog.
 */
export function GoalControl({ goal, bookWords }: Props) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const view =
    goal && bookWords !== null ? goalView(goal, bookWords, localDateKey(new Date())) : null;

  let label: string;
  if (!goal) label = t`Set a writing goal`;
  else if (bookWords === null || !view) label = t`Goal: ${goal.words} words`;
  else if (view.plan.met) label = t`Goal met`;
  else if (view.plan.late) label = t`${bookWords} of ${goal.words} words · late`;
  else if (view.plan.wordsPerDay !== null)
    label = t`${bookWords} of ${goal.words} words · ${view.plan.wordsPerDay} a day`;
  else label = t`${bookWords} of ${goal.words} words`;

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 tabular-nums hover:bg-accent-soft max-md:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Target size={14} aria-hidden />
        <span>{label}</span>
      </button>
      {view && (
        <ProgressBar
          label={t`Goal progress`}
          value={view.percent}
          max={100}
          className="h-1.5 w-20 bg-border"
        />
      )}
      <GoalDialog open={open} onOpenChange={setOpen} goal={goal} bookWords={bookWords} />
    </span>
  );
}
