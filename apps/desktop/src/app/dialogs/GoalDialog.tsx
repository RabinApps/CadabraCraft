import { MAX_GOAL_WORDS, type BookGoal } from "@cadabracraft/format";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { whyText } from "../../lib/projectError";
import {
  goalFromForm,
  goalProblem,
  goalToForm,
  goalView,
  localDateKey,
  type GoalForm,
  type GoalProblem,
} from "../../lib/goal/goalForm";
import { useProject } from "../../state/project/index";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Notice } from "../../ui/feedback/Notice";
import { Field, focusField } from "../../ui/forms/Input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The book's saved goal, if any. */
  goal: BookGoal | undefined;
  /** The book's word count now (null while counting: the plan line waits). */
  bookWords: number | null;
}

/** The words, deadline, live daily plan and Save, Clear and Cancel of one goal. Mounted fresh each time the dialog opens. */
function GoalFields({
  goal,
  bookWords,
  onDone,
}: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const { t } = useLingui();
  const setBookGoal = useProject((s) => s.actions.setBookGoal);
  const [form, setForm] = useState<GoalForm>(() => goalToForm(goal));
  const [shown, setShown] = useState<GoalProblem>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = goalProblem(form);
  const valid = problem === null ? goalFromForm(form) : null;

  /** The daily plan in a sentence; empty while the form is invalid or the word count is still pending. */
  const planSentence = (goalNow: BookGoal, words: number): string => {
    const { plan } = goalView(goalNow, words, localDateKey(new Date()));
    if (plan.met) return t`Goal met. Nothing left to write.`;
    if (plan.late) return t`The deadline has passed with ${plan.remaining} words to go.`;
    if (plan.daysLeft === null || plan.wordsPerDay === null)
      return t`${plan.remaining} words to go.`;
    const perDay = plan.wordsPerDay;
    const deadline = goalNow.deadline ?? "";
    const dayPhrase = plural(plan.daysLeft, { one: "# day left", other: "# days left" });
    return t`${perDay} words a day to ${deadline}, ${dayPhrase}.`;
  };
  const text = valid && bookWords !== null ? planSentence(valid, bookWords) : "";
  // The plan changes with every keystroke. The screen reader hears it once typing pauses, not on each key, and not when the dialog opens.
  const [announced, setAnnounced] = useState(text);
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(text), 800);
    return () => clearTimeout(id);
  }, [text]);

  const messages: Record<NonNullable<GoalProblem>, string> = {
    words: t`Enter a whole number of words from 1 to ${MAX_GOAL_WORDS}.`,
    deadline: t`Enter a real date, or clear the deadline.`,
  };
  const write = async (next: BookGoal | null, fail: (why: string) => string) => {
    setBusy(true);
    try {
      await setBookGoal(next);
      onDone();
    } catch (e) {
      setError(fail(whyText(e)));
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (problem) {
      setShown(problem);
      setError(messages[problem]);
      focusField(problem === "words" ? "goal-words" : "goal-deadline");
      return;
    }
    void write(
      goalFromForm(form),
      (why) => t`The goal could not be saved: ${why}. Try again; nothing was changed.`,
    );
  };
  const clear = () =>
    void write(
      null,
      (why) => t`The goal could not be cleared: ${why}. Try again; nothing was changed.`,
    );

  return (
    <form
      // The browser's own range check would block Save before the dialog explains the problem in words.
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field
        id="goal-words"
        label={t`Word goal`}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_GOAL_WORDS}
        step={1}
        value={form.words}
        onChange={(e) => setForm({ ...form, words: e.target.value })}
        error={shown === "words" ? messages.words : undefined}
      />
      <Field
        id="goal-deadline"
        label={t`Deadline (optional)`}
        type="date"
        value={form.deadline}
        onChange={(e) => setForm({ ...form, deadline: e.target.value })}
        error={shown === "deadline" ? messages.deadline : undefined}
      />
      <p id="goal-plan" className="text-sm text-ink-muted">
        {text}
      </p>
      <p role="status" className="sr-only">
        {announced}
      </p>
      {error && (
        <Notice id="goal-error" role="alert">
          {error}
        </Notice>
      )}
      <GoalButtons hasGoal={goal !== undefined} busy={busy} onClear={clear} onCancel={onDone} />
    </form>
  );
}

/** Clear goal (only when one is saved), Cancel and Save goal. */
function GoalButtons({
  hasGoal,
  busy,
  onClear,
  onCancel,
}: {
  hasGoal: boolean;
  busy: boolean;
  onClear: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2.5">
      {hasGoal ? (
        <Button type="button" variant="ghost" icon={Trash2} disabled={busy} onClick={onClear}>
          {t`Clear goal`}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex gap-2.5">
        <Button type="button" disabled={busy} onClick={onCancel}>
          {t`Cancel`}
        </Button>
        <Button type="submit" variant="primary" icon={Save} disabled={busy}>
          {t`Save goal`}
        </Button>
      </div>
    </div>
  );
}

/** The writing goal: a word target, an optional deadline and the daily plan it implies. Nothing is stored until Save. */
export function GoalDialog({ open, onOpenChange, goal, bookWords }: Props) {
  const { t } = useLingui();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t`Writing goal`} size="sm">
      <GoalFields goal={goal} bookWords={bookWords} onDone={() => onOpenChange(false)} />
    </Modal>
  );
}
