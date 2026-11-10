import { dailyPlan, MAX_GOAL_WORDS, type BookGoal, type DailyPlan } from "@cadabracraft/format";
import { isDateKey } from "@cadabracraft/shared";

/** The goal dialog's fields as typed: the word target as text, the deadline as `YYYY-MM-DD` or empty. */
export interface GoalForm {
  words: string;
  deadline: string;
}

/** The field that refused the form, or null when the goal is valid. */
export type GoalProblem = "words" | "deadline" | null;

/** The form a saved goal starts from; no goal gives an empty form. */
export function goalToForm(goal: BookGoal | undefined): GoalForm {
  return { words: goal ? String(goal.words) : "", deadline: goal?.deadline ?? "" };
}

/** The first field that is not valid: a whole number of words from 1 to the maximum, and a real date when one is given. */
export function goalProblem(form: GoalForm): GoalProblem {
  const text = form.words.trim();
  const words = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(words) || words < 1 || words > MAX_GOAL_WORDS)
    return "words";
  if (form.deadline.trim() && !isDateKey(form.deadline.trim())) return "deadline";
  return null;
}

/** The goal the form describes; the form must pass goalProblem first. An empty deadline means no deadline. */
export function goalFromForm(form: GoalForm): BookGoal {
  const deadline = form.deadline.trim();
  return deadline
    ? { words: Number(form.words.trim()), deadline }
    : { words: Number(form.words.trim()) };
}

/** Where the book stands against its goal: the share written, for a progress bar (0 to 100). */
export interface GoalView {
  plan: DailyPlan;
  percent: number;
}

/** The status-bar and dialog figures for `goal` given the book's word count and today's date (`YYYY-MM-DD`). */
export function goalView(goal: BookGoal, bookWords: number, today: string): GoalView {
  const plan = dailyPlan(goal, bookWords, today);
  const percent = Math.min(100, Math.floor((Math.min(bookWords, goal.words) / goal.words) * 100));
  return { plan, percent };
}

/** The calendar date of `d` in the local time zone, as `YYYY-MM-DD`. */
export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
